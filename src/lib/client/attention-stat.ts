/**
 * Pure logic for the AttentionStat highlight decision — kept separate from
 * the component so it's testable without a DOM (Vitest's plain "node"
 * environment), and reusable by both the briefing feed's StoryCard and the
 * stock detail screen's signal breakdown panel.
 *
 * Threshold derivation: the spec calls out raw per-signal-type thresholds
 * (z-score >= 2, volume ratio >= 1.75x) as "materiality." Rather than
 * hand-coding a per-type raw-metric check here (which would duplicate the
 * threshold logic already living in each signal function, and drift from
 * it over time), this reuses subScore — already normalized to 0-100 by
 * those same functions — with a single cutoff derived from the z-score
 * case: subScoreFromZ(2) = min(100, (2/4)*100) = 50. One consistent bar
 * across signal types, traceable to the same "2 sigma" intuition the spec
 * describes, rather than a second, independently-tuned threshold per type.
 */
export const HIGHLIGHT_SUBSCORE_THRESHOLD = 50;

export type Direction = "positive" | "negative" | "unusual" | "neutral";

export interface AttentionStatLike {
  subScore: number;
  zscore?: number;
  ratio?: number;
  type: string;
  message: string;
}

/** Whether this signal clears the materiality bar for the bordered stat-card treatment. */
export function isHighlightWorthy(signal: AttentionStatLike): boolean {
  return signal.subScore >= HIGHLIGHT_SUBSCORE_THRESHOLD;
}

/** Given a list of signals, only the single highest-subScore one is the "primary" stat — the spec's "single most significant stat" rule. Ties broken by array order (first wins). */
export function primarySignal<T extends AttentionStatLike>(signals: T[]): T | null {
  if (signals.length === 0) return null;
  return signals.reduce((best, s) => (s.subScore > best.subScore ? s : best), signals[0]);
}

/**
 * Direction drives color: green/red are directional (price, relative
 * performance — signed via zscore/ratio), amber is reserved for signals
 * that are "unusual" but not inherently good/bad (volume, volatility —
 * high volume on its own isn't positive or negative), matching plan §9's
 * "amber = unusual, a third state, not a shade between green/red."
 */
export function directionOf(signal: AttentionStatLike): Direction {
  if (signal.type === "price_move" || signal.type === "gap" || signal.type === "relative_perf") {
    const v = signal.zscore ?? signal.ratio ?? 0;
    if (v > 0) return "positive";
    if (v < 0) return "negative";
    return "neutral";
  }
  if (signal.type === "week52_break") {
    // Binary signal — plan §4's week52BreakSignal sets no zscore/ratio, so
    // the only place the direction lives is the message text itself
    // ("...52-week high" vs "...52-week low"). A caught-and-fixed instance
    // of the same class of bug as the ReplayProvider anchor mismatches:
    // this fell back to always-positive before the message check was added.
    return signal.message.toLowerCase().includes("low") ? "negative" : "positive";
  }
  // volume_surge, vol_expansion, filing_* — a magnitude, not a sign.
  return "unusual";
}
