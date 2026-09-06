import { Signal, tierFromSubScore } from "./types";

const BINARY_SUB_SCORE = 70;

export type FilingEventType = "earnings" | "split" | "dividend";

export interface FilingEventInput {
  symbol: string;
  type: FilingEventType;
  date: Date;
  epsSurprisePct?: number | null; // earnings only
}

/**
 * Structured, dated corporate events from Twelve Data's /earnings, /splits,
 * /dividends — deterministic type-match into a category, per plan §5's
 * explicit "no NLP, no free-text news" instruction. The caller is
 * responsible for only invoking this once per event actually within the
 * user's since-last-visit window; this function itself has no null case
 * because a structured, dated event that occurred is unconditionally
 * reportable.
 */
export function filingEventSignal(input: FilingEventInput): Signal {
  const { symbol, type, date, epsSurprisePct } = input;
  const dateLabel = date.toISOString().slice(0, 10);

  let message: string;
  if (type === "earnings") {
    if (epsSurprisePct !== undefined && epsSurprisePct !== null) {
      const direction = epsSurprisePct >= 0 ? "beat" : "missed";
      message = `${symbol} reported earnings on ${dateLabel}, ${direction} EPS estimates by ${Math.abs(epsSurprisePct).toFixed(1)}%.`;
    } else {
      message = `${symbol} reported earnings on ${dateLabel}.`;
    }
  } else if (type === "split") {
    message = `${symbol} executed a stock split effective ${dateLabel}.`;
  } else {
    message = `${symbol} went ex-dividend on ${dateLabel}.`;
  }

  return {
    category: "event",
    type: `filing_${type}`,
    subScore: BINARY_SUB_SCORE,
    tier: tierFromSubScore(BINARY_SUB_SCORE),
    message,
    triggerMetric: "filing_type",
  };
}
