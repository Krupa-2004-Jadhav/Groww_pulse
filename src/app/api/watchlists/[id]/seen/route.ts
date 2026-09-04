import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/watchlists/:id/seen
// Advances the watchlist-level checkpoint ("Checkpoint A" — last_seen_at) to
// now. Called explicitly by the client when the user opens the briefing —
// never as a side effect of a background data refresh.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const watchlist = await prisma.watchlist.update({
    where: { id },
    data: { lastSeenAt: new Date() },
  });

  return NextResponse.json({ watchlistId: watchlist.id, lastSeenAt: watchlist.lastSeenAt });
}
