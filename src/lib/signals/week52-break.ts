import { Signal, tierFromSubScore } from "./types";

/** Binary signals fire at a fixed sub-score (plan §5: "e.g. 70") rather than a scaled one. */
const BINARY_SUB_SCORE = 70;

export interface Week52BreakInput {
  symbol: string;
  price: number;
  high52w: number;
  low52w: number;
}

export function week52BreakSignal(input: Week52BreakInput): Signal | null {
  const { symbol, price, high52w, low52w } = input;

  if (price >= high52w) {
    return {
      // plan §5 WEIGHTS comment: "event: 0.20 // event covers filing / 52w / gap"
      category: "event",
      type: "week52_break",
      subScore: BINARY_SUB_SCORE,
      tier: tierFromSubScore(BINARY_SUB_SCORE),
      message: `${symbol} reached a new 52-week high (${price.toFixed(2)}).`,
      triggerMetric: "price_vs_high52w",
    };
  }

  if (price <= low52w) {
    return {
      // plan §5 WEIGHTS comment: "event: 0.20 // event covers filing / 52w / gap"
      category: "event",
      type: "week52_break",
      subScore: BINARY_SUB_SCORE,
      tier: tierFromSubScore(BINARY_SUB_SCORE),
      message: `${symbol} fell to a new 52-week low (${price.toFixed(2)}).`,
      triggerMetric: "price_vs_low52w",
    };
  }

  return null;
}
