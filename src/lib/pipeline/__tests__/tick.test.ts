import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { runEvaluationTick } from "../tick";
import { MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";
import { seedSymbolHistory } from "@/lib/seed/historical-seed";
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

describe("runEvaluationTick (pipeline integration)", () => {
  let symbol: string;
  let watchlistId: string;
  let userId: string;

  beforeEach(async () => {
    symbol = uniqueSymbol("TK");
    const owner = await prisma.user.create({ data: {} });
    userId = owner.id;
    const wl = await prisma.watchlist.create({ data: { userId, name: "Tick test" } });
    watchlistId = wl.id;

    // Low-vol history with slight natural variation (not perfectly flat —
    // a literally unmoving 25-day series makes high52w exactly equal to
    // the baseline price, so ANY infinitesimal uptick would trivially
    // "break" the 52-week high; that's a degenerate fixture, not a real
    // market) for both the symbol and the index, so neither fires
    // spuriously before we push a live quote that actually deviates.
    const wiggle = [0, 0.3, -0.2, 0.1, -0.3, 0.2, 0, 0.1, -0.1, 0.3];
    const flatBars = Array.from({ length: 25 }, (_, i) =>
      bar(symbol, `2026-04-${String(i + 1).padStart(2, "0")}`, 100 + wiggle[i % wiggle.length])
    );
    const indexBars = Array.from({ length: 25 }, (_, i) =>
      bar(MARKET_INDEX_SYMBOL, `2026-04-${String(i + 1).padStart(2, "0")}`, 500 + wiggle[i % wiggle.length] * 5)
    );

    await prisma.symbol.upsert({ where: { symbol }, create: { symbol, name: symbol, exchange: "TEST" }, update: {} });
    await prisma.symbol.upsert({
      where: { symbol: MARKET_INDEX_SYMBOL },
      create: { symbol: MARKET_INDEX_SYMBOL, name: "Index", exchange: "TEST" },
      update: {},
    });
    await seedSymbolHistory(symbol, fixtureProvider(flatBars));
    await seedSymbolHistory(MARKET_INDEX_SYMBOL, fixtureProvider(indexBars));

    await prisma.watchlistItem.create({ data: { watchlistId, symbol, position: 1, seedWatermark: 0 } });

    // Index quote: unchanged from its last close (500 -> 500).
    await prisma.quoteLatest.create({
      data: { symbol: MARKET_INDEX_SYMBOL, price: 500, volume: 1_000_000, asOf: new Date(), receivedAt: new Date(), source: "test" },
    });
  });

  afterEach(async () => {
    await prisma.symbolEvent.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.watchlistItem.deleteMany({ where: { watchlistId } });
    await prisma.watchlist.delete({ where: { id: watchlistId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.quoteLatest.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.symbolStats.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.barDaily.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
    await prisma.symbol.deleteMany({ where: { symbol: { in: [symbol, MARKET_INDEX_SYMBOL] } } });
  });

  it("a live quote that deviates sharply from the last close produces an emitted event", async () => {
    // Prior close was 100 (flat history); live quote jumps to 112 (+12%) on 3x normal volume.
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

    const result = await runEvaluationTick();
    expect(result.symbolsEvaluated).toBeGreaterThanOrEqual(2); // symbol + index
    expect(result.eventsEmitted).toBeGreaterThan(0);

    const events = await prisma.symbolEvent.findMany({ where: { symbol } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.eventType === "price_move")).toBe(true);
  });

  it("a quote unchanged from the last close produces no events", async () => {
    // Most recent seeded bar (2026-04-25, i=24, wiggle[24%10]=wiggle[4]=-0.3) closed at 99.7.
    await prisma.quoteLatest.create({
      data: { symbol, price: 99.72, volume: 1_000_000, asOf: new Date(), receivedAt: new Date(), source: "test" },
    });

    await runEvaluationTick();
    const events = await prisma.symbolEvent.findMany({ where: { symbol } });
    expect(events).toHaveLength(0);
  });

  it("running the tick twice on the same unchanged conditions does not duplicate events", async () => {
    await prisma.quoteLatest.create({
      data: {
        symbol,
        price: 112,
        volume: 3_000_000,
        asOf: new Date(),
        receivedAt: new Date(),
        source: "test",
      },
    });

    await runEvaluationTick();
    const firstCount = await prisma.symbolEvent.count({ where: { symbol } });

    await runEvaluationTick(); // same day, same conditions -> same dedupe keys
    const secondCount = await prisma.symbolEvent.count({ where: { symbol } });

    expect(secondCount).toBe(firstCount);
  });
});
