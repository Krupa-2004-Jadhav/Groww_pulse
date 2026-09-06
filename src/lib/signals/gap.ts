import { Signal, subScoreFromZ, tierFromSubScore } from "./types";
import { MIN_VOLATILITY } from "@/lib/stats/math";

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
  const safeVol20d = Math.max(MIN_VOLATILITY, vol20d);
  const z = gapReturn / safeVol20d;
  const absZ = Math.abs(z);

  if (absZ < THRESHOLD_Z) return null;

  const subScore = subScoreFromZ(absZ);
  const direction = gapReturn >= 0 ? "up" : "down";

  return {
    // plan §5 WEIGHTS comment: "event: 0.20 // event covers filing / 52w / gap"
    category: "event",
    type: "gap",
    zscore: z,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol} gapped ${direction} ${(Math.abs(gapReturn) * 100).toFixed(1)}% at the open versus the prior close.`,
    triggerMetric: "gap_z_score",
    triggerThreshold: THRESHOLD_Z,
  };
}
