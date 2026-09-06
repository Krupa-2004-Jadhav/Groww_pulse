import { prisma } from "@/lib/db";
import { dailyReturns, flooredVol20d, mean, beta as computeBeta, max, min } from "@/lib/stats/math";

const ROLLING_WINDOW = 20;
const YEAR_WINDOW = 252; // ~252 trading days/year
export const MARKET_INDEX_SYMBOL = process.env.MARKET_INDEX_SYMBOL ?? "SPY";

interface AdjustedBar {
  date: Date;
  close: number;
  volume: number;
}

async function loadAdjustedBars(symbol: string): Promise<AdjustedBar[]> {
  const bars = await prisma.barDaily.findMany({
    where: { symbol },
    orderBy: { barDate: "asc" },
  });
  // adjFactor makes closes continuous across splits; volume is scaled by
  // its inverse for the same reason (post-split, the same dollar amount
  // trades as more shares) — see docs on the split worked example.
  return bars.map((b) => ({
    date: b.barDate,
    close: (b.close ?? 0) * b.adjFactor,
    volume: (b.volume ?? 0) / b.adjFactor,
  }));
}

/**
 * Recomputes symbol_stats from stored bars_daily (plan Phase 3). Kept
 * separate from reconcileOpenEvents (Phase 6) by design — the plan
 * explicitly wants the two independently callable and testable, since one
 * recomputes baselines and the other only re-evaluates already-open events
 * against them.
 *
 * Beta alignment simplification (stated, not hidden): both series are
 * trimmed to the same trailing length rather than joined by exact date, so
 * a symbol with a trading halt the index didn't have would be slightly
 * misaligned. Acceptable for a US-equities, non-halted demo universe;
 * a production version would join on `bar_date`.
 */
export async function updateStats(symbol: string): Promise<void> {
  const bars = await loadAdjustedBars(symbol);
  if (bars.length < 2) return; // not enough history yet — leave stats absent rather than fabricate them

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const returns = dailyReturns(closes);

  const recentReturns = returns.slice(-ROLLING_WINDOW);
  const recentVolumes = volumes.slice(-ROLLING_WINDOW);
  const yearCloses = closes.slice(-YEAR_WINDOW);

  const vol20d = flooredVol20d(recentReturns);
  const avgVolume20d = mean(recentVolumes);
  const high52w = max(yearCloses);
  const low52w = min(yearCloses);
  const betaValue = await computeSymbolBeta(symbol, returns);

  await prisma.symbolStats.upsert({
    where: { symbol },
    create: { symbol, vol20d, avgVolume20d, high52w, low52w, beta: betaValue, updatedAt: new Date() },
    update: { vol20d, avgVolume20d, high52w, low52w, beta: betaValue, updatedAt: new Date() },
  });
}

async function computeSymbolBeta(symbol: string, returns: number[]): Promise<number | null> {
  if (symbol === MARKET_INDEX_SYMBOL) return 1; // the index's beta against itself is definitionally 1

  const indexBars = await loadAdjustedBars(MARKET_INDEX_SYMBOL);
  if (indexBars.length < 2) return null; // index not seeded yet — omit rather than guess

  const indexReturns = dailyReturns(indexBars.map((b) => b.close));
  const n = Math.min(returns.length, indexReturns.length);
  if (n < 2) return null;

  return computeBeta(returns.slice(-n), indexReturns.slice(-n));
}

/** Recomputes stats for every symbol that has at least one bar. Called by the rollup cron. */
export async function updateAllStats(): Promise<void> {
  const symbols = await prisma.barDaily.findMany({ select: { symbol: true }, distinct: ["symbol"] });
  for (const { symbol } of symbols) {
    await updateStats(symbol);
  }
}
