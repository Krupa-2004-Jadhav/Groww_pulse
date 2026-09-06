import { describe, it, expect } from "vitest";
import { volatilityExpansionSignal } from "../volatility-expansion";
import { volumeAnomalySignal, classifyVolumeBand } from "../volume-anomaly";
import { relativePerformanceSignal } from "../relative-performance";
import { week52BreakSignal } from "../week52-break";
import { gapSignal } from "../gap";
import { filingEventSignal } from "../filing-event";

describe("volatilityExpansionSignal (Phase 4, Test Gate 4)", () => {
  it("fires when recent vol meaningfully exceeds the 20-day baseline", () => {
    const signal = volatilityExpansionSignal({ symbol: "X", recentVol: 0.03, vol20d: 0.01 });
    expect(signal).not.toBeNull();
    expect(signal!.ratio).toBeCloseTo(3, 5);
  });

  it("does not fire when recent vol is close to baseline", () => {
    expect(volatilityExpansionSignal({ symbol: "X", recentVol: 0.011, vol20d: 0.01 })).toBeNull();
  });
});

describe("volumeAnomalySignal (Phase 4, Test Gate 4)", () => {
  it("3x volume bands as 'exceptional' and the message makes no causal claim", () => {
    expect(classifyVolumeBand(3)).toBe("exceptional");

    const signal = volumeAnomalySignal({ symbol: "X", volume: 3_000_000, avgVolume20d: 1_000_000 });
    expect(signal).not.toBeNull();
    expect(signal!.message).toContain("exceptional");
    expect(signal!.message.toLowerCase()).not.toMatch(/institutional|buying|selling|because|due to/);
  });

  it("normal volume does not fire", () => {
    expect(volumeAnomalySignal({ symbol: "X", volume: 1_050_000, avgVolume20d: 1_000_000 })).toBeNull();
  });

  it("zero baseline volume (illiquid/new listing) does not throw or produce Infinity", () => {
    const signal = volumeAnomalySignal({ symbol: "X", volume: 1000, avgVolume20d: 0 });
    expect(signal).toBeNull();
  });

  it("band thresholds match the documented table", () => {
    expect(classifyVolumeBand(1.0)).toBe("normal");
    expect(classifyVolumeBand(1.5)).toBe("elevated");
    expect(classifyVolumeBand(2.0)).toBe("significant");
    expect(classifyVolumeBand(2.6)).toBe("exceptional");
  });
});

describe("relativePerformanceSignal (Phase 4, Test Gate 4)", () => {
  it("fires and reports percentage-point outperformance", () => {
    const signal = relativePerformanceSignal({
      symbol: "X",
      stockReturn: 0.05,
      benchmarkReturn: 0.01,
      benchmarkLabel: "the S&P 500",
    });
    expect(signal).not.toBeNull();
    expect(signal!.message).toMatch(/outperformed the S&P 500 by 4\.0 percentage points/);
  });

  it("small relative difference does not fire", () => {
    expect(
      relativePerformanceSignal({ symbol: "X", stockReturn: 0.01, benchmarkReturn: 0.009, benchmarkLabel: "its sector" })
    ).toBeNull();
  });
});

describe("week52BreakSignal (Phase 4, Test Gate 4)", () => {
  it("fires a fixed sub-score at a new 52-week high", () => {
    const signal = week52BreakSignal({ symbol: "X", price: 150, high52w: 150, low52w: 80 });
    expect(signal).not.toBeNull();
    expect(signal!.subScore).toBe(70);
    expect(signal!.message).toMatch(/52-week high/);
  });

  it("fires at a new 52-week low", () => {
    const signal = week52BreakSignal({ symbol: "X", price: 79, high52w: 150, low52w: 80 });
    expect(signal!.message).toMatch(/52-week low/);
  });

  it("does not fire mid-range", () => {
    expect(week52BreakSignal({ symbol: "X", price: 100, high52w: 150, low52w: 80 })).toBeNull();
  });
});

describe("gapSignal (Phase 4, Test Gate 4)", () => {
  it("fires on a significant overnight gap relative to the symbol's own vol", () => {
    const signal = gapSignal({ symbol: "X", dayOpen: 105, prevClose: 100, vol20d: 0.01 });
    expect(signal).not.toBeNull();
    expect(signal!.message).toMatch(/gapped up/);
  });

  it("illiquid symbol (vol20d effectively 0) does not produce Infinity/NaN — floor applies", () => {
    const signal = gapSignal({ symbol: "X", dayOpen: 100.01, prevClose: 100, vol20d: 0 });
    // Even with a floor, a tiny gap on a near-zero-vol floor could still
    // cross threshold — the point is it's a finite, sane number either way.
    if (signal) {
      expect(Number.isFinite(signal.zscore!)).toBe(true);
    }
  });
});

describe("filingEventSignal (Phase 4, Test Gate 4)", () => {
  it("earnings beat produces a complete sentence naming the surprise", () => {
    const signal = filingEventSignal({
      symbol: "X",
      type: "earnings",
      date: new Date("2026-07-30T00:00:00Z"),
      epsSurprisePct: 6.88,
    });
    expect(signal.message).toBe("X reported earnings on 2026-07-30, beat EPS estimates by 6.9%.");
  });

  it("split event produces a complete sentence", () => {
    const signal = filingEventSignal({ symbol: "X", type: "split", date: new Date("2026-06-15T00:00:00Z") });
    expect(signal.message).toMatch(/stock split/);
  });

  it("every signal message ends with a period (complete sentence requirement)", () => {
    const signals = [
      filingEventSignal({ symbol: "X", type: "earnings", date: new Date("2026-01-01") }),
      filingEventSignal({ symbol: "X", type: "split", date: new Date("2026-01-01") }),
      filingEventSignal({ symbol: "X", type: "dividend", date: new Date("2026-01-01") }),
    ];
    for (const s of signals) expect(s.message.trim().endsWith(".")).toBe(true);
  });
});
