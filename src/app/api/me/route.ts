import { NextResponse } from "next/server";
import { getOrCreateDemoUser } from "@/lib/demo-user";

// GET /api/me — resolves the (single, auth-is-a-scope-cut) demo user id
// the frontend should use for every subsequent request.
export async function GET() {
  const userId = await getOrCreateDemoUser();
  return NextResponse.json({ userId });
}
