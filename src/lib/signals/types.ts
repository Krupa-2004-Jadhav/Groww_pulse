/**
 * Every signal function is `(quote, stats, window) -> Signal | null` — pure,
 * no I/O, trivially unit-testable (plan §6.4). `null` means the signal did
 * not fire; a returned Signal always carries a complete plain-English
 * sentence, per plan §0.5 ("no ML, no black boxes").
 */

export type SignalCategory = "price" | "volatility" | "volume" | "relative" | "event";
export type Tier = "low" | "medium" | "high";

export interface Signal {
  category: SignalCategory;
  type: string; // price_move | vol_expansion | volume_surge | relative_perf | week52_break | gap | filing
  zscore?: number;
  ratio?: number;
  subScore: number; // 0..100
  message: string;
  tier: Tier;
  /** Stored on symbol_events for Phase 6 reconciliation — what to re-check and against what. */
  triggerMetric?: string;
  triggerThreshold?: number;
}

/** MAX_Z ≈ 4 (plan §5): a 4-sigma residual maxes out a z-scored signal's sub-score. */
export const MAX_Z = 4;

export function subScoreFromZ(absZ: number): number {
  return Math.min(100, (absZ / MAX_Z) * 100);
}

export function tierFromSubScore(subScore: number): Tier {
  if (subScore >= 70) return "high";
  if (subScore >= 40) return "medium";
  return "low";
}
