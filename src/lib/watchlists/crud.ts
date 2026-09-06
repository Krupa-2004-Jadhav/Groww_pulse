import { prisma } from "@/lib/db";
import { computeSafeSeq } from "@/lib/watermark/safe-seq";
import { HistoricalDataProvider } from "@/lib/providers";
import { seedSymbolHistory } from "@/lib/seed/historical-seed";

export async function createWatchlist(userId: string, name: string) {
  return prisma.watchlist.create({ data: { userId, name } });
}

export async function renameWatchlist(watchlistId: string, name: string) {
  return prisma.watchlist.update({ where: { id: watchlistId }, data: { name } });
}

/**
 * Hard-deletes the watchlist and its items/read-state. symbol_events rows
 * are untouched — they belong to the symbol, not the watchlist, and other
 * watchlists (or users) may still reference the same symbol. Deleting a
 * watchlist's items is enough to make its events vanish from /changes,
 * since membership there is checked fresh at read time (Phase 7).
 */
export async function deleteWatchlist(watchlistId: string) {
  await prisma.$transaction([
    prisma.readState.deleteMany({ where: { watchlistId } }),
    prisma.watchlistItem.deleteMany({ where: { watchlistId } }),
    prisma.watchlist.delete({ where: { id: watchlistId } }),
  ]);
}

export interface AddSymbolInput {
  watchlistId: string;
  symbol: string;
  name: string;
  exchange: string;
}

export interface AddSymbolResult {
  added: boolean; // false when it was already on the watchlist — a no-op, not an error
  itemId: string;
}

/**
 * Adds a symbol to a watchlist (plan Phase 8). Registers the Symbol row and
 * seeds its history on first-ever watch (seeding is already a no-op if bars
 * exist — Phase 3 — so it's safe to call unconditionally here). A duplicate
 * add is a no-op via UNIQUE(watchlistId, symbol): checked optimistically
 * first, then the unique constraint itself is the authority if two
 * "devices" race past that check at the same time — either path lands on
 * exactly one row, never an error surfaced to the caller.
 */
export async function addSymbolToWatchlist(
  input: AddSymbolInput,
  historicalProvider: HistoricalDataProvider
): Promise<AddSymbolResult> {
  const { watchlistId, symbol, name, exchange } = input;

  // upsert, not find-then-create: two concurrent adds of a never-seen-before
  // symbol would otherwise both pass the "doesn't exist yet" check and race
  // on the same UNIQUE(symbol) constraint (this bit an early version of this
  // function's own test — see conversation record).
  await prisma.symbol.upsert({
    where: { symbol },
    create: { symbol, name, exchange },
    update: {},
  });
  await seedSymbolHistory(symbol, historicalProvider);

  const existingItem = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId, symbol } },
  });
  if (existingItem) {
    return { added: false, itemId: existingItem.id };
  }

  // New symbols start from the current safe_seq — no backfill of
  // pre-existing event history (Phase 7's seed_watermark filter).
  const seedWatermark = await computeSafeSeq();
  const maxPosition = await prisma.watchlistItem.aggregate({ where: { watchlistId }, _max: { position: true } });
  const position = (maxPosition._max.position ?? 0) + 1;

  try {
    const item = await prisma.watchlistItem.create({ data: { watchlistId, symbol, position, seedWatermark } });
    return { added: true, itemId: item.id };
  } catch {
    // Concurrent duplicate add raced past the findUnique check above and
    // hit the UNIQUE(watchlistId, symbol) constraint — the other request
    // won; return its row rather than surfacing an error.
    const winner = await prisma.watchlistItem.findUniqueOrThrow({ where: { watchlistId_symbol: { watchlistId, symbol } } });
    return { added: false, itemId: winner.id };
  }
}

/** Hard-delete — no soft-delete/removedAt in this schema (plan §4). Events for the symbol are untouched; they just stop being reachable through this watchlist. */
export async function removeSymbolFromWatchlist(watchlistId: string, symbol: string): Promise<void> {
  await prisma.watchlistItem.deleteMany({ where: { watchlistId, symbol } });
}

/**
 * Reorders exactly one item to a caller-supplied fractional position (plan
 * Phase 8: "send the single moved item + its new fractional position...
 * never the whole array"). Because each reorder touches only its own row,
 * two different items being reordered concurrently can never lost-update
 * each other — there's no shared array being read-modified-written.
 */
export async function reorderSymbol(watchlistId: string, symbol: string, newPosition: number): Promise<void> {
  await prisma.watchlistItem.update({
    where: { watchlistId_symbol: { watchlistId, symbol } },
    data: { position: newPosition },
  });
}
