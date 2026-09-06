import { Signal, subScoreFromZ, tierFromSubScore } from "./types";

const THRESHOLD_Z = 1.0;

export interface GapInput {
  symbol: string;
  dayOpen: number;
  prevClose: number;
  vol20d: number; // floored
}

/** Overnight gap between today's open and the prior close, scaled by the symbol's own volatility. */
export function gapSignal(input: GapInput): Signal | null {
  const { symbol, dayOpen, prevClose, vol20d } = input;
  if (prevClose <= 0) return null;

  const gapReturn = (dayOpen - prevClose) / prevClose;
  const z = gapReturn / vol20d;
  const absZ = Math.abs(z);

  if (absZ < THRESHOLD_Z) return null;

  const subScore = subScoreFromZ(absZ);
  const direction = gapReturn >= 0 ? "up" : "down";

  return {
    category: "price",
    type: "gap",
    zscore: z,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol} gapped ${direction} ${(Math.abs(gapReturn) * 100).toFixed(1)}% at the open versus the prior close.`,
    triggerMetric: "gap_z_score",
    triggerThreshold: THRESHOLD_Z,
  };
}
