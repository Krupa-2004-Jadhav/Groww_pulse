import { prisma } from "@/lib/db";
import { computeSafeSeq } from "./safe-seq";

export interface ChangeEvent {
  seq: number;
  symbol: string;
  eventType: string;
  tier: string;
  score: number;
  reason: string;
  occurredAt: Date;
}

export interface ChangesResult {
  cursor: number;
  events: ChangeEvent[];
}

/**
 * GET /watchlists/:id/changes (plan Phase 7). Read-only — this function
 * MUST NOT advance the watermark; only an explicit /ack does that (same
 * "checkpoint vs. read" separation as Phase 2's out-of-order guard: a read
 * can never silently move the baseline it's being compared against).
 *
 * Filters applied, in order:
 *   1. seq > read_state.watermark AND seq <= safe_seq — the unconfirmed,
 *      fully-visible window.
 *   2. resolved_at IS NULL — Track A: don't surface a condition that has
 *      since cleared.
 *   3. no ack/dismiss in user_event_state for this user — Track B.
 *   4. seq > watchlist_items.seed_watermark for that symbol — a freshly
 *      added symbol never dumps its pre-existing event history.
 * Ranked by score desc — highest-attention story first.
 */
export async function getChanges(userId: string, watchlistId: string): Promise<ChangesResult> {
  const safeSeq = await computeSafeSeq();

  const readState = await prisma.readState.findUnique({
    where: { userId_watchlistId: { userId, watchlistId } },
  });
  const watermark = readState?.watermark ?? 0;

  const items = await prisma.watchlistItem.findMany({ where: { watchlistId } });
  if (items.length === 0) return { cursor: safeSeq, events: [] };

  const seedWatermarkBySymbol = new Map(items.map((i) => [i.symbol, i.seedWatermark]));
  const symbols = items.map((i) => i.symbol);

  const candidates = await prisma.symbolEvent.findMany({
    where: {
      symbol: { in: symbols },
      seq: { gt: watermark, lte: safeSeq },
      resolvedAt: null,
    },
    orderBy: { score: "desc" },
  });

  if (candidates.length === 0) return { cursor: safeSeq, events: [] };

  const userStates = await prisma.userEventState.findMany({
    where: { userId, eventId: { in: candidates.map((c) => c.seq) } },
  });
  const suppressed = new Set(userStates.filter((s) => s.acknowledgedAt || s.dismissedAt).map((s) => s.eventId));

  const events = candidates
    .filter((e) => !suppressed.has(e.seq))
    .filter((e) => e.seq > (seedWatermarkBySymbol.get(e.symbol) ?? 0))
    .map((e) => ({
      seq: e.seq,
      symbol: e.symbol,
      eventType: e.eventType,
      tier: e.tier,
      score: e.score,
      reason: e.reason,
      occurredAt: e.occurredAt,
    }));

  return { cursor: safeSeq, events };
}
