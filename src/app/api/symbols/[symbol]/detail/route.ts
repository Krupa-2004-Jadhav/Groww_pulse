import { NextRequest, NextResponse } from "next/server";
import { getSymbolDetail } from "@/lib/detail/symbol-detail";
import { resolveUserId } from "@/lib/demo-user";

// GET /api/symbols/:symbol/detail?watchlistId=... — everything the stock
// detail screen needs in one response (bars, stats, filtered events,
// current signal breakdown, attention score, freshness). `watchlistId` is
// required: event filtering reuses Phase 7's per-(user,watchlist) watermark
// logic (ack state, seed_watermark), so a symbol has no meaningful "events"
// outside the context of a specific watchlist.
export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const watchlistId = request.nextUrl.searchParams.get("watchlistId");

  if (!watchlistId) {
    return NextResponse.json({ error: "watchlistId query param is required" }, { status: 400 });
  }

  const userId = await resolveUserId(request);
  const detail = await getSymbolDetail(symbol.toUpperCase(), watchlistId, userId);

  if (!detail) {
    return NextResponse.json({ error: "symbol not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
