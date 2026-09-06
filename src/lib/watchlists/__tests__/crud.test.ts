import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWatchlist,
  deleteWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  reorderSymbol,
} from "../crud";
import { getChanges } from "@/lib/watermark/changes";
import { HistoricalDataProvider, HistoricalBar, SplitEvent, DividendEvent, EarningsEvent, SymbolSearchResult } from "@/lib/providers";

function uniqueId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns no history — fine for CRUD tests, which don't exercise the seeding pipeline itself. */
const nullProvider: HistoricalDataProvider = {
  name: "null",
  async getDailyBars(): Promise<HistoricalBar[]> {
    return [];
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

describe("watchlist CRUD (Phase 8, Test Gate 8)", () => {
  let userId: string;
  let watchlistId: string;
  let symbolA: string;
  let symbolB: string;

  beforeEach(async () => {
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
    const wl = await createWatchlist(userId, "Test watchlist");
    watchlistId = wl.id;
    symbolA = uniqueId("CA").toUpperCase();
    symbolB = uniqueId("CB").toUpperCase();
  });

  afterEach(async () => {
    await prisma.userEventState.deleteMany({ where: { event: { symbol: { in: [symbolA, symbolB] } } } });
    await prisma.symbolEvent.deleteMany({ where: { symbol: { in: [symbolA, symbolB] } } });
    await prisma.readState.deleteMany({ where: { watchlistId } }).catch(() => {});
    await prisma.watchlistItem.deleteMany({ where: { watchlistId } }).catch(() => {});
    await prisma.watchlist.deleteMany({ where: { id: watchlistId } }).catch(() => {});
    await prisma.symbol.deleteMany({ where: { symbol: { in: [symbolA, symbolB] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("adds a symbol, and a duplicate add is a no-op (sequential)", async () => {
    const first = await addSymbolToWatchlist(
      { watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" },
      nullProvider
    );
    expect(first.added).toBe(true);

    const second = await addSymbolToWatchlist(
      { watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" },
      nullProvider
    );
    expect(second.added).toBe(false);
    expect(second.itemId).toBe(first.itemId);

    const count = await prisma.watchlistItem.count({ where: { watchlistId, symbol: symbolA } });
    expect(count).toBe(1);
  });

  it("a duplicate add raced from two 'devices' concurrently still lands on exactly one row, no error", async () => {
    const [a, b] = await Promise.all([
      addSymbolToWatchlist({ watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" }, nullProvider),
      addSymbolToWatchlist({ watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" }, nullProvider),
    ]);

    // Exactly one of the two calls "won" the insert; the other saw it as already-there.
    expect([a.added, b.added].filter(Boolean)).toHaveLength(1);
    expect(a.itemId).toBe(b.itemId);

    const count = await prisma.watchlistItem.count({ where: { watchlistId, symbol: symbolA } });
    expect(count).toBe(1);
  });

  it("a newly added symbol seeds seed_watermark to the current safe_seq (no backfill)", async () => {
    // Pre-existing event for symbolA, written before it's ever added to any watchlist.
    await prisma.symbol.create({ data: { symbol: symbolA, name: symbolA, exchange: "TEST" } });
    await prisma.symbolEvent.create({
      data: {
        symbol: symbolA,
        eventType: "price_move",
        tier: "high",
        score: 90,
        reason: "old news",
        occurredAt: new Date(Date.now() - 30_000),
        dedupeKey: uniqueId("dk"),
      },
    });

    const result = await addSymbolToWatchlist(
      { watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" },
      nullProvider
    );
    expect(result.added).toBe(true);

    const changes = await getChanges(userId, watchlistId);
    expect(changes.events).toHaveLength(0); // the pre-existing event is not backfilled
  });

  it("concurrent reorder of two different items: both survive (no lost update)", async () => {
    await addSymbolToWatchlist({ watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" }, nullProvider);
    await addSymbolToWatchlist({ watchlistId, symbol: symbolB, name: symbolB, exchange: "TEST" }, nullProvider);

    await Promise.all([reorderSymbol(watchlistId, symbolA, 5.5), reorderSymbol(watchlistId, symbolB, 2.5)]);

    const itemA = await prisma.watchlistItem.findUnique({ where: { watchlistId_symbol: { watchlistId, symbol: symbolA } } });
    const itemB = await prisma.watchlistItem.findUnique({ where: { watchlistId_symbol: { watchlistId, symbol: symbolB } } });
    expect(itemA?.position).toBe(5.5);
    expect(itemB?.position).toBe(2.5);
  });

  it("deleting a symbol makes its events vanish from /changes (membership filtered at read time)", async () => {
    await addSymbolToWatchlist({ watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" }, nullProvider);
    await prisma.symbolEvent.create({
      data: {
        symbol: symbolA,
        eventType: "price_move",
        tier: "high",
        score: 90,
        reason: "big move",
        occurredAt: new Date(Date.now() - 10_000),
        dedupeKey: uniqueId("dk"),
      },
    });

    const before = await getChanges(userId, watchlistId);
    expect(before.events).toHaveLength(1);

    await removeSymbolFromWatchlist(watchlistId, symbolA);

    const after = await getChanges(userId, watchlistId);
    expect(after.events).toHaveLength(0);
  });

  it("deleting a watchlist removes its items and read-state", async () => {
    await addSymbolToWatchlist({ watchlistId, symbol: symbolA, name: symbolA, exchange: "TEST" }, nullProvider);
    await prisma.readState.create({ data: { userId, watchlistId, watermark: 0 } });

    await deleteWatchlist(watchlistId);

    expect(await prisma.watchlist.findUnique({ where: { id: watchlistId } })).toBeNull();
    expect(await prisma.watchlistItem.count({ where: { watchlistId } })).toBe(0);
    expect(await prisma.readState.count({ where: { watchlistId } })).toBe(0);
  });
});
