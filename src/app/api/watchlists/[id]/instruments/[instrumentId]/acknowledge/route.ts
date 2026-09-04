import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/watchlists/:id/instruments/:instrumentId/acknowledge
// Records "Checkpoint B" — a per-stock acknowledgement, independent of the
// watchlist-level checkpoint. This is what "Mark reviewed" writes.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; instrumentId: string }> }) {
  const { id, instrumentId } = await params;

  const acknowledgement = await prisma.stockAcknowledgement.upsert({
    where: { watchlistId_instrumentId: { watchlistId: id, instrumentId } },
    create: { watchlistId: id, instrumentId, acknowledgedAt: new Date() },
    update: { acknowledgedAt: new Date() },
  });

  return NextResponse.json(acknowledgement);
}
