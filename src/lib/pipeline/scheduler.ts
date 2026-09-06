import { IngestPoller } from "@/lib/ingest/poller";
import { getMarketDataProvider } from "@/lib/providers";
import { runEvaluationTick } from "./tick";

let started = false;

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
export function startBackgroundJobs(): void {
  if (started) return;
  started = true;

  const provider = getMarketDataProvider();
  const poller = new IngestPoller(provider, async () => {
    await runEvaluationTick();
  });

  poller.start();
  console.log(`[pipeline] started (provider=${provider.name})`);
}
