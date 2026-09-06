import { describe, it, expect } from "vitest";
import { computeAdjustmentFactors } from "../adjust";
import { SplitEvent } from "@/lib/providers";

describe("computeAdjustmentFactors (Phase 3, Test Gate 3 — split handling)", () => {
  it("bars before a split get the split's price ratio; bars after get 1.0", () => {
    const splitDate = new Date("2026-06-15T00:00:00Z");
    const split: SplitEvent = {
      symbol: "TEST",
      date: splitDate,
      fromFactor: 4,
      toFactor: 1,
      description: "4-for-1 split",
    };

    const dates = [
      new Date("2026-06-10T00:00:00Z"), // before
      new Date("2026-06-14T00:00:00Z"), // before
      new Date("2026-06-15T00:00:00Z"), // on the split date itself -> already adjusted by provider, factor 1.0
      new Date("2026-06-16T00:00:00Z"), // after
    ];

    const factors = computeAdjustmentFactors(dates, [split]);
    expect(factors).toEqual([0.25, 0.25, 1, 1]);
  });

  it("produces a continuous adjusted-close series across the split — no fake -75% crash", () => {
    // Realistic fixture: AAPL-style 4-for-1 split. Raw closes jump from
    // ~500 to ~125 because Twelve Data's raw historical bars are
    // unadjusted; the adjustment factor must erase that jump.
    const splitDate = new Date("2026-06-15T00:00:00Z");
    const split: SplitEvent = { symbol: "TEST", date: splitDate, fromFactor: 4, toFactor: 1, description: "4-for-1" };

    const rawBars = [
      { date: new Date("2026-06-12T00:00:00Z"), close: 498 },
      { date: new Date("2026-06-13T00:00:00Z"), close: 502 },
      { date: new Date("2026-06-15T00:00:00Z"), close: 126 }, // post-split raw price
      { date: new Date("2026-06-16T00:00:00Z"), close: 128 },
    ];

    const factors = computeAdjustmentFactors(
      rawBars.map((b) => b.date),
      [split]
    );
    const adjustedCloses = rawBars.map((b, i) => b.close * factors[i]);

    // Naive (unadjusted) day-over-day return across the split would be a
    // fabricated ~-75% crash: (126 - 502) / 502 ≈ -0.749.
    const naiveReturn = (rawBars[2].close - rawBars[1].close) / rawBars[1].close;
    expect(naiveReturn).toBeLessThan(-0.7);

    // Adjusted return across the same boundary must be small and realistic.
    const adjustedReturn = (adjustedCloses[2] - adjustedCloses[1]) / adjustedCloses[1];
    expect(Math.abs(adjustedReturn)).toBeLessThan(0.05);
  });

  it("no splits -> every factor is 1.0", () => {
    const dates = [new Date("2026-01-01"), new Date("2026-01-02")];
    expect(computeAdjustmentFactors(dates, [])).toEqual([1, 1]);
  });

  it("multiple splits compound for bars before both", () => {
    const dates = [new Date("2025-01-01")];
    const splits: SplitEvent[] = [
      { symbol: "TEST", date: new Date("2025-06-01"), fromFactor: 2, toFactor: 1, description: "2-for-1" },
      { symbol: "TEST", date: new Date("2025-12-01"), fromFactor: 3, toFactor: 1, description: "3-for-1" },
    ];
    // A bar before both splits is adjusted by both: 0.5 * (1/3) = 1/6.
    expect(computeAdjustmentFactors(dates, splits)[0]).toBeCloseTo(1 / 6, 10);
  });
});
