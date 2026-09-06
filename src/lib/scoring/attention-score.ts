import { Signal, Tier } from "@/lib/signals/types";

/**
 * Plan §5 weights — sum to 1.0, which is what lets the weighted sum below
 * auto-cap at 100 without an artificial clamp (each category contributes
 * at most weight×100, and weights sum to 1).
 */
const WEIGHTS: Record<string, number> = {
  price: 0.3,
  volatility: 0.15,
  volume: 0.2,
  relative: 0.15,
  event: 0.2, // covers filing / 52w break / gap
};

const AGREEMENT_FIRED_THRESHOLD = 40; // a signal counts toward the agreement multiplier once its own sub-score clears this

export interface AttentionResult {
  score: number;
  tier: Tier;
  reason: string;
}

/**
 * Weighted-sum-of-sub-scores plus an agreement multiplier (plan §5,
 * "the corrected model"). Deliberately NOT a naive sum-then-clamp: the
 * weights already sum to 1.0, so the base score is self-limiting, and the
 * multiplier is the only reason `Math.min(100, ...)` is needed at all —
 * it rewards genuine cross-signal corroboration (three moderate,
 * independent signals agreeing is more trustworthy than one strong one)
 * without letting mediocre signals alone fake a strong score.
 */
export function attentionScore(signals: Signal[]): AttentionResult {
  let base = 0;
  for (const s of signals) {
    base += (WEIGHTS[s.category] ?? 0) * s.subScore;
  }

  const fired = signals.filter((s) => s.subScore > AGREEMENT_FIRED_THRESHOLD).length;
  let mult = 1.0;
  if (fired >= 3) mult = 1.15;
  else if (fired === 2) mult = 1.05;

  const score = Math.min(100, base * mult);
  const tier: Tier = score >= 70 ? "high" : score >= 40 ? "medium" : "low";

  return { score, tier, reason: buildReason(signals) };
}

/**
 * The plain-English "why" = the top 2-3 contributing signals' own messages,
 * concatenated verbatim — nothing invented, nothing summarized by an LLM
 * (plan §5, §0.5). A signal with subScore 0 never contributes text, even if
 * it's in the input array — it clearly didn't fire.
 */
function buildReason(signals: Signal[]): string {
  const contributing = signals.filter((s) => s.subScore > 0);
  const top = [...contributing].sort((a, b) => b.subScore - a.subScore).slice(0, 3);
  return top.map((s) => s.message).join(" ");
}
