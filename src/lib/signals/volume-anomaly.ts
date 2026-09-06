import { Signal, tierFromSubScore } from "./types";

export type VolumeBand = "normal" | "elevated" | "significant" | "exceptional";

const BAND_FLOOR = 1.25; // below this, volume is unremarkable — no signal
const SCORE_CEILING_RATIO = 4.0; // ratio at/above which sub-score maxes out

export function classifyVolumeBand(ratio: number): VolumeBand {
  if (ratio < 1.25) return "normal";
  if (ratio < 1.75) return "elevated";
  if (ratio < 2.5) return "significant";
  return "exceptional";
}

export interface VolumeAnomalyInput {
  symbol: string;
  volume: number;
  avgVolume20d: number;
}

/**
 * Volume anomaly, banded and reported neutrally. Deliberately never
 * attributes a cause ("institutional buying", etc.) — plan §0.5 and §8:
 * high volume has many possible causes, and asserting one would be a
 * fabricated claim, not a measurement.
 */
export function volumeAnomalySignal(input: VolumeAnomalyInput): Signal | null {
  const { symbol, volume, avgVolume20d } = input;
  if (avgVolume20d <= 0) return null;

  const ratio = volume / avgVolume20d;
  if (ratio < BAND_FLOOR) return null;

  const band = classifyVolumeBand(ratio);
  const subScore = Math.min(100, ((ratio - BAND_FLOOR) / (SCORE_CEILING_RATIO - BAND_FLOOR)) * 100);

  return {
    category: "volume",
    type: "volume_surge",
    ratio,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol}'s trading volume is ${ratio.toFixed(1)}x its 20-day average — ${band} activity.`,
    triggerMetric: "volume_ratio",
    triggerThreshold: BAND_FLOOR,
  };
}
