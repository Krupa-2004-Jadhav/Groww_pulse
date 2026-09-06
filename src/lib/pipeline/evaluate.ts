import { prisma } from "@/lib/db";
import {
  Signal,
  priceMoveSignal,
  volatilityExpansionSignal,
  volumeAnomalySignal,
  relativePerformanceSignal,
  week52BreakSignal,
  gapSignal,
} from "@/lib/signals";
import { dailyReturns, flooredVol20d } from "@/lib/stats/math";
import { MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";

/**
 * Bridges Phase 4's pure signal functions to real stored data.
 *
 * Architectural note (this matters, and was worth getting right rather than
 * the first thing that compiled): "Window = since last visit" in the Phase
 * 4 signal table reads as per-user, but the plan's own stated principle is
 * "materiality computed once per symbol; correctness maintained once per
 * user" (§3) — signal evaluation must NOT be re-run per user's individual
 * checkpoint, or 1M users watching 5,000 symbols really would mean 50M
 * evaluations, which is exactly the scaling failure the architecture is
 * built to avoid.
 *
 * The resolution: this function always compares the current live quote
 * against the most recent stored daily bar close — i.e. "since the
 * previous close," a fixed, symbol-level reference every watcher shares.
 * The truly personal "since YOU left" experience is assembled entirely at
 * read time in Phase 7's /changes: a user who was away 3 days simply sees
 * the union of 3 days' worth of already-computed, dated events that are
 * still above their watermark. This is computed once per symbol, per
 * evaluation tick, regardless of how many users or watchlists reference it.
 *
 * Known simplification (stated, not hidden): the filing/event signal is
 * intentionally NOT computed here. Its pure function and tests exist
 * (Phase 4), but wiring live /earnings and /dividends into a stored,
 * queryable events table was cut for time — see README's scope-cut table.
 * The "event" weight category isn't empty without it, though: week52_break
 * and gap both live there too.
 */
export async function computeCurrentSignals(symbol: string): Promise<Signal[]> {
  const [quote, stats] = await Promise.all([
    prisma.quoteLatest.findUnique({ where: { symbol } }),
    prisma.symbolStats.findUnique({ where: { symbol } }),
  ]);
  if (!quote || !stats || stats.vol20d === null) return [];

  const vol20d = stats.vol20d;
  const previousClose = await mostRecentBarClose(symbol);
  const signals: Signal[] = [];

  if (previousClose !== null) {
    const actualReturn = (quote.price - previousClose) / previousClose;
    const indexReturn = symbol === MARKET_INDEX_SYMBOL ? 0 : await indexReturnSincePreviousClose();

    const priceSig = priceMoveSignal({
      symbol,
      actualReturn,
      indexReturn: indexReturn ?? 0,
      beta: stats.beta ?? 1,
      vol20d,
      windowTradingDays: 1,
      windowLabel: "since the previous close",
    });
    if (priceSig) signals.push(priceSig);

    if (indexReturn !== null) {
      const relSig = relativePerformanceSignal({
        symbol,
        stockReturn: actualReturn,
        benchmarkReturn: indexReturn,
        benchmarkLabel: MARKET_INDEX_SYMBOL,
      });
      if (relSig) signals.push(relSig);
    }
  }

  if (quote.volume !== null && stats.avgVolume20d !== null) {
    const volSig = volumeAnomalySignal({ symbol, volume: quote.volume, avgVolume20d: stats.avgVolume20d });
    if (volSig) signals.push(volSig);
  }

  const recentVol = await recentVolatility(symbol);
  if (recentVol !== null) {
    const volExpSig = volatilityExpansionSignal({ symbol, recentVol, vol20d });
    if (volExpSig) signals.push(volExpSig);
  }

  if (stats.high52w !== null && stats.low52w !== null) {
    const breakSig = week52BreakSignal({ symbol, price: quote.price, high52w: stats.high52w, low52w: stats.low52w });
    if (breakSig) signals.push(breakSig);
  }

  if (quote.dayOpen !== null && quote.prevClose !== null) {
    const gapSig = gapSignal({ symbol, dayOpen: quote.dayOpen, prevClose: quote.prevClose, vol20d });
    if (gapSig) signals.push(gapSig);
  }

  return signals;
}

async function mostRecentBarClose(symbol: string): Promise<number | null> {
  const bar = await prisma.barDaily.findFirst({ where: { symbol }, orderBy: { barDate: "desc" } });
  if (!bar || bar.close === null) return null;
  return bar.close * bar.adjFactor;
}

async function indexReturnSincePreviousClose(): Promise<number | null> {
  const [indexQuote, indexPreviousClose] = await Promise.all([
    prisma.quoteLatest.findUnique({ where: { symbol: MARKET_INDEX_SYMBOL } }),
    mostRecentBarClose(MARKET_INDEX_SYMBOL),
  ]);
  if (!indexQuote || indexPreviousClose === null) return null;
  return (indexQuote.price - indexPreviousClose) / indexPreviousClose;
}

/** Short-window (5-day) realized volatility from the most recent bars, for the volatility-expansion signal. */
async function recentVolatility(symbol: string): Promise<number | null> {
  const bars = await prisma.barDaily.findMany({
    where: { symbol },
    orderBy: { barDate: "desc" },
    take: 6, // 6 closes -> 5 returns
  });
  if (bars.length < 3) return null;

  const closes = [...bars].reverse().map((b) => (b.close ?? 0) * b.adjFactor);
  return flooredVol20d(dailyReturns(closes));
}
