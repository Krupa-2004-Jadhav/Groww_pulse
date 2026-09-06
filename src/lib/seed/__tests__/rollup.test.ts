import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { seedSymbolHistory } from "../historical-seed";
import { updateStats } from "../rollup";
import { HistoricalDataProvider, HistoricalBar, SplitEvent, DividendEvent, EarningsEvent, SymbolSearchResult } from "@/lib/providers";

function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/** A HistoricalDataProvider backed by a fixed, hand-built bar array — no randomness, so expected stats can be hand-computed. */
class FixtureProvider implements HistoricalDataProvider {
  readonly name = "fixture";
  constructor(
    private readonly bars: HistoricalBar[],
    private readonly splits: SplitEvent[] = []
  ) {}

  async getDailyBars(): Promise<HistoricalBar[]> {
    return this.bars;
  }
  async getSplits(): Promise<SplitEvent[]> {
    return this.splits;
  }
  async getDividends(): Promise<DividendEvent[]> {
    return [];
  }
  async getEarnings(): Promise<EarningsEvent[]> {
    return [];
  }
  async searchSymbols(): Promise<SymbolSearchResult[]> {
    return [];
  }
}

function bar(symbol: string, dateStr: string, close: number, volume = 1_000_000): HistoricalBar {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return { symbol, date, open: close, high: close, low: close, close, volume };
}

async function cleanupSymbol(symbol: string) {
  await prisma.symbolStats.deleteMany({ where: { symbol } });
  await prisma.barDaily.deleteMany({ where: { symbol } });
  await prisma.symbol.deleteMany({ where: { symbol } });
}

describe("seedSymbolHistory + updateStats (Phase 3, Test Gate 3)", () => {
  const created: string[] = [];

  afterEach(async () => {
    while (created.length) await cleanupSymbol(created.pop()!);
  });

  it("produces correct vol_20d / avg_volume_20d on a known fixture", async () => {
    const symbol = uniqueSymbol("FX");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });

    // 21 bars -> 20 daily returns, deliberately simple round numbers.
    const closes = [100, 101, 99, 100, 102, 100, 98, 100, 101, 99, 100, 102, 100, 98, 100, 101, 99, 100, 102, 100, 100];
    const volumes = closes.map((_, i) => 1_000_000 + i * 10_000);
    const bars = closes.map((c, i) => bar(symbol, `2026-01-${String(i + 1).padStart(2, "0")}`, c, volumes[i]));

    await seedSymbolHistory(symbol, new FixtureProvider(bars));
    await updateStats(symbol);

    const stats = await prisma.symbolStats.findUnique({ where: { symbol } });
    expect(stats).not.toBeNull();

    // Hand-compute the expected values the same way rollup.ts does.
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const recentReturns = returns.slice(-20);
    const m = recentReturns.reduce((s, v) => s + v, 0) / recentReturns.length;
    const variance = recentReturns.reduce((s, v) => s + (v - m) ** 2, 0) / (recentReturns.length - 1);
    const expectedVol = Math.sqrt(variance);

    const recentVolumes = volumes.slice(-20);
    const expectedAvgVolume = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length;

    expect(stats!.vol20d).toBeCloseTo(expectedVol, 8);
    expect(stats!.avgVolume20d).toBeCloseTo(expectedAvgVolume, 2);
    expect(stats!.high52w).toBe(Math.max(...closes));
    expect(stats!.low52w).toBe(Math.min(...closes));
  });

  it("a split in the fixture does not fabricate a crash in vol_20d", async () => {
    const symbol = uniqueSymbol("SPLIT");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });

    // Steady ~1%-ish daily wiggle around 500, then a 4-for-1 split, then
    // continuing the same wiggle around 125 (i.e. no real volatility change).
    const preSplitCloses = [498, 502, 500, 497, 503, 500, 499, 501, 500, 498];
    const postSplitCloses = [126, 124, 125, 126, 124, 125, 126, 124, 125, 125, 126];
    const splitDate = "2026-02-11";

    const bars: HistoricalBar[] = [
      ...preSplitCloses.map((c, i) => bar(symbol, `2026-02-${String(i + 1).padStart(2, "0")}`, c)),
      ...postSplitCloses.map((c, i) => bar(symbol, `2026-02-${String(i + 11).padStart(2, "0")}`, c)),
    ];
    const split: SplitEvent = {
      symbol,
      date: new Date(`${splitDate}T00:00:00Z`),
      fromFactor: 4,
      toFactor: 1,
      description: "4-for-1",
    };

    await seedSymbolHistory(symbol, new FixtureProvider(bars, [split]));
    await updateStats(symbol);

    const stats = await prisma.symbolStats.findUnique({ where: { symbol } });
    // If adjustment were missing, the naive return across the split boundary
    // would be roughly -75%, and stddev of the last 20 returns would be
    // dominated by that one outlier — order of magnitude larger than the
    // ~1% daily wiggle actually present. A correctly adjusted vol_20d stays
    // in the same small range as the rest of the series.
    expect(stats!.vol20d).toBeLessThan(0.05);
  });

  it("an illiquid fixture (flat price, zero real variance) floors vol_20d instead of producing 0/NaN", async () => {
    const symbol = uniqueSymbol("FLAT");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });

    const bars = Array.from({ length: 25 }, (_, i) => bar(symbol, `2026-03-${String(i + 1).padStart(2, "0")}`, 50, 10_000));

    await seedSymbolHistory(symbol, new FixtureProvider(bars));
    await updateStats(symbol);

    const stats = await prisma.symbolStats.findUnique({ where: { symbol } });
    expect(stats!.vol20d).toBeGreaterThan(0); // floored, not exactly 0
    expect(Number.isFinite(stats!.vol20d!)).toBe(true);
    expect(Number.isNaN(stats!.vol20d!)).toBe(false);
  });

  it("seeding twice does not re-fetch or duplicate bars", async () => {
    const symbol = uniqueSymbol("ONCE");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });

    const bars = [bar(symbol, "2026-01-01", 100), bar(symbol, "2026-01-02", 101)];
    const provider: HistoricalDataProvider = new FixtureProvider(bars);
    let callCount = 0;
    // NOTE: `...provider` would silently drop the class's prototype methods
    // (they aren't own-enumerable properties) — wrap explicitly instead.
    const countingProvider: HistoricalDataProvider = {
      name: provider.name,
      getDailyBars: async (...args: Parameters<HistoricalDataProvider["getDailyBars"]>) => {
        callCount++;
        return provider.getDailyBars(...args);
      },
      getSplits: (...args) => provider.getSplits(...args),
      getDividends: (...args) => provider.getDividends(...args),
      getEarnings: (...args) => provider.getEarnings(...args),
      searchSymbols: (...args) => provider.searchSymbols(...args),
    };

    const first = await seedSymbolHistory(symbol, countingProvider);
    const second = await seedSymbolHistory(symbol, countingProvider);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(callCount).toBe(1);

    const count = await prisma.barDaily.count({ where: { symbol } });
    expect(count).toBe(2);
  });
});

describe("updateStats — staleness guard (scaling: avoid recomputing on every poll cycle)", () => {
  const created: string[] = [];

  afterEach(async () => {
    while (created.length) await cleanupSymbol(created.pop()!);
  });

  it("a symbol with no prior stats always computes, regardless of the guard", async () => {
    const symbol = uniqueSymbol("FRESH");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
    const bars = Array.from({ length: 25 }, (_, i) => bar(symbol, `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i));
    await seedSymbolHistory(symbol, new FixtureProvider(bars));

    await updateStats(symbol);
    const stats = await prisma.symbolStats.findUnique({ where: { symbol } });
    expect(stats).not.toBeNull();
  });

  it("a second call within the refresh interval is a no-op (does not touch updatedAt or recompute)", async () => {
    const symbol = uniqueSymbol("STALE");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
    const bars = Array.from({ length: 25 }, (_, i) => bar(symbol, `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i));
    await seedSymbolHistory(symbol, new FixtureProvider(bars));

    const t0 = new Date("2026-06-01T12:00:00Z");
    await updateStats(symbol, { now: t0 });
    const first = await prisma.symbolStats.findUnique({ where: { symbol } });

    // 5 minutes later — well inside the 15-minute refresh interval.
    await updateStats(symbol, { now: new Date(t0.getTime() + 5 * 60_000) });
    const second = await prisma.symbolStats.findUnique({ where: { symbol } });

    expect(second!.updatedAt.getTime()).toBe(first!.updatedAt.getTime());
  });

  it("a call past the refresh interval recomputes", async () => {
    const symbol = uniqueSymbol("REFRESH");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
    const bars = Array.from({ length: 25 }, (_, i) => bar(symbol, `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i));
    await seedSymbolHistory(symbol, new FixtureProvider(bars));

    const t0 = new Date("2026-06-01T12:00:00Z");
    await updateStats(symbol, { now: t0 });
    const first = await prisma.symbolStats.findUnique({ where: { symbol } });

    // 20 minutes later — past the 15-minute refresh interval.
    await updateStats(symbol, { now: new Date(t0.getTime() + 20 * 60_000) });
    const second = await prisma.symbolStats.findUnique({ where: { symbol } });

    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
  });

  it("force bypasses the guard even when fresh", async () => {
    const symbol = uniqueSymbol("FORCE");
    created.push(symbol);
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
    const bars = Array.from({ length: 25 }, (_, i) => bar(symbol, `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i));
    await seedSymbolHistory(symbol, new FixtureProvider(bars));

    const t0 = new Date("2026-06-01T12:00:00Z");
    await updateStats(symbol, { now: t0 });
    const first = await prisma.symbolStats.findUnique({ where: { symbol } });

    await updateStats(symbol, { now: new Date(t0.getTime() + 1000), force: true });
    const second = await prisma.symbolStats.findUnique({ where: { symbol } });

    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
  });
});
