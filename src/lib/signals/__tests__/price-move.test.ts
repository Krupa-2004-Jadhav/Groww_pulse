import { describe, it, expect } from "vitest";
import { priceMoveSignal } from "../price-move";

describe("priceMoveSignal (Phase 4, Test Gate 4 — high-value gate)", () => {
  it("a calm large-cap's 2% move (low own volatility) fires with a moderate score", () => {
    // vol_20d = 1% daily -> a 2% move is a 2-sigma residual.
    const signal = priceMoveSignal({
      symbol: "CALM",
      actualReturn: 0.02,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.01,
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });
    expect(signal).not.toBeNull();
    expect(signal!.zscore).toBeCloseTo(2, 5);
  });

  it("the SAME 2% move on a volatile small-cap (high own volatility) scores lower — proves per-symbol vol scaling", () => {
    const calm = priceMoveSignal({
      symbol: "CALM",
      actualReturn: 0.02,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.01,
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });
    const volatile = priceMoveSignal({
      symbol: "VOLATILE",
      actualReturn: 0.02,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.05, // 5x the calm stock's baseline vol
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });

    // Same nominal move, but for the volatile stock it's well below its own
    // 1-sigma threshold -> no signal at all.
    expect(volatile).toBeNull();
    expect(calm).not.toBeNull();
  });

  it("market-wide selloff: a stock moving exactly at its beta produces residual ~0 -> no false alert", () => {
    // Index down 3%, stock beta 1.5 -> "expected" stock move is -4.5%.
    // The stock actually moves exactly -4.5%, in line with the market.
    const signal = priceMoveSignal({
      symbol: "INLINE",
      actualReturn: -0.045,
      indexReturn: -0.03,
      beta: 1.5,
      vol20d: 0.015,
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });
    expect(signal).toBeNull();
  });

  it("a stock that moves MORE than its beta implies during a selloff still fires (real residual)", () => {
    // Same setup, but the stock actually fell 8% -- much worse than beta predicts.
    const signal = priceMoveSignal({
      symbol: "WORSE-THAN-BETA",
      actualReturn: -0.08,
      indexReturn: -0.03,
      beta: 1.5,
      vol20d: 0.015,
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });
    expect(signal).not.toBeNull();
    expect(signal!.zscore).toBeLessThan(0); // down move
  });

  it("multi-day window scales expected volatility by sqrt(days) — a 3-day move isn't compared to 1-day vol", () => {
    // A 2% move over 1 day (2-sigma given 1% vol) is much more notable than
    // the same 2% move over 9 days (vol scales by sqrt(9)=3 -> ~0.67 sigma -> no signal).
    const oneDay = priceMoveSignal({
      symbol: "X",
      actualReturn: 0.02,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.01,
      windowTradingDays: 1,
      windowLabel: "today",
    });
    const nineDays = priceMoveSignal({
      symbol: "X",
      actualReturn: 0.02,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.01,
      windowTradingDays: 9,
      windowLabel: "since last visit",
    });

    expect(oneDay).not.toBeNull();
    expect(nineDays).toBeNull();
  });

  it("message is a complete, plain-English sentence with no buy/sell language", () => {
    const signal = priceMoveSignal({
      symbol: "AAPL",
      actualReturn: 0.058,
      indexReturn: 0,
      beta: 1,
      vol20d: 0.01,
      windowTradingDays: 1,
      windowLabel: "since your last visit",
    });
    expect(signal!.message).toMatch(/^AAPL .+\.$/);
    expect(signal!.message.toLowerCase()).not.toMatch(/buy|sell|target price/);
  });
});
