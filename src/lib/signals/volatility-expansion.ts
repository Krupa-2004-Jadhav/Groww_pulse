import { Signal, tierFromSubScore } from "./types";

const THRESHOLD_RATIO = 1.3;
const MAX_RATIO = 3.0; // a 3x expansion over baseline maxes out the sub-score

export interface VolatilityExpansionInput {
  symbol: string;
  /** Short-window (e.g. 5-day) stddev of returns. */
  recentVol: number;
  /** Floored 20-day baseline stddev of returns. */
  vol20d: number;
}

/** Fires when recent short-window volatility has meaningfully expanded vs. the 20-day baseline. */
export function volatilityExpansionSignal(input: VolatilityExpansionInput): Signal | null {
  const { symbol, recentVol, vol20d } = input;
  const ratio = recentVol / vol20d;

  if (ratio < THRESHOLD_RATIO) return null;

  const subScore = Math.min(100, ((ratio - 1) / (MAX_RATIO - 1)) * 100);

  return {
    category: "volatility",
    type: "vol_expansion",
    ratio,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol}'s short-term volatility is ${ratio.toFixed(1)}x its recent baseline.`,
    triggerMetric: "vol_ratio",
    triggerThreshold: THRESHOLD_RATIO,
  };
}
