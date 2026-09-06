import { describe, it, expect } from "vitest";
import { dailyReturns, mean, stddev, flooredVol20d, beta, MIN_VOLATILITY, max, min } from "../math";

describe("math — pure statistics (Phase 3, Test Gate 3)", () => {
  it("dailyReturns computes simple percentage returns", () => {
    expect(dailyReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it("mean and stddev match a hand-computed fixture", () => {
    // Fixture: returns = [0.01, -0.02, 0.03, 0.00, -0.01]
    // mean = (0.01 - 0.02 + 0.03 + 0.00 - 0.01) / 5 = 0.002
    // sample variance = sum((x-mean)^2) / (n-1)
    const returns = [0.01, -0.02, 0.03, 0.0, -0.01];
    expect(mean(returns)).toBeCloseTo(0.002, 10);

    const expectedVariance =
      ((0.01 - 0.002) ** 2 + (-0.02 - 0.002) ** 2 + (0.03 - 0.002) ** 2 + (0.0 - 0.002) ** 2 + (-0.01 - 0.002) ** 2) / 4;
    expect(stddev(returns)).toBeCloseTo(Math.sqrt(expectedVariance), 10);
  });

  it("illiquid fixture (all-identical closes -> zero variance) floors vol_20d instead of producing 0/NaN", () => {
    const closes = Array(21).fill(50); // flat price, zero real volatility
    const returns = dailyReturns(closes);
    expect(stddev(returns)).toBe(0);
    expect(flooredVol20d(returns)).toBe(MIN_VOLATILITY);
    expect(Number.isFinite(flooredVol20d(returns))).toBe(true);
  });

  it("empty/short series never produces NaN", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([0.01])).toBe(0);
    expect(flooredVol20d([])).toBe(MIN_VOLATILITY);
  });

  it("beta of a series against itself is 1", () => {
    const returns = [0.01, -0.02, 0.03, 0.015, -0.01, 0.02];
    expect(beta(returns, returns)).toBeCloseTo(1, 10);
  });

  it("beta on a hand-computed fixture", () => {
    // asset moves exactly 2x the index every period -> beta = 2
    const index = [0.01, -0.01, 0.02, -0.02];
    const asset = index.map((r) => r * 2);
    expect(beta(asset, index)).toBeCloseTo(2, 10);
  });

  it("beta falls back to 1 when the index has zero variance (edge case, not a real market)", () => {
    const index = [0, 0, 0, 0];
    const asset = [0.01, -0.02, 0.03, -0.01];
    expect(beta(asset, index)).toBe(1);
  });

  it("max/min match hand-computed fixture", () => {
    expect(max([3, 7, 2, 9, 4])).toBe(9);
    expect(min([3, 7, 2, 9, 4])).toBe(2);
  });
});
