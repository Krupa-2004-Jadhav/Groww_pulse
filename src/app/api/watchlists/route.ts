import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createWatchlist } from "@/lib/watchlists/crud";
import { resolveUserId } from "@/lib/demo-user";

// GET /api/watchlists?userId=... — list the user's watchlists (plan Phase 8: "multiple per user").
export async function GET(request: NextRequest) {
  const userId = await resolveUserId(request);
  const watchlists = await prisma.watchlist.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ watchlists });
}

// POST /api/watchlists { name }
export async function POST(request: NextRequest) {
  const userId = await resolveUserId(request);
  const body = await request.json().catch(() => ({}));

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const watchlist = await createWatchlist(userId, body.name.trim());
  return NextResponse.json(watchlist, { status: 201 });
}
