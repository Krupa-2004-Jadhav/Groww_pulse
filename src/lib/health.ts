/**
 * In-process ingest health tracker. The Phase 2 poller reports into this on
 * every cycle; /api/health reads it out. Deliberately a plain module-level
 * singleton — one process, one poller, no need for anything heavier.
 */

interface PollOutcome {
  at: Date;
  ok: boolean;
  error?: string;
}

const RECENT_WINDOW = 20;
const recentOutcomes: PollOutcome[] = [];

let lastSuccessAt: Date | null = null;
let consecutiveFailures = 0;

export function recordPollSuccess() {
  lastSuccessAt = new Date();
  consecutiveFailures = 0;
  push({ at: new Date(), ok: true });
}

export function recordPollFailure(error: string) {
  consecutiveFailures += 1;
  push({ at: new Date(), ok: false, error });
}

function push(outcome: PollOutcome) {
  recentOutcomes.push(outcome);
  if (recentOutcomes.length > RECENT_WINDOW) recentOutcomes.shift();
}

export function ingestHealth() {
  const errorRate = recentOutcomes.length === 0 ? 0 : recentOutcomes.filter((o) => !o.ok).length / recentOutcomes.length;

  return {
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    secondsSinceLastSuccess: lastSuccessAt ? Math.round((Date.now() - lastSuccessAt.getTime()) / 1000) : null,
    consecutiveFailures,
    recentErrorRate: Math.round(errorRate * 100) / 100,
    lastError: [...recentOutcomes].reverse().find((o) => !o.ok)?.error ?? null,
  };
}

/** Test-only: reset module-level state between test files. */
export function __resetHealthForTests() {
  recentOutcomes.length = 0;
  lastSuccessAt = null;
  consecutiveFailures = 0;
}
