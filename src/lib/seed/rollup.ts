import { prisma } from "@/lib/db";
import { dailyReturns, flooredVol20d, mean, beta as computeBeta, max, min } from "@/lib/stats/math";

const ROLLING_WINDOW = 20;
const YEAR_WINDOW = 252; // ~252 trading days/year
export const MARKET_INDEX_SYMBOL = process.env.MARKET_INDEX_SYMBOL ?? "SPY";

// bars_daily changes at most once per trading day (there isn't even a
// same-day rollover job yet — it's seeded once and doesn't grow), but
// runEvaluationTick calls updateStats() for every symbol on every
// evaluation tick, which fires after every successful poll — every 10s
// during market hours (plan Phase 2's cadence). Recomputing a full
// 260-row reload + stddev/beta from scratch that often is ~5000x more
// work than the data can possibly justify. This matches the plan's own
// intent (Phase 3: "Rollup job, node-cron, every N minutes while market
// open" — a cadence deliberately decoupled from the quote poller), which
// the tick-triggered call site had collapsed into one. Fixed here rather
// than by restructuring the scheduler, since a staleness guard is the
// smaller, more localized change for the same effect.
const STATS_REFRESH_INTERVAL_MS = 15 * 60_000;

export interface AdjustedBar {
  date: Date;
  close: number;
  volume: number;
}

/**
 * Exported for reuse (e.g. the stock detail screen's price/volume charts)
 * rather than having other callers re-query bars_daily and re-derive the
 * same split adjustment themselves — one place computes "what actually
 * happened," everything else reads it.
 */
export async function loadAdjustedBars(symbol: string): Promise<AdjustedBar[]> {
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
 *
 * `force` bypasses the staleness guard — used by tests and by a genuine
 * one-shot "recompute now" call (e.g. right after seeding new history),
 * where skipping would leave symbol_stats absent instead of freshly wrong.
 *
 * Returns whether it actually recomputed. This matters beyond an internal
 * detail: Phase 6's hysteresis (`reconcileOpenEvents`) requires a
 * condition to read "clear" on 2 *consecutive passes* before resolving an
 * event, where a "pass" is meant to be an independent look at the data —
 * not two reads of one cached row taken 10 seconds apart. The caller
 * (`lib/pipeline/tick.ts`) uses this return value to only reconcile when a
 * pass was genuine, which is what makes "consecutive" mean something.
 */
export async function updateStats(symbol: string, opts: { now?: Date; force?: boolean } = {}): Promise<boolean> {
  const now = opts.now ?? new Date();

  if (!opts.force) {
    const existing = await prisma.symbolStats.findUnique({ where: { symbol }, select: { updatedAt: true } });
    if (existing && now.getTime() - existing.updatedAt.getTime() < STATS_REFRESH_INTERVAL_MS) {
      return false; // still fresh — bars_daily can't have changed meaningfully since the last recompute
    }
  }

  const bars = await loadAdjustedBars(symbol);
  if (bars.length < 2) return false; // not enough history yet — leave stats absent rather than fabricate them

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

  // Stamped with `now` (not a fresh `new Date()`) so the write is
  // consistent with the guard's own read-side comparison above — a
  // caller injecting `now` for deterministic tests would otherwise have
  // the staleness check compare against a simulated time while the actual
  // stored timestamp silently used real wall-clock time.
  await prisma.symbolStats.upsert({
    where: { symbol },
    create: { symbol, vol20d, avgVolume20d, high52w, low52w, beta: betaValue, updatedAt: now },
    update: { vol20d, avgVolume20d, high52w, low52w, beta: betaValue, updatedAt: now },
  });

  return true;
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
