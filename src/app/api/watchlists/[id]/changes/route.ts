import { NextRequest, NextResponse } from "next/server";
import { getChanges } from "@/lib/watermark/changes";
import { resolveUserId } from "@/lib/demo-user";

// GET /api/watchlists/:id/changes?userId=... (plan Phase 7).
// Read-only: does not advance the watermark. Call POST .../ack with the
// returned cursor once the client has actually rendered these events.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await resolveUserId(request);

  const result = await getChanges(userId, id);
  return NextResponse.json(result);
}
