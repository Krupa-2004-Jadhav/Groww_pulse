import { NextRequest, NextResponse } from "next/server";
import { acknowledgeEvent } from "@/lib/watermark/ack";
import { resolveUserId } from "@/lib/demo-user";

// POST /api/events/:id/acknowledge (plan Phase 7). Idempotent — a double-ack is a no-op.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  const userId = await resolveUserId(request);
  await acknowledgeEvent(userId, eventId);
  return NextResponse.json({ eventId, acknowledged: true });
}
