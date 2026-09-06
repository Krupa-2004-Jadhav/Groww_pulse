import { prisma } from "@/lib/db";
import { Signal } from "@/lib/signals/types";

const RESOLVE_AFTER_CLEAR_STREAK = 2;

/**
 * Track A resolution: recheck-on-rollup, chosen over time-decay (plan
 * Phase 6). Deliberately its own function, separate from updateStats
 * (plan §6.4 wants them independently testable) — this one only re-checks
 * already-open events against a freshly computed signal set; it never
 * touches symbol_stats itself.
 *
 * A trade-off worth naming: this re-derives "is it still true" by checking
 * whether a signal of the same `type` is present among `currentSignals`,
 * rather than re-deriving each event's specific trigger_metric/threshold
 * bespoke. That keeps one code path (Phase 4's pure functions) as the only
 * source of truth for "does this condition hold," at the cost of losing
 * per-event threshold nuance if a signal's own thresholds ever change
 * between when the event fired and when it's reconciled — acceptable since
 * thresholds are constants in this build, not per-event state.
 *
 * Hysteresis: a condition must read "clear" for 2 consecutive reconcile
 * passes before the event resolves — one clear pass, alone, does not
 * resolve it (prevents flapping open/closed across a single noisy tick).
 */
export async function reconcileOpenEvents(symbol: string, currentSignals: Signal[]): Promise<void> {
  const openEvents = await prisma.symbolEvent.findMany({ where: { symbol, resolvedAt: null } });
  if (openEvents.length === 0) return; // nothing open -> no wasted work, not even an update query

  const firingTypes = new Set(currentSignals.map((s) => s.type));

  for (const event of openEvents) {
    const stillFiring = firingTypes.has(event.eventType);

    if (stillFiring) {
      if (event.clearStreak !== 0) {
        await prisma.symbolEvent.update({ where: { seq: event.seq }, data: { clearStreak: 0 } });
      }
      continue;
    }

    const nextStreak = event.clearStreak + 1;
    if (nextStreak >= RESOLVE_AFTER_CLEAR_STREAK) {
      await prisma.symbolEvent.update({
        where: { seq: event.seq },
        data: { clearStreak: nextStreak, resolvedAt: new Date() },
      });
    } else {
      await prisma.symbolEvent.update({ where: { seq: event.seq }, data: { clearStreak: nextStreak } });
    }
  }
}
