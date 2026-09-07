import { prisma } from "@/lib/db";
import { IngestPoller } from "@/lib/ingest/poller";
import { getMarketDataProvider } from "@/lib/providers";
import { runEvaluationTick } from "./tick";
import { runDemoScenario } from "@/lib/demo/scenario";

let started = false;

/**
 * A fresh deploy on an ephemeral-disk host (Render's free tier, notably —
 * SQLite resets whenever the instance restarts or spins down for
 * inactivity) would otherwise boot into a genuinely empty database: no
 * watchlists, no stories, nothing for a judge opening the demo link to
 * look at. Running the same scripted, deterministic demo scenario
 * (Phase 10 — a gap, a volume spike, a split, a feed outage) that's
 * already triggerable by hand from the sidebar means a fresh boot looks
 * identical to clicking "Run demo scenario" once. Only runs when NO
 * watchlist exists yet — never touches a real, already-populated database.
 */
async function seedDemoDataIfEmpty(): Promise<void> {
  const existing = await prisma.watchlist.count();
  if (existing > 0) return;

  try {
    await runDemoScenario();
    console.log("[pipeline] no existing watchlists — seeded the demo scenario automatically");
  } catch (err) {
    // Never let a failed auto-seed prevent the server from starting.
    console.error("[pipeline] auto-seed of demo scenario failed", err);
  }
}

/**
 * Starts the live pipeline: Phase 2's poller writes quotes on its own
 * market-hours-aware cadence, and after every cycle, the evaluation tick
 * (stats -> signals -> emitted/reconciled events) turns those quotes into
 * stories. One process-wide poller instance, so its backoff/failure state
 * (Phase 2) is continuous across cycles rather than reset each time.
 *
 * Idempotent: Next's dev-mode module reloading can call register() more
 * than once per process; `started` prevents a second overlapping poller.
 */
export async function startBackgroundJobs(): Promise<void> {
  if (started) return;
  started = true;

  await seedDemoDataIfEmpty();

  const provider = getMarketDataProvider();
  const poller = new IngestPoller(provider, async () => {
    await runEvaluationTick();
  });

  poller.start();
  console.log(`[pipeline] started (provider=${provider.name})`);
}
