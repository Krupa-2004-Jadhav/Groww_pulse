/**
 * Pure statistics helpers used by the rollup job and the signal layer.
 * No I/O, no DB — everything here is a plain function of its arguments, so
 * Phase 3/4's "known fixture, hand-computed expected values" test gates can
 * check them directly without touching a database.
 */

/** Day-over-day percentage returns from a chronological (oldest-first) close series. */
export function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev === 0) {
      returns.push(0);
      continue;
    }
    returns.push((closes[i] - prev) / prev);
  }
  return returns;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator) — the conventional choice for a rolling-window estimate. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Floors volatility at a minimum so a perfectly flat or near-zero-liquidity
 * fixture never produces a zero denominator downstream (z-scores, ratios).
 * The floor is deliberately tiny (1bp) — big enough to prevent Infinity/NaN,
 * small enough to never mask a real signal.
 */
export const MIN_VOLATILITY = 0.0001;

export function flooredVol20d(returns: number[]): number {
  return Math.max(MIN_VOLATILITY, stddev(returns));
}

/**
 * Beta of `assetReturns` against `indexReturns` (must be the same length,
 * index-aligned by date). beta = Cov(asset, index) / Var(index).
 * Falls back to 1.0 (i.e. "moves with the market") when the index series
 * has no variance — an edge case, not a real market condition, but must
 * not divide by zero.
 */
export function beta(assetReturns: number[], indexReturns: number[]): number {
  const n = Math.min(assetReturns.length, indexReturns.length);
  if (n < 2) return 1;

  const a = assetReturns.slice(-n);
  const idx = indexReturns.slice(-n);
  const meanA = mean(a);
  const meanIdx = mean(idx);

  let covariance = 0;
  let varianceIdx = 0;
  for (let i = 0; i < n; i++) {
    covariance += (a[i] - meanA) * (idx[i] - meanIdx);
    varianceIdx += (idx[i] - meanIdx) ** 2;
  }
  covariance /= n - 1;
  varianceIdx /= n - 1;

  if (varianceIdx === 0) return 1;
  return covariance / varianceIdx;
}

export function max(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, v), -Infinity);
}

export function min(values: number[]): number {
  return values.reduce((m, v) => Math.min(m, v), Infinity);
}
