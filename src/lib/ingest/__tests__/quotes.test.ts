import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { upsertQuote, getWatchedSymbols } from "../quotes";
import { Quote } from "@/lib/providers";

// Uses the real dev DB with a uniquely-prefixed fixture symbol per test run,
// cleaned up afterward — see note in the conversation record on why this
// project doesn't stand up a separate test database at this scale.
function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function makeSymbol(symbol: string) {
  await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
}

async function cleanup(symbol: string) {
  await prisma.quoteLatest.deleteMany({ where: { symbol } });
  await prisma.symbol.deleteMany({ where: { symbol } });
}

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    price: 100,
    asOf: new Date("2026-01-06T15:00:00Z"),
    source: "test",
    ...overrides,
  };
}

describe("upsertQuote (Phase 2, Test Gate 2)", () => {
  let symbol: string;

  beforeEach(async () => {
    symbol = uniqueSymbol("TQ");
    await makeSymbol(symbol);
  });

  afterEach(async () => {
    await cleanup(symbol);
  });

  it("inserts a quote for a symbol with no prior data", async () => {
    const outcome = await upsertQuote(quote(symbol, { price: 100 }));
    expect(outcome).toBe("inserted");

    const row = await prisma.quoteLatest.findUnique({ where: { symbol } });
    expect(row?.price).toBe(100);
  });

  it("accepts a newer quote and updates the stored price", async () => {
    await upsertQuote(quote(symbol, { price: 100, asOf: new Date("2026-01-06T15:00:00Z") }));
    const outcome = await upsertQuote(quote(symbol, { price: 105, asOf: new Date("2026-01-06T15:00:10Z") }));

    expect(outcome).toBe("updated");
    const row = await prisma.quoteLatest.findUnique({ where: { symbol } });
    expect(row?.price).toBe(105);
  });

  it("rejects an out-of-order (older asOf) quote and keeps the newer price", async () => {
    await upsertQuote(quote(symbol, { price: 105, asOf: new Date("2026-01-06T15:00:10Z") }));
    const outcome = await upsertQuote(quote(symbol, { price: 99, asOf: new Date("2026-01-06T15:00:00Z") }));

    expect(outcome).toBe("rejected_out_of_order");
    const row = await prisma.quoteLatest.findUnique({ where: { symbol } });
    expect(row?.price).toBe(105); // unchanged — the older/wrong price never landed
  });

  it("a duplicate quote (identical asOf) is a no-op, not an error or a double-write", async () => {
    const asOf = new Date("2026-01-06T15:00:10Z");
    await upsertQuote(quote(symbol, { price: 105, asOf }));
    const outcome = await upsertQuote(quote(symbol, { price: 999, asOf })); // same instant, different price

    expect(outcome).toBe("rejected_out_of_order"); // asOf <= stored asOf -> guard rejects it
    const row = await prisma.quoteLatest.findUnique({ where: { symbol } });
    expect(row?.price).toBe(105);

    const count = await prisma.quoteLatest.count({ where: { symbol } });
    expect(count).toBe(1); // no double-write
  });

  it("rejects a quote for a symbol not in the Symbol table (never silently creates one)", async () => {
    const ghost = uniqueSymbol("GHOST");
    const outcome = await upsertQuote(quote(ghost, { price: 1 }));
    expect(outcome).toBe("rejected_no_symbol");
  });
});

describe("getWatchedSymbols (Phase 2, Test Gate 2)", () => {
  it("returns the deduplicated union of symbols across watchlists, and nothing unwatched", async () => {
    const symbolA = uniqueSymbol("WA");
    const symbolB = uniqueSymbol("WB");
    const unwatched = uniqueSymbol("UW");

    await makeSymbol(symbolA);
    await makeSymbol(symbolB);
    await makeSymbol(unwatched);

    const user = await prisma.user.create({ data: {} });
    const wl1 = await prisma.watchlist.create({ data: { userId: user.id, name: "WL1" } });
    const wl2 = await prisma.watchlist.create({ data: { userId: user.id, name: "WL2" } });

    // Both watchlists watch symbolA — must appear once, not twice.
    await prisma.watchlistItem.create({ data: { watchlistId: wl1.id, symbol: symbolA, position: 1, seedWatermark: 0 } });
    await prisma.watchlistItem.create({ data: { watchlistId: wl2.id, symbol: symbolA, position: 1, seedWatermark: 0 } });
    await prisma.watchlistItem.create({ data: { watchlistId: wl1.id, symbol: symbolB, position: 2, seedWatermark: 0 } });

    const watched = await getWatchedSymbols();

    expect(watched.filter((s) => s === symbolA)).toHaveLength(1);
    expect(watched).toContain(symbolB);
    expect(watched).not.toContain(unwatched);

    await prisma.watchlistItem.deleteMany({ where: { watchlistId: { in: [wl1.id, wl2.id] } } });
    await prisma.watchlist.deleteMany({ where: { id: { in: [wl1.id, wl2.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
    await cleanup(symbolA);
    await cleanup(symbolB);
    await cleanup(unwatched);
  });
});
