import { describe, it, expect } from "vitest";
import { marketSession, isMarketOpen, pollCadenceMs } from "../market-hours";

// All times below expressed as UTC instants; comments show the equivalent ET wall time.
describe("market-hours", () => {
  it("is open during regular NYSE hours on a weekday", () => {
    // Tue 2026-01-06, 15:00 UTC = 10:00 ET
    expect(marketSession(new Date("2026-01-06T15:00:00Z"))).toBe("open");
  });

  it("is closed before pre-market and after post-market", () => {
    // Tue 2026-01-06, 02:00 ET = 07:00 UTC
    expect(marketSession(new Date("2026-01-06T07:00:00Z"))).toBe("closed");
  });

  it("is pre-post in the pre-market window", () => {
    // Tue 2026-01-06, 06:00 ET = 11:00 UTC
    expect(marketSession(new Date("2026-01-06T11:00:00Z"))).toBe("pre-post");
  });

  it("is closed on a Saturday regardless of time of day", () => {
    // Sat 2026-01-03, 15:00 ET
    expect(marketSession(new Date("2026-01-03T20:00:00Z"))).toBe("closed");
  });

  it("is closed on a Sunday", () => {
    expect(marketSession(new Date("2026-01-04T20:00:00Z"))).toBe("closed");
  });

  it("is closed on New Year's Day (fixed holiday)", () => {
    // Thu 2026-01-01, 15:00 ET
    expect(marketSession(new Date("2026-01-01T20:00:00Z"))).toBe("closed");
  });

  it("is closed on Thanksgiving (nth-weekday holiday, 4th Thursday of November)", () => {
    // 2026-11-26 is the 4th Thursday of November 2026
    expect(marketSession(new Date("2026-11-26T20:00:00Z"))).toBe("closed");
  });

  it("is closed on Good Friday (computed from Easter)", () => {
    // Easter 2026 is April 5; Good Friday is April 3.
    expect(marketSession(new Date("2026-04-03T20:00:00Z"))).toBe("closed");
  });

  it("isMarketOpen is a strict subset of marketSession === 'open'", () => {
    expect(isMarketOpen(new Date("2026-01-06T15:00:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-01-03T20:00:00Z"))).toBe(false);
  });

  it("pollCadenceMs maps sessions to the plan's cadence", () => {
    expect(pollCadenceMs("open")).toBe(10_000);
    expect(pollCadenceMs("pre-post")).toBe(180_000);
    expect(pollCadenceMs("closed")).toBeNull();
  });
});
