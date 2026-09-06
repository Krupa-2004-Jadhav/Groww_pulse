import { describe, it, expect } from "vitest";
import { attentionScore } from "../attention-score";
import { Signal } from "@/lib/signals/types";

function sig(category: Signal["category"], subScore: number, message = `${category} moved.`): Signal {
  return { category, type: category, subScore, tier: "low", message };
}

describe("attentionScore (Phase 5, Test Gate 5)", () => {
  it("all-zero signals -> score ~0, tier low", () => {
    const result = attentionScore([sig("price", 0), sig("volume", 0)]);
    expect(result.score).toBeCloseTo(0, 5);
    expect(result.tier).toBe("low");
  });

  it("no signals at all -> score 0, tier low, empty reason", () => {
    const result = attentionScore([]);
    expect(result.score).toBe(0);
    expect(result.tier).toBe("low");
    expect(result.reason).toBe("");
  });

  it("one strong signal only -> moderate-high, but the agreement multiplier does NOT apply (only 1 fired)", () => {
    // price weight 0.30, subScore 100 -> base = 30. Only 1 signal fired (>40), so mult stays 1.0.
    const withoutOthers = attentionScore([sig("price", 100)]);
    expect(withoutOthers.score).toBeCloseTo(30, 5);

    // Confirm no multiplier was applied: same signal set scored via the raw formula (mult=1) matches exactly.
    expect(withoutOthers.score).toBe(0.3 * 100);
  });

  it("moderate signals across all 5 categories lift into 'high' via the agreement multiplier, though the un-multiplied base would not", () => {
    // All 5 weights sum to 1.0, so with every category firing at the same
    // sub-score x, base == x exactly. x=65 is comfortably "moderate" (well
    // under any single signal's own high-tier bar), and base=65 alone is
    // only 'medium' territory (< 70) -- but 5 independent signals agreeing
    // earns the 1.15x multiplier, which pushes 65 * 1.15 = 74.75 into 'high'.
    const x = 65;
    const signals = [sig("price", x), sig("volatility", x), sig("volume", x), sig("relative", x), sig("event", x)];
    const base = x; // weights sum to 1.0
    expect(base).toBeLessThan(70); // the un-multiplied base would only be 'medium'

    const result = attentionScore(signals);
    expect(result.score).toBeCloseTo(base * 1.15, 5);
    expect(result.tier).toBe("high");
  });

  it("exactly two fired signals get the smaller (1.05x) multiplier", () => {
    const signals = [sig("price", 60), sig("volume", 60)];
    const base = 0.3 * 60 + 0.2 * 60; // = 30
    const result = attentionScore(signals);
    expect(result.score).toBeCloseTo(base * 1.05, 5);
  });

  it("score never exceeds 100 even with the multiplier pushing past it", () => {
    const signals = [sig("price", 100), sig("volatility", 100), sig("volume", 100), sig("relative", 100), sig("event", 100)];
    // base = 100 (weights sum to 1.0), mult = 1.15 -> raw 115, must clamp to 100.
    const result = attentionScore(signals);
    expect(result.score).toBe(100);
  });

  it("the generated reason references only signals that actually fired (subScore > 0)", () => {
    const signals = [
      sig("price", 80, "AAPL moved sharply."),
      sig("volume", 0, "AAPL volume unremarkable."), // did not fire
      sig("event", 60, "AAPL reported earnings."),
    ];
    const result = attentionScore(signals);
    expect(result.reason).toContain("AAPL moved sharply.");
    expect(result.reason).toContain("AAPL reported earnings.");
    expect(result.reason).not.toContain("volume unremarkable");
  });

  it("the reason includes at most the top 3 contributing signals, ranked by sub-score", () => {
    const signals = [
      sig("price", 90, "highest."),
      sig("event", 80, "second."),
      sig("volume", 70, "third."),
      sig("relative", 60, "fourth, should be excluded."),
    ];
    const result = attentionScore(signals);
    expect(result.reason).toContain("highest.");
    expect(result.reason).toContain("second.");
    expect(result.reason).toContain("third.");
    expect(result.reason).not.toContain("fourth");
  });
});
