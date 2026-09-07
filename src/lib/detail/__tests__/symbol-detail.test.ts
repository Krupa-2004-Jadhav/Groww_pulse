import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { getSymbolDetail } from "../symbol-detail";
import { updateStats, MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";
import { seedSymbolHistory } from "@/lib/seed/historical-seed";
import { runEvaluationTick } from "@/lib/pipeline/tick";
import { HistoricalDataProvider, HistoricalBar, SplitEvent, DividendEvent, EarningsEvent, SymbolSearchResult } from "@/lib/providers";

function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function bar(symbol: string, dateStr: string, close: number, volume = 1_000_000): HistoricalBar {
  return { symbol, date: new Date(`${dateStr}T00:00:00Z`), open: close, high: close, low: close, close, volume };
}

function fixtureProvider(bars: HistoricalBar[]): HistoricalDataProvider {
  return {
    name: "fixture",
    async getDailyBars(): Promise<HistoricalBar[]> {
      return bars;
    },
    async getSplits(): Promise<SplitEvent[]> {
      return [];
    },
    async getDividends(): Promise<DividendEvent[]> {
      return [];
    },
    async getEarnings(): Promise<EarningsEvent[]> {
      return [];
    },
    async searchSymbols(): Promise<SymbolSearchResult[]> {
      return [];
    },
  };
}

/** Recent daily bars spanning ~7 months so the 6-month window filter has something to trim, with slight variation (not flat — see other test files' notes on why a perfectly flat fixture is degenerate). */
function recentBars(symbol: string, days: number, base: number) {
  const wiggle = [0, 0.3, -0.2, 0.1, -0.3, 0.2, 0, 0.1, -0.1, 0.3];
  const bars: HistoricalBar[] = [];
  const start = new Date();
  start.setDate(start.getDate() - days);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    bars.push(bar(symbol, d.toISOString().slice(0, 10), base + wiggle[i % wiggle.length]));
  }
  return bars;
}

describe("getSymbolDetail (Stock Detail screen, Test Gate)", () => {
  let symbol: string;
  let userId: string;
  let watchlistId: string;

  beforeEach(async () => {
    symbol = uniqueSymbol("DT");
    const owner = await prisma.user.create({ data: {} });
    userId = owner.id;
    const wl = await prisma.watchlist.create({ data: { userId, name: "Detail test" } });
    watchlistId = wl.id;

    await prisma.symbol.upsert({ where: { symbol }, create: { symbol, name: `${symbol} Inc.`, exchange: "TEST" }, update: {} });
    await prisma.symbol.upsert({
      where: { symbol: MARKET_INDEX_SYMBOL },
      create: { symbol: MARKET_INDEX_SYMBOL, name: "Index", exchange: "TEST" },
      update: {},
    });

    await seedSymbolHistory(symbol, fixtureProvider(recentBars(symbol, 210, 100)));
    await seedSymbolHistory(MARKET_INDEX_SYMBOL, fixtureProvider(recentBars(MARKET_INDEX_SYMBOL, 210, 500)));
    await updateStats(symbol, { force: true });
    await updateStats(MARKET_INDEX_SYMBOL, { force: true });

    await prisma.watchlistItem.create({ data: { watchlistId, symbol, position: 1, seedWatermark: 0 } });

    await prisma.quoteLatest.create({
      data: {
        symbol,
        price: 112,
        dayOpen: 101,
        prevClose: 100,
        volume: 3_000_000,
        asOf: new Date(),
        receivedAt: new Date(),
        source: "test",
      },
    });
    await prisma.quoteLatest.create({
      data: { symbol: MARKET_INDEX_SYMBOL, price: 500, volume: 1_000_000, asOf: new Date(), receivedAt: new Date(), source: "test" },
    });

    // Actually emit the symbol_events rows the +12% quote above should
    // fire — computeCurrentSignals alone only computes what WOULD fire, it
    // doesn't persist anything; getChanges (and therefore detail.events)
    // reads from stored rows. Backdated 10s so Phase 7's safety-lag
    // watermark (which only trusts a seq once a row that old exists —
    // occurredAt < now - 2s) treats it as visible immediately, rather than
    // this test racing its own 2-second visibility delay.
    await runEvaluationTick(new Date(Date.now() - 10_000));
  });

  afterEach(async () => {
    await prisma.userEventState.deleteMany({ where: { event: { symbol } } });
    await prisma.symbolEvent.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.watchlistItem.deleteMany({ where: { watchlistId } });
    await prisma.watchlist.delete({ where: { id: watchlistId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.quoteLatest.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.symbolStats.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.barDaily.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.symbol.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
  });

  it("returns null for an unknown symbol", async () => {
    const detail = await getSymbolDetail("NOT-A-REAL-SYMBOL", watchlistId, userId);
    expect(detail).toBeNull();
  });

  it("returns correctly shaped data for a seeded symbol", async () => {
    const detail = await getSymbolDetail(symbol, watchlistId, userId);
    expect(detail).not.toBeNull();

    expect(detail!.symbol).toBe(symbol);
    expect(detail!.name).toContain(symbol);

    // Quote + day change.
    expect(detail!.quote).not.toBeNull();
    expect(detail!.quote!.price).toBe(112);
    expect(detail!.quote!.dayChangePct).toBeCloseTo(12, 5);

    // Stats present and sane.
    expect(detail!.stats).not.toBeNull();
    expect(detail!.stats!.vol20d).toBeGreaterThan(0);
    expect(detail!.stats!.avgVolume20d).toBeGreaterThan(0);

    // Bars trimmed to roughly the 6-month window, not the full ~210-day seed.
    expect(detail!.bars.length).toBeGreaterThan(150);
    expect(detail!.bars.length).toBeLessThan(210);
    for (let i = 1; i < detail!.bars.length; i++) {
      expect(new Date(detail!.bars[i].date).getTime()).toBeGreaterThan(new Date(detail!.bars[i - 1].date).getTime());
    }

    // Benchmark line normalized to start at the same value as the stock's own first bar.
    expect(detail!.benchmarkBars.length).toBe(detail!.bars.length);
    expect(detail!.benchmarkBars[0].close).toBeCloseTo(detail!.bars[0].close, 2);

    // Signal breakdown: a +12% move should fire at least a price_move signal, each with a value string.
    expect(detail!.signals.length).toBeGreaterThan(0);
    expect(detail!.signals.every((s) => s.subScore > 0)).toBe(true);
    expect(detail!.signals.every((s) => typeof s.message === "string" && s.message.length > 0)).toBe(true);
    const priceSignal = detail!.signals.find((s) => s.type === "price_move");
    expect(priceSignal?.value).toMatch(/^z=/);

    // Combined attention score is consistent with the signals returned.
    expect(detail!.attentionScore.score).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(detail!.attentionScore.tier);

    // Freshness: real timestamps, not placeholders.
    expect(detail!.freshness.price).not.toBeNull();
    expect(detail!.freshness.volume).not.toBeNull();
    expect(new Date(detail!.freshness.price!).getTime()).not.toBeNaN();
  });

  it("events respect the existing watermark/ack filters — acknowledging one removes it from the detail response", async () => {
    let detail = await getSymbolDetail(symbol, watchlistId, userId);
    const before = detail!.events.length;
    expect(before).toBeGreaterThan(0);

    const eventId = detail!.events[0].seq;
    await prisma.userEventState.create({ data: { userId, eventId, acknowledgedAt: new Date() } });

    detail = await getSymbolDetail(symbol, watchlistId, userId);
    expect(detail!.events.length).toBe(before - 1);
    expect(detail!.events.some((e) => e.seq === eventId)).toBe(false);
  });

  it("a symbol with no live quote yet falls back to the last daily close, marked non-live, rather than leaving the header blank", async () => {
    await prisma.quoteLatest.deleteMany({ where: { symbol } });
    const detail = await getSymbolDetail(symbol, watchlistId, userId);
    expect(detail).not.toBeNull();
    expect(detail!.quote).not.toBeNull();
    expect(detail!.quote!.live).toBe(false);
    expect(detail!.quote!.price).toBeGreaterThan(0);
    // freshness.price tracks the live quote feed specifically — still null,
    // since there genuinely isn't a live quote, even though quote itself
    // now has a (non-live) fallback value.
    expect(detail!.freshness.price).toBeNull();
  });
});
