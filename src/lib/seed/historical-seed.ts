import { prisma } from "@/lib/db";
import { HistoricalDataProvider, SplitEvent } from "@/lib/providers";
import { computeAdjustmentFactors } from "./adjust";

export interface SeedResult {
  symbol: string;
  barsInserted: number;
  skipped: boolean;
  splitsApplied: number;
  /**
   * false when the provider's /splits call itself failed — confirmed live
   * against Twelve Data's Basic plan: AAPL's /splits succeeds, but TSLA's
   * and AMZN's return 403 "available exclusively with grow/pro/... plans"
   * on the identical key. Free-tier /splits access is apparently
   * symbol-specific (AAPL reads as a showcase symbol), not a blanket
   * guarantee the earlier single-symbol test mistakenly generalized from.
   * Bars are still seeded either way; adj_factor simply stays 1.0
   * (no adjustment applied) rather than the seed failing outright or a
   * split being silently fabricated.
   */
  splitsAvailable: boolean;
}

/**
 * Seeds ~1 year of daily bars for one symbol, once (plan Phase 3). If bars
 * already exist for this symbol, the provider is never called — "cache to
 * DB, never re-fetch what you already have" (plan §1), which also matters
 * for staying inside the daily credit budget.
 */
export async function seedSymbolHistory(
  symbol: string,
  provider: HistoricalDataProvider,
  outputsize = 260
): Promise<SeedResult> {
  const existingCount = await prisma.barDaily.count({ where: { symbol } });
  if (existingCount > 0) {
    return { symbol, barsInserted: 0, skipped: true, splitsApplied: 0, splitsAvailable: true };
  }

  const bars = await provider.getDailyBars(symbol, outputsize);
  if (bars.length === 0) {
    return { symbol, barsInserted: 0, skipped: false, splitsApplied: 0, splitsAvailable: true };
  }

  // Fetched separately from bars (not Promise.all'd together) so a /splits
  // failure can never take the actually-essential bars down with it.
  let splits: SplitEvent[] = [];
  let splitsAvailable = true;
  try {
    splits = await provider.getSplits(symbol);
  } catch {
    splitsAvailable = false;
  }

  const factors = computeAdjustmentFactors(
    bars.map((b) => b.date),
    splits
  );

  await prisma.barDaily.createMany({
    data: bars.map((bar, i) => ({
      symbol,
      barDate: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      adjFactor: factors[i],
    })),
  });

  return { symbol, barsInserted: bars.length, skipped: false, splitsApplied: splits.length, splitsAvailable };
}

/**
 * Seeds every symbol currently on any watchlist, plus the market-index proxy
 * (beta needs it — see rollup.ts), sequentially — "respecting 8 req/min"
 * (plan §1) means one symbol at a time, not Promise.all, since each
 * seedSymbolHistory call makes up to 2 rate-limited requests (bars + splits).
 */
export async function seedAllWatchedSymbols(
  provider: HistoricalDataProvider,
  extraSymbols: string[] = []
): Promise<SeedResult[]> {
  const watched = await prisma.watchlistItem.findMany({ select: { symbol: true }, distinct: ["symbol"] });
  const symbols = Array.from(new Set([...watched.map((w) => w.symbol), ...extraSymbols]));

  const results: SeedResult[] = [];
  for (const symbol of symbols) {
    results.push(await seedSymbolHistory(symbol, provider));
  }
  return results;
}
