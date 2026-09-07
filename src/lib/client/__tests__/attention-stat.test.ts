import { describe, it, expect } from "vitest";
import { isHighlightWorthy, primarySignal, directionOf, HIGHLIGHT_SUBSCORE_THRESHOLD } from "../attention-stat";

function signal(overrides: Partial<Parameters<typeof isHighlightWorthy>[0] & { message: string }>) {
  return { subScore: 0, type: "price_move", message: "test.", ...overrides };
}

describe("isHighlightWorthy (Stock Detail screen, materiality threshold)", () => {
  it("a signal at or above the threshold is highlight-worthy", () => {
    expect(isHighlightWorthy(signal({ subScore: HIGHLIGHT_SUBSCORE_THRESHOLD }))).toBe(true);
    expect(isHighlightWorthy(signal({ subScore: 90 }))).toBe(true);
  });

  it("a signal below the threshold is not", () => {
    expect(isHighlightWorthy(signal({ subScore: HIGHLIGHT_SUBSCORE_THRESHOLD - 0.1 }))).toBe(false);
    expect(isHighlightWorthy(signal({ subScore: 10 }))).toBe(false);
  });
});

describe("primarySignal", () => {
  it("picks the single highest-subScore signal", () => {
    const signals = [signal({ subScore: 30 }), signal({ subScore: 80 }), signal({ subScore: 55 })];
    expect(primarySignal(signals)?.subScore).toBe(80);
  });

  it("returns null for an empty list", () => {
    expect(primarySignal([])).toBeNull();
  });
});

describe("directionOf", () => {
  it("price_move: positive zscore -> positive, negative -> negative", () => {
    expect(directionOf(signal({ type: "price_move", zscore: 2.2 }))).toBe("positive");
    expect(directionOf(signal({ type: "price_move", zscore: -2.2 }))).toBe("negative");
  });

  it("relative_perf uses ratio (percentage points), same sign convention", () => {
    expect(directionOf(signal({ type: "relative_perf", ratio: 3.1 }))).toBe("positive");
    expect(directionOf(signal({ type: "relative_perf", ratio: -3.1 }))).toBe("negative");
  });

  it("week52_break has no zscore/ratio at all — direction must come from the message text", () => {
    expect(directionOf(signal({ type: "week52_break", message: "AAPL reached a new 52-week high (150.00)." }))).toBe("positive");
    expect(directionOf(signal({ type: "week52_break", message: "AAPL fell to a new 52-week low (79.00)." }))).toBe("negative");
  });

  it("volume_surge and vol_expansion are magnitudes, not directional — always 'unusual'", () => {
    expect(directionOf(signal({ type: "volume_surge", ratio: 3.0 }))).toBe("unusual");
    expect(directionOf(signal({ type: "vol_expansion", ratio: 2.0 }))).toBe("unusual");
  });
});
