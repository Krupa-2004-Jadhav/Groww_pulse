import { prisma } from "@/lib/db";
import { Quote } from "@/lib/providers";

/**
 * The deduplicated union of every symbol currently on any watchlist. Never
 * queried per-user (plan §0.2, §6.1) — this is the "materiality computed
 * once per symbol" invariant: N watched symbols, one poll, regardless of
 * how many users or watchlists reference them.
 */
export async function getWatchedSymbols(): Promise<string[]> {
  const rows = await prisma.watchlistItem.findMany({
    select: { symbol: true },
    distinct: ["symbol"],
  });
  return rows.map((r) => r.symbol);
}

export type UpsertOutcome = "inserted" | "updated" | "rejected_out_of_order" | "rejected_no_symbol";

/**
 * Idempotent, out-of-order-safe write of one quote into quotes_latest.
 *
 * A single SQLite UPSERT does the whole job atomically — no read-then-write
 * race window: `ON CONFLICT ... DO UPDATE ... WHERE excluded.as_of >
 * quotes_latest.as_of` means the update is a no-op (not an error, not a
 * partial write) whenever the incoming tick is older than or equal to what's
 * already stored. Postgres note: the same clause works verbatim there —
 * this wasn't written SQLite-specific.
 */
export async function upsertQuote(quote: Quote): Promise<UpsertOutcome> {
  const symbolExists = await prisma.symbol.findUnique({ where: { symbol: quote.symbol }, select: { symbol: true } });
  if (!symbolExists) return "rejected_no_symbol";

  const existing = await prisma.quoteLatest.findUnique({ where: { symbol: quote.symbol }, select: { asOf: true } });

  const result = await prisma.$executeRaw`
    INSERT INTO "QuoteLatest" ("symbol", "price", "dayOpen", "dayHigh", "dayLow", "prevClose", "volume", "asOf", "receivedAt", "source")
    VALUES (${quote.symbol}, ${quote.price}, ${quote.dayOpen ?? null}, ${quote.dayHigh ?? null}, ${quote.dayLow ?? null}, ${quote.prevClose ?? null}, ${quote.volume ?? null}, ${quote.asOf}, ${new Date()}, ${quote.source})
    ON CONFLICT("symbol") DO UPDATE SET
      "price" = excluded."price",
      "dayOpen" = excluded."dayOpen",
      "dayHigh" = excluded."dayHigh",
      "dayLow" = excluded."dayLow",
      "prevClose" = excluded."prevClose",
      "volume" = excluded."volume",
      "asOf" = excluded."asOf",
      "receivedAt" = excluded."receivedAt",
      "source" = excluded."source"
    WHERE excluded."asOf" > "QuoteLatest"."asOf"
  `;

  if (!existing) return "inserted";
  // `result` (rows affected) is 0 when the WHERE guard rejected the write —
  // i.e. the incoming quote's asOf was <= what was already stored.
  return result > 0 ? "updated" : "rejected_out_of_order";
}
