import { NextResponse } from "next/server";
import { runDemoScenario } from "@/lib/demo/scenario";

// POST /api/demo/run-scenario — triggers the scripted Phase 10 demo
// scenario on demand (plan: "triggerable on demand so the demo doesn't
// depend on live market hours or the Twelve Data credit budget"). Creates/
// reuses a "Demo Scenario" watchlist visible in the normal UI.
export async function POST() {
  const result = await runDemoScenario();
  return NextResponse.json(result);
}
