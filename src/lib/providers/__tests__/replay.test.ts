import { describe, it, expect } from "vitest";
import { ReplayProvider } from "../replay";

describe("ReplayProvider — determinism (Phase 1, Test Gate 1)", () => {
  it("same seed produces the same quote sequence", async () => {
    const start = new Date("2026-01-05T14:30:00Z");
    const a = new ReplayProvider({ seed: "fixed-seed", startTime: start });
    const b = new ReplayProvider({ seed: "fixed-seed", startTime: start });

    const seqA = [await a.getQuotes(["AAPL", "MSFT"]), await a.getQuotes(["AAPL", "MSFT"]), await a.getQuotes(["AAPL", "MSFT"])];
    const seqB = [await b.getQuotes(["AAPL", "MSFT"]), await b.getQuotes(["AAPL", "MSFT"]), await b.getQuotes(["AAPL", "MSFT"])];

    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", async () => {
    const start = new Date("2026-01-05T14:30:00Z");
    const a = new ReplayProvider({ seed: "seed-one", startTime: start });
    const b = new ReplayProvider({ seed: "seed-two", startTime: start });

    const [qa] = await a.getQuotes(["AAPL"]);
    const [qb] = await b.getQuotes(["AAPL"]);

    expect(qa.price).not.toEqual(qb.price);
  });

  it("advances price on every call (a walk, not a static value)", async () => {
    const provider = new ReplayProvider({ seed: "walk-test", startTime: new Date("2026-01-05T14:30:00Z") });
    const [first] = await provider.getQuotes(["AAPL"]);
    const [second] = await provider.getQuotes(["AAPL"]);
    const [third] = await provider.getQuotes(["AAPL"]);

    // Not asserting direction (it's a random walk) — just that state moves.
    const prices = [first.price, second.price, third.price];
    expect(new Set(prices).size).toBeGreaterThan(1);
  });

  it("marks every quote with source: replay, per plan §0.1 (simulated data must be labeled)", async () => {
    const provider = new ReplayProvider({ seed: "label-test" });
    const [q] = await provider.getQuotes(["AAPL"]);
    expect(q.source).toBe("replay");
  });

  it("scripted feed-outage throws for the affected symbol during its window", async () => {
    const provider = new ReplayProvider({
      seed: "outage-test",
      script: [{ type: "feed-outage", symbol: "AAPL", fromTick: 1, toTick: 3 }],
    });

    await provider.getQuotes(["AAPL"]); // tick 0 — fine
    await expect(provider.getQuotes(["AAPL"])).rejects.toThrow(/outage/i); // tick 1 — outage
    await expect(provider.getQuotes(["AAPL"])).rejects.toThrow(/outage/i); // tick 2 — outage
  });

  it("scripted gap/spike moves price by the given percentage at the given tick", async () => {
    const provider = new ReplayProvider({
      seed: "gap-test",
      script: [{ type: "gap", symbol: "AAPL", atTick: 0, pct: 0.5 }],
    });
    const noGap = new ReplayProvider({ seed: "gap-test" });

    const [withGap] = await provider.getQuotes(["AAPL"]);
    const [without] = await noGap.getQuotes(["AAPL"]);

    // withGap should be ~1.5x `without` at tick 0 (same base price, +50% gap applied).
    expect(withGap.price / without.price).toBeCloseTo(1.5, 1);
  });

  it("getDailyBars returns chronologically ordered bars with a fixed count", async () => {
    const provider = new ReplayProvider({ seed: "bars-test" });
    const bars = await provider.getDailyBars("AAPL", 30);
    expect(bars).toHaveLength(30);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].date.getTime()).toBeGreaterThan(bars[i - 1].date.getTime());
    }
  });

  it("searchSymbols matches by symbol or name", async () => {
    const provider = new ReplayProvider({ seed: "search-test" });
    const results = await provider.searchSymbols("tesla");
    expect(results.some((r) => r.symbol === "TSLA")).toBe(true);
  });

  it("regression: the first live quote continues from the historical series' last close, not an unrelated anchor", async () => {
    // Caught live: before this was fixed, getQuotes' walk and
    // getDailyBars' walk used independent anchors, so a symbol's very
    // first live quote could land tens of percent away from its own
    // "previous close" — producing a fabricated 40-sigma "crash" the
    // instant a symbol was added. The two series must connect.
    const provider = new ReplayProvider({ seed: "continuity-test" });
    const bars = await provider.getDailyBars("AAPL", 260);
    const lastClose = bars[bars.length - 1].close;

    const [firstLiveQuote] = await provider.getQuotes(["AAPL"]);

    const pctDiff = Math.abs((firstLiveQuote.price - lastClose) / lastClose);
    expect(pctDiff).toBeLessThan(0.05); // one tick's worth of movement (~1.5% step vol), not an unrelated random walk
  });
});
