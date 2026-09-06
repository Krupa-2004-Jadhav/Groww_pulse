import { NextRequest, NextResponse } from "next/server";
import { getHistoricalDataProvider } from "@/lib/providers";

// GET /api/symbols/search?q=tesla — for the add-stock flow (plan Phase 8/1).
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const results = await getHistoricalDataProvider().searchSymbols(query);
  return NextResponse.json({ results });
}
