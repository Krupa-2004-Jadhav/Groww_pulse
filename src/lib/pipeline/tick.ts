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
 */
export async function runEvaluationTick(now: Date = new Date()): Promise<TickResult> {
  const watched = await prisma.watchlistItem.findMany({ select: { symbol: true }, distinct: ["symbol"] });
  const symbols = Array.from(new Set([...watched.map((w) => w.symbol), MARKET_INDEX_SYMBOL]));

  for (const symbol of symbols) {
    await updateStats(symbol, { now }); // internally throttled — see rollup.ts's staleness guard
  }

  let eventsEmitted = 0;
  for (const symbol of symbols) {
    const signals = await computeCurrentSignals(symbol);
    const fired = signals.filter((s) => s.subScore > 0);

    if (fired.length > 0) {
      const results = await emitEventsForSignals(symbol, fired, now);
      eventsEmitted += results.filter((r) => r.inserted).length;
    }

    await reconcileOpenEvents(symbol, signals);
  }

  return { symbolsEvaluated: symbols.length, eventsEmitted };
}
