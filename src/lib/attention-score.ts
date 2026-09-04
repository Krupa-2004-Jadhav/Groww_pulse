import {
  Signal,
  Severity,
  Confidence,
  classifyFreshness,
  classifyVolumeRatio,
  describeParticipation,
  EVENT_SIGNIFICANCE,
} from "./signals";

/**
 * MVP component weights (sum to 100). See docs/product-thesis.md section 3.
 * Each compute* function below returns points already scaled into its
 * category's share, so the final score is a plain sum, clamped to 100 —
 * matching the reference implementation in the strategy doc.
 */
export const WEIGHTS = {
  price: 30,
  volume: 20,
  relative: 15,
  event: 20,
  sentiment: 10,
  freshness: 5,
} as const;

const MIN_SENTIMENT_ARTICLES = 3;

// Noise floors: a move/shift below these is not "meaningful," it's normal
// day-to-day drift, and must score exactly 0 — not an infinitesimally small
// positive number. Without a hard floor, a continuous magnitude-based score
// never actually reaches zero, and nothing would ever land in "quiet."
const PRICE_FLOOR_PCT = 1.5;
const PRICE_CEILING_PCT = 8;
const RELATIVE_FLOOR_PP = 1.0;
const RELATIVE_CEILING_PP = 5;
const SENTIMENT_FLOOR = 0.05;
const SENTIMENT_CEILING = 0.6;

/** Scales `value` from [floor, ceiling] to [0, 1], clamping below floor to exactly 0. */
function deadzoneMagnitude(value: number, floor: number, ceiling: number): number {
  return clamp((value - floor) / (ceiling - floor), 0, 1);
}

export interface PriceInput {
  lastSeenPrice: number | null;
  currentPrice: number;
  volatility5d: number;
  volatility30d: number;
}

export function computePriceSignal({ lastSeenPrice, currentPrice, volatility5d, volatility30d }: PriceInput): Signal {
  if (lastSeenPrice === null) {
    return {
      type: "price",
      score: 0,
      label: "Price move",
      value: "—",
      description: "No prior checkpoint to compare against",
      confidence: "low",
    };
  }

  const pctChange = ((currentPrice - lastSeenPrice) / lastSeenPrice) * 100;
  const volatilityExpansion = volatility30d > 0 ? volatility5d / volatility30d : 1;
  // A move during unusually high volatility carries more weight, capped so
  // a single noisy day can't dominate the score.
  const volatilityMultiplier = Math.min(1.5, Math.max(1, volatilityExpansion));

  // Below 1.5% is normal drift and scores 0; 8% since-last-visit maxes out
  // the category for an MVP threshold — tune per-instrument via
  // WatchlistPreferences.priceThresholdPct later.
  const magnitude = deadzoneMagnitude(Math.abs(pctChange), PRICE_FLOOR_PCT, PRICE_CEILING_PCT) * volatilityMultiplier;
  const score = clamp(magnitude * WEIGHTS.price, 0, WEIGHTS.price);

  const direction = pctChange >= 0 ? "+" : "";
  const volatilityNote =
    volatilityExpansion > 1.3 ? ` Volatility increased ${volatilityExpansion.toFixed(1)}x versus its recent baseline.` : "";

  return {
    type: "price",
    score,
    label: "Price move",
    value: `${direction}${pctChange.toFixed(1)}%`,
    description: `Since your last visit.${volatilityNote}`,
    confidence: score > WEIGHTS.price * 0.5 ? "high" : score > 0 ? "medium" : "low",
  };
}

export interface VolumeInput {
  volume: number;
  avgVolume20d: number;
  priceChangePct: number;
}

export function computeVolumeSignal({ volume, avgVolume20d, priceChangePct }: VolumeInput): Signal {
  if (avgVolume20d <= 0) {
    return {
      type: "volume",
      score: 0,
      label: "Volume",
      value: "—",
      description: "No baseline available",
      confidence: "low",
    };
  }

  const ratio = volume / avgVolume20d;
  const band = classifyVolumeRatio(ratio);
  const bandFraction = { normal: 0, elevated: 0.4, significant: 0.7, exceptional: 1 }[band];
  const score = bandFraction * WEIGHTS.volume;

  const participation = describeParticipation(priceChangePct >= 0, ratio >= 1.75);

  return {
    type: "volume",
    score,
    label: band === "normal" ? "Volume" : "Unusual volume",
    value: `${ratio.toFixed(1)}x`,
    description: `Compared with 20-day average. ${participation}.`,
    confidence: band === "exceptional" ? "high" : band === "significant" ? "medium" : "low",
  };
}

export interface RelativeInput {
  stockReturnPct: number;
  benchmarkReturnPct: number;
  benchmarkLabel: string;
}

export function computeRelativeSignal({ stockReturnPct, benchmarkReturnPct, benchmarkLabel }: RelativeInput): Signal {
  const relative = stockReturnPct - benchmarkReturnPct;
  // Below 1pp of relative performance is noise; 5pp maxes out the category.
  const score = deadzoneMagnitude(Math.abs(relative), RELATIVE_FLOOR_PP, RELATIVE_CEILING_PP) * WEIGHTS.relative;
  const verb = relative >= 0 ? "outperformed" : "underperformed";

  return {
    type: "relative",
    score,
    label: "Relative performance",
    value: `${relative >= 0 ? "+" : ""}${relative.toFixed(1)}pp`,
    description: `${verb} ${benchmarkLabel} by ${Math.abs(relative).toFixed(1)} percentage points`,
    confidence: score > WEIGHTS.relative * 0.5 ? "high" : score > 0 ? "medium" : "low",
  };
}

export interface EventLike {
  eventType: string;
  title: string;
  sourceUrl: string;
  publishedAt: Date;
  confidence: Confidence;
}

export function computeEventSignal(eventsSinceLastSeen: EventLike[]): Signal {
  if (eventsSinceLastSeen.length === 0) {
    return {
      type: "event",
      score: 0,
      label: "Corporate event",
      value: "None",
      description: "No new filings since your last visit",
      confidence: "low",
    };
  }

  const significanceRank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const top = [...eventsSinceLastSeen].sort(
    (a, b) =>
      (significanceRank[EVENT_SIGNIFICANCE[b.eventType] ?? "low"] ?? significanceRank[b.confidence]) -
      (significanceRank[EVENT_SIGNIFICANCE[a.eventType] ?? "low"] ?? significanceRank[a.confidence])
  )[0];

  const significance = EVENT_SIGNIFICANCE[top.eventType] ?? "low";
  const fraction = { high: 1, medium: 0.6, low: 0.3 }[significance];

  return {
    type: "event",
    score: fraction * WEIGHTS.event,
    label: "New company event",
    value: top.title,
    description: `Published ${top.publishedAt.toLocaleString()}`,
    confidence: significance,
  };
}

export interface SentimentInput {
  currentScore: number | null;
  previousScore: number | null;
  articleCount: number;
}

export function computeSentimentSignal({ currentScore, previousScore, articleCount }: SentimentInput): Signal {
  if (currentScore === null || previousScore === null || articleCount < MIN_SENTIMENT_ARTICLES) {
    return {
      type: "sentiment",
      score: 0,
      label: "Sentiment",
      value: "Insufficient coverage",
      description:
        articleCount === 0
          ? "No meaningful coverage detected"
          : `Only ${articleCount} article(s) — below the ${MIN_SENTIMENT_ARTICLES}-article confidence floor`,
      confidence: "low",
    };
  }

  const shift = currentScore - previousScore;
  const score = deadzoneMagnitude(Math.abs(shift), SENTIMENT_FLOOR, SENTIMENT_CEILING) * WEIGHTS.sentiment;
  const direction = label(currentScore) === label(previousScore) ? label(currentScore) : `${label(previousScore)} to ${label(currentScore)}`;

  return {
    type: "sentiment",
    score,
    label: "Sentiment shift",
    value: `${shift >= 0 ? "+" : ""}${shift.toFixed(2)}`,
    description: `Sentiment shifted from ${direction} across ${articleCount} articles`,
    confidence: score > WEIGHTS.sentiment * 0.5 ? "high" : score > 0 ? "medium" : "low",
  };

  function label(s: number) {
    if (s > 0.15) return "positive";
    if (s < -0.15) return "negative";
    return "neutral";
  }
}

export function computeFreshnessSignal(capturedAt: Date | null, now: Date): Signal {
  const state = classifyFreshness(capturedAt, now);
  const fraction = { fresh: 1, delayed: 0.6, stale: 0.2, unavailable: 0 }[state];
  const ageMinutes = capturedAt ? Math.round((now.getTime() - capturedAt.getTime()) / 60000) : null;

  return {
    type: "freshness",
    score: fraction * WEIGHTS.freshness,
    label: "Data freshness",
    value: state,
    description:
      ageMinutes === null ? "No data available" : ageMinutes < 1 ? "Updated moments ago" : `Updated ${ageMinutes} min ago`,
    confidence: state === "fresh" ? "high" : state === "delayed" ? "medium" : "low",
  };
}

/** Matches the reference implementation: sum of pre-weighted signal scores, clamped to 100. */
export function calculateAttentionScore(signals: Signal[]): number {
  return clamp(
    signals.reduce((total, signal) => total + signal.score, 0),
    0,
    100
  );
}

/**
 * Freshness is a modifier, not evidence of change — a perfectly quiet stock
 * still has "fresh" data. "Core" signals are the five that can actually
 * indicate something happened since the user's last visit.
 */
export function coreSignalScore(signals: Signal[]): number {
  return signals.filter((s) => s.type !== "freshness").reduce((total, s) => total + s.score, 0);
}

/**
 * Severity distinguishes "nothing happened" (no core evidence at all — the
 * quiet section) from "something happened, however small" (shown as a
 * low-attention/information-only story, e.g. a new filing with no price
 * move) from stories that clearly warrant review.
 */
export function classifySeverity(attentionScore: number, coreScore: number): Severity {
  if (coreScore <= 0.5) return "none";
  if (attentionScore >= 60) return "high";
  if (attentionScore >= 30) return "medium";
  return "low";
}

/** "Signal agreement": how many independent, substantive categories fired (freshness doesn't count). */
export function countEvidence(signals: Signal[]): number {
  return signals.filter((s) => s.type !== "freshness" && s.score > 0).length;
}

export function overallConfidence(signals: Signal[]): Confidence {
  const evidence = countEvidence(signals);
  if (evidence >= 3) return "high";
  if (evidence === 2) return "medium";
  return "low";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
