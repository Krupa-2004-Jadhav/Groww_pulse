import { Signal, tierFromSubScore } from "./types";

const THRESHOLD_PP = 1.5; // percentage points
const CEILING_PP = 8.0;

export interface RelativePerformanceInput {
  symbol: string;
  stockReturn: number; // fraction, e.g. 0.02
  benchmarkReturn: number; // fraction
  benchmarkLabel: string; // e.g. "the S&P 500" or "its sector"
}

/** Stock return vs. benchmark, in percentage points — raw performance, not residual (that's price-move's job). */
export function relativePerformanceSignal(input: RelativePerformanceInput): Signal | null {
  const { symbol, stockReturn, benchmarkReturn, benchmarkLabel } = input;
  const relativePp = (stockReturn - benchmarkReturn) * 100;
  const absPp = Math.abs(relativePp);

  if (absPp < THRESHOLD_PP) return null;

  const subScore = Math.min(100, ((absPp - THRESHOLD_PP) / (CEILING_PP - THRESHOLD_PP)) * 100);
  const verb = relativePp >= 0 ? "outperformed" : "underperformed";

  return {
    category: "relative",
    type: "relative_perf",
    ratio: relativePp,
    subScore,
    tier: tierFromSubScore(subScore),
    message: `${symbol} ${verb} ${benchmarkLabel} by ${absPp.toFixed(1)} percentage points.`,
    triggerMetric: "relative_pp",
    triggerThreshold: THRESHOLD_PP,
  };
}
