import { NextRequest, NextResponse } from "next/server";
import { ackWatermark } from "@/lib/watermark/ack";
import { resolveUserId } from "@/lib/demo-user";

// POST /api/watchlists/:id/ack { cursor } (plan Phase 7). Confirm-then-advance —
// pass the `cursor` a prior GET .../changes returned. Uses GREATEST under the
// hood, so a stale/out-of-order ack can never rewind the watermark.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await resolveUserId(request);
  const body = await request.json().catch(() => ({}));

  const cursor = Number(body.cursor);
  if (!Number.isFinite(cursor) || cursor < 0) {
    return NextResponse.json({ error: "cursor must be a non-negative number" }, { status: 400 });
  }

  const watermark = await ackWatermark(userId, id, cursor);
  return NextResponse.json({ watchlistId: id, watermark });
}
