import { NextRequest, NextResponse } from "next/server";
import { removeSymbolFromWatchlist, reorderSymbol } from "@/lib/watchlists/crud";

// PATCH /api/watchlists/:id/items/:symbol { position } — reorder ONE item
// to a caller-supplied fractional position. Never send the whole ordered
// array (plan Phase 8) — that's what makes two concurrent reorders of
// different items safe from a lost update.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params;
  const body = await request.json().catch(() => ({}));

  const position = Number(body.position);
  if (!Number.isFinite(position)) {
    return NextResponse.json({ error: "position must be a number" }, { status: 400 });
  }

  await reorderSymbol(id, symbol.toUpperCase(), position);
  return NextResponse.json({ symbol: symbol.toUpperCase(), position });
}

// DELETE /api/watchlists/:id/items/:symbol
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params;
  await removeSymbolFromWatchlist(id, symbol.toUpperCase());
  return NextResponse.json({ removed: true });
}
