import { NextRequest, NextResponse } from "next/server";
import { addSymbolToWatchlist } from "@/lib/watchlists/crud";
import { getHistoricalDataProvider } from "@/lib/providers";

// POST /api/watchlists/:id/items { symbol, name, exchange } — add a symbol.
// Duplicate add is a no-op (added: false), never an error (plan Phase 8).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (typeof body.symbol !== "string" || body.symbol.trim().length === 0) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const symbol = body.symbol.trim().toUpperCase();
  const result = await addSymbolToWatchlist(
    { watchlistId: id, symbol, name: body.name ?? symbol, exchange: body.exchange ?? "US" },
    getHistoricalDataProvider()
  );

  return NextResponse.json(result, { status: result.added ? 201 : 200 });
}
