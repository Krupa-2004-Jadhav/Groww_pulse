import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { providerHealthStatus } from "@/lib/providers";
import { ingestHealth } from "@/lib/health";

// GET /health (plan Phase 1 Test Gate: "returns 200 with provider status").
export async function GET() {
  let dbOk = true;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    dbOk = false;
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "connected" : "unreachable",
    provider: providerHealthStatus(),
    ingest: ingestHealth(),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
