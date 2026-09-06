import { NextRequest, NextResponse } from "next/server";
import { dismissEvent } from "@/lib/watermark/ack";
import { resolveUserId } from "@/lib/demo-user";

// POST /api/events/:id/dismiss (plan Phase 7). Idempotent, same shape as /acknowledge.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  const userId = await resolveUserId(request);
  await dismissEvent(userId, eventId);
  return NextResponse.json({ eventId, dismissed: true });
}
