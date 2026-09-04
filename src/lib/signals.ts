/**
 * Signal vocabulary for the Attention Engine.
 *
 * A "signal" is one piece of evidence that a stock deserves review. The
 * scoring engine never emits a bare number without an accompanying
 * human-readable reason — see docs/product-thesis.md, section "Attention
 * score must show its work".
 */

export type SignalType =
  | "price"
  | "volume"
  | "relative"
  | "event"
  | "sentiment"
  | "freshness";

export type Confidence = "low" | "medium" | "high";

export interface Signal {
  type: SignalType;
  /** Points already scaled to this category's max weight (see WEIGHTS). */
  score: number;
  label: string;
  value: string;
  description: string;
  confidence: Confidence;
}

export type Severity = "high" | "medium" | "low" | "none";

export type ChangeState = "new" | "updated" | "acknowledged" | "resolved";

export type FreshnessState = "fresh" | "delayed" | "stale" | "unavailable";

export function classifyFreshness(capturedAt: Date | null, now: Date): FreshnessState {
  if (!capturedAt) return "unavailable";
  const ageMinutes = (now.getTime() - capturedAt.getTime()) / 60000;
  if (ageMinutes < 5) return "fresh";
  if (ageMinutes < 30) return "delayed";
  return "stale";
}

export function classifyVolumeRatio(ratio: number): "normal" | "elevated" | "significant" | "exceptional" {
  if (ratio < 1.25) return "normal";
  if (ratio < 1.75) return "elevated";
  if (ratio < 2.5) return "significant";
  return "exceptional";
}

export function describeParticipation(priceUp: boolean, volumeHigh: boolean): string {
  if (priceUp && volumeHigh) return "Strong upward participation";
  if (!priceUp && volumeHigh) return "Strong selling participation";
  if (priceUp && !volumeHigh) return "Weak or unconfirmed move";
  return "Weak or potentially low-conviction decline";
}

/** Event-type significance, used to weight the event signal. */
export const EVENT_SIGNIFICANCE: Record<string, Confidence> = {
  board_meeting: "high",
  credit_rating: "high",
  strategic_event: "high", // merger / acquisition
  corporate_action: "medium", // record date, dividend, bonus, split
  management_change: "medium",
  investor_meet: "low",
  general_update: "low",
};
