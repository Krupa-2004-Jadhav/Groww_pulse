import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { renameWatchlist, deleteWatchlist } from "@/lib/watchlists/crud";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const watchlist = await prisma.watchlist.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!watchlist) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(watchlist);
}

// PATCH /api/watchlists/:id { name } — rename.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const watchlist = await renameWatchlist(id, body.name.trim());
  return NextResponse.json(watchlist);
}

// DELETE /api/watchlists/:id
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteWatchlist(id);
  return NextResponse.json({ deleted: true });
}
