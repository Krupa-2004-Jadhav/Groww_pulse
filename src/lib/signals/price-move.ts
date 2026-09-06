import { Signal, subScoreFromZ, tierFromSubScore } from "./types";
import { MIN_VOLATILITY } from "@/lib/stats/math";

const THRESHOLD_Z = 1.0;

export interface PriceMoveInput {
  symbol: string;
  /** Return over the window (e.g. since last visit), as a fraction (0.02 = +2%). */
  actualReturn: number;
  /** Benchmark/index return over the same window, as a fraction. */
  indexReturn: number;
  beta: number;
  /** Floored daily vol_20d (stddev of daily returns). */
  vol20d: number;
  /** Trading days spanned by the window — vol scales by sqrt(days) under a random-walk assumption. */
  windowTradingDays: number;
  windowLabel: string; // e.g. "since your last visit"
}

/**
 * Market-adjusted price-move signal: residual = actualReturn − beta×indexReturn,
 * z = residual / (vol_20d × √windowDays). Fires only on the RESIDUAL, not
 * the raw move — a stock that moved exactly in line with its beta during a
 * market-wide selloff produces residual ≈ 0 and no signal, even if the raw
 * headline number looks dramatic. That's the market-adjustment property
 * Test Gate 4 checks directly.
 */
export function priceMoveSignal(input: PriceMoveInput): Signal | null {
  const { symbol, actualReturn, indexReturn, beta, vol20d, windowTradingDays, windowLabel } = input;

  const residual = actualReturn - beta * indexReturn;
  // Defense in depth: rollup.ts already floors vol_20d before storing it,
  // but this function floors again rather than trusting every caller —
  // a zero/negative vol20d must never reach a division below.
  const safeVol20d = Math.max(MIN_VOLATILITY, vol20d);
  const windowVol = safeVol20d * Math.sqrt(Math.max(1, windowTradingDays));
  const z = residual / windowVol;
  const absZ = Math.abs(z);

  if (absZ < THRESHOLD_Z) return null;

  const subScore = subScoreFromZ(absZ);
  const direction = residual >= 0 ? "up" : "down";
  const pct = (Math.abs(actualReturn) * 100).toFixed(1);

  return {
    category: "price",
    type: "price_move",
    zscore: z,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol} moved ${direction} ${pct}% ${windowLabel}, ${absZ.toFixed(1)} standard deviations from its market-adjusted baseline.`,
    triggerMetric: "z_score",
    triggerThreshold: THRESHOLD_Z,
  };
}
