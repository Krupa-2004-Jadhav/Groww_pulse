import { NextRequest, NextResponse } from "next/server";
import { buildBriefing } from "@/lib/briefing";

// GET /api/watchlists/:id/briefing
// Read-only: returns the ranked change briefing for a watchlist without
// advancing its checkpoint. See lib/briefing.ts for why.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const briefing = await buildBriefing(id);

  if (!briefing) {
    return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });
  }

  return NextResponse.json(briefing);
}
