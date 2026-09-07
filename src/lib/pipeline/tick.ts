import { prisma } from "@/lib/db";
import { computeCurrentSignals } from "./evaluate";
import { emitEventsForSignals } from "@/lib/events/emit";
import { reconcileOpenEvents } from "@/lib/events/reconcile";
import { MARKET_INDEX_SYMBOL, updateStats } from "@/lib/seed/rollup";

export interface TickResult {
  symbolsEvaluated: number;
  eventsEmitted: number;
}

/**
 * One full evaluation pass: recompute rolling stats, then for every watched
 * symbol (plus the market-index proxy, needed for beta/relative signals)
 * compute its current signals, emit events for whatever fired, and
 * reconcile already-open events against the same fresh signal set.
 *
 * Called after each ingest poll (Phase 2's IngestPoller writes quotes; this
 * turns fresh quotes into stories) — every 10s during market hours. The
 * `updateStats` call below is safe to make on every one of those ticks
 * because it's internally throttled (rollup.ts's staleness guard): the
 * source data (bars_daily) only changes once a day, so recomputing it
 * every 10s would be ~5000x more work than the data justifies.
 * Symbol-centric by construction — this
 * loop runs once per unique watched symbol, never once per user/watchlist.
 *
 * `reconcileOpenEvents` is deliberately gated on `updateStats` having
 * actually recomputed (`didRecompute`), not called unconditionally every
 * tick. Phase 6's hysteresis requires a condition to read "clear" on 2
 * *consecutive passes* before resolving — the whole point is to require
 * genuine separation in time. If reconciliation ran on every 10s poll
 * regardless of whether the underlying stats were fresh, two ticks 10
 * seconds apart could take an event from clear_streak=0 to resolved,
 * because both "passes" would be judging the same frozen baseline rather
 * than two independent looks at the data. Signal emission is NOT gated
 * the same way — a genuinely new price move should be caught as soon as
 * the next quote lands, and vol_20d/avg_volume_20d/high_52w/low_52w are
 * valid all day regardless of when they were last recomputed, so staleness
 * doesn't compromise detection, only "how many independent times has this
 * been re-checked."
 */
export async function runEvaluationTick(now: Date = new Date()): Promise<TickResult> {
  const watched = await prisma.watchlistItem.findMany({ select: { symbol: true }, distinct: ["symbol"] });
  const symbols = Array.from(new Set([...watched.map((w) => w.symbol), MARKET_INDEX_SYMBOL]));

  const didRecompute = new Map<string, boolean>();
  for (const symbol of symbols) {
    didRecompute.set(symbol, await updateStats(symbol, { now })); // internally throttled — see rollup.ts's staleness guard
  }

  let eventsEmitted = 0;
  for (const symbol of symbols) {
    const signals = await computeCurrentSignals(symbol);
    const fired = signals.filter((s) => s.subScore > 0);

    if (fired.length > 0) {
      const results = await emitEventsForSignals(symbol, fired, now);
      eventsEmitted += results.filter((r) => r.inserted).length;
    }

    if (didRecompute.get(symbol)) {
      await reconcileOpenEvents(symbol, signals);
    }
  }

  return { symbolsEvaluated: symbols.length, eventsEmitted };
}
