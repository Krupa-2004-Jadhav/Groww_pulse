import { prisma } from "@/lib/db";
import { Signal, Tier } from "@/lib/signals/types";

function dateBucket(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export interface EmitEventInput {
  symbol: string;
  eventType: string; // matches a Signal's `type` (price_move, volume_surge, ...)
  tier: Tier;
  score: number;
  reason: string;
  occurredAt: Date;
  triggerMetric?: string;
  triggerThreshold?: number;
}

/** symbol + type + date-bucket + tier — escalating to a new tier (or a fresh day) is a NEW row, not a mutation of the old one. */
export function buildDedupeKey(input: Pick<EmitEventInput, "symbol" | "eventType" | "tier" | "occurredAt">): string {
  return `${input.symbol}:${input.eventType}:${dateBucket(input.occurredAt)}:${input.tier}`;
}

export interface EmitResult {
  inserted: boolean;
  seq: number | null;
}

/**
 * Idempotent event insert (plan Phase 6). `INSERT ... ON CONFLICT(dedupeKey)
 * DO NOTHING` means the same signal detected twice in one evaluation pass —
 * or a retried write after a crash — produces exactly one row either way.
 * Never mutates an existing row: escalation to a worse tier gets its own
 * dedupe key (see buildDedupeKey), so the old row is left untouched and the
 * new one starts with a clean ack state.
 */
export async function emitEvent(input: EmitEventInput): Promise<EmitResult> {
  const dedupeKey = buildDedupeKey(input);

  const rowsAffected = await prisma.$executeRaw`
    INSERT INTO "SymbolEvent" ("symbol", "eventType", "tier", "score", "reason", "occurredAt", "triggerMetric", "triggerThreshold", "clearStreak", "dedupeKey")
    VALUES (${input.symbol}, ${input.eventType}, ${input.tier}, ${input.score}, ${input.reason}, ${input.occurredAt}, ${input.triggerMetric ?? null}, ${input.triggerThreshold ?? null}, 0, ${dedupeKey})
    ON CONFLICT("dedupeKey") DO NOTHING
  `;

  if (rowsAffected === 0) {
    return { inserted: false, seq: null };
  }

  const row = await prisma.symbolEvent.findUnique({ where: { dedupeKey }, select: { seq: true } });
  return { inserted: true, seq: row?.seq ?? null };
}

/**
 * Emits one event per fired signal for a symbol — the write-path
 * counterpart to Phase 4's pure signal functions. A `null` signal (didn't
 * fire) never reaches here; the caller filters before calling this.
 */
export async function emitEventsForSignals(symbol: string, signals: Signal[], occurredAt: Date): Promise<EmitResult[]> {
  const results: EmitResult[] = [];
  for (const signal of signals) {
    results.push(
      await emitEvent({
        symbol,
        eventType: signal.type,
        tier: signal.tier,
        score: signal.subScore,
        reason: signal.message,
        occurredAt,
        triggerMetric: signal.triggerMetric,
        triggerThreshold: signal.triggerThreshold,
      })
    );
  }
  return results;
}
