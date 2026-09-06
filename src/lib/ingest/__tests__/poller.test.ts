import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { IngestPoller } from "../poller";
import { ingestHealth, __resetHealthForTests } from "@/lib/health";
import { MarketDataProvider, Quote, ProviderRateLimitError } from "@/lib/providers";

function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

class RecordingProvider implements MarketDataProvider {
  readonly name = "recording";
  calls: string[][] = [];
  private failNext = false;

  constructor(private readonly priceFor: (symbol: string) => number = () => 100) {}

  failNextCall() {
    this.failNext = true;
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    this.calls.push([...symbols]);
    if (this.failNext) {
      this.failNext = false;
      throw new ProviderRateLimitError(this.name, 1000);
    }
    return symbols.map((symbol) => ({
      symbol,
      price: this.priceFor(symbol),
      asOf: new Date(),
      source: this.name,
    }));
  }
}

describe("IngestPoller (Phase 2, Test Gate 2)", () => {
  let watched: string;
  let unwatched: string;
  let userId: string;
  let watchlistId: string;

  beforeEach(async () => {
    __resetHealthForTests();
    watched = uniqueSymbol("PW");
    unwatched = uniqueSymbol("PU");
    await prisma.symbol.create({ data: { symbol: watched, name: watched, exchange: "TEST" } });
    await prisma.symbol.create({ data: { symbol: unwatched, name: unwatched, exchange: "TEST" } });

    const user = await prisma.user.create({ data: {} });
    userId = user.id;
    const wl = await prisma.watchlist.create({ data: { userId, name: "Poller test" } });
    watchlistId = wl.id;
    await prisma.watchlistItem.create({ data: { watchlistId, symbol: watched, position: 1, seedWatermark: 0 } });
    // deliberately do NOT add `unwatched`
  });

  afterEach(async () => {
    await prisma.watchlistItem.deleteMany({ where: { watchlistId } });
    await prisma.watchlist.delete({ where: { id: watchlistId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.quoteLatest.deleteMany({ where: { symbol: { in: [watched, unwatched] } } });
    await prisma.symbol.deleteMany({ where: { symbol: { in: [watched, unwatched] } } });
  });

  it("only requests the union of watched symbols — never an unwatched one", async () => {
    const provider = new RecordingProvider();
    const poller = new IngestPoller(provider);

    await poller.pollOnce();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toContain(watched);
    expect(provider.calls[0]).not.toContain(unwatched);
  });

  it("a provider failure marks the ingest health as failing without losing the last good quote", async () => {
    const provider = new RecordingProvider(() => 42);
    const poller = new IngestPoller(provider);

    await poller.pollOnce(); // succeeds, writes price 42
    const before = await prisma.quoteLatest.findUnique({ where: { symbol: watched } });
    expect(before?.price).toBe(42);

    provider.failNextCall();
    await poller.pollOnce(); // simulated 429

    const after = await prisma.quoteLatest.findUnique({ where: { symbol: watched } });
    expect(after?.price).toBe(42); // unchanged — no null-overwrite, no crash

    const health = ingestHealth();
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastError).toMatch(/rate limited/i);
  });

  it("does not throw out of pollOnce on a provider error", async () => {
    const provider = new RecordingProvider();
    provider.failNextCall();
    const poller = new IngestPoller(provider);

    await expect(poller.pollOnce()).resolves.toBeDefined();
  });
});
