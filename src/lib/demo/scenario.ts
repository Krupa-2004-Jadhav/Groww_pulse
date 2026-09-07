import { prisma } from "@/lib/db";
import { ReplayProvider, ScriptedEvent } from "@/lib/providers/replay";
import { upsertQuote } from "@/lib/ingest/quotes";
import { seedSymbolHistory } from "@/lib/seed/historical-seed";
import { runEvaluationTick } from "@/lib/pipeline/tick";
import { recordPollSuccess, recordPollFailure, ingestHealth } from "@/lib/health";
import { MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";
import { getOrCreateDemoUser } from "@/lib/demo-user";

const DEMO_SYMBOL = "DEMO";
// Once DEMO_SYMBOL is on a real watchlist, the live background poller
// (lib/pipeline/scheduler.ts) starts polling it too, using the app-wide
// REPLAY_SEED singleton (see lib/providers/index.ts). If this scenario used
// a DIFFERENT seed, the two providers would compute uncorrelated prices for
// the same symbol — whichever last wrote quotes_latest would produce a
// wild, meaningless jump the next time the other one polled. Matching the
// seed means both walks agree at every tick by construction. Caught live
// against the running dev server, not assumed.
const DEMO_SEED = process.env.REPLAY_SEED ?? "pulse-demo";
const DEMO_WATCHLIST_NAME = "Demo Scenario";

export interface ScenarioStep {
  label: string;
  detail: string;
}

export interface ScenarioResult {
  watchlistId: string;
  steps: ScenarioStep[];
  events: { type: string; tier: string; reason: string }[];
  healthAfterOutage: ReturnType<typeof ingestHealth>;
}

/**
 * A scripted, fully deterministic scenario (plan Phase 10): a mid-history
 * split (shown NOT to fabricate a crash — Phase 3's adjustment), a gap, a
 * volume spike, then a feed outage followed by automatic recovery. Same
 * seed every run, so this is demoable regardless of real market hours or
 * Twelve Data's credit budget — the whole point of the replay provider
 * (plan §0.1, §1).
 */
export async function runDemoScenario(): Promise<ScenarioResult> {
  const steps: ScenarioStep[] = [];
  const userId = await getOrCreateDemoUser();

  await prisma.symbol.upsert({
    where: { symbol: DEMO_SYMBOL },
    create: { symbol: DEMO_SYMBOL, name: "Pulse Demo Co.", exchange: "DEMO" },
    update: {},
  });
  await prisma.symbol.upsert({
    where: { symbol: MARKET_INDEX_SYMBOL },
    create: { symbol: MARKET_INDEX_SYMBOL, name: "Market index", exchange: "DEMO" },
    update: {},
  });

  let watchlist = await prisma.watchlist.findFirst({ where: { userId, name: DEMO_WATCHLIST_NAME } });
  if (!watchlist) {
    watchlist = await prisma.watchlist.create({ data: { userId, name: DEMO_WATCHLIST_NAME } });
  }
  const existingItem = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: DEMO_SYMBOL } },
  });
  if (!existingItem) {
    await prisma.watchlistItem.create({ data: { watchlistId: watchlist.id, symbol: DEMO_SYMBOL, position: 1, seedWatermark: 0 } });
  }

  // ONE provider instance for the whole scenario — seeding AND every live
  // tick. This matters, not just for tidiness: `priceAtTick`'s ":daily"
  // anchor computation re-derives the historical walk from the CALLING
  // instance's own `this.script`, not from what's actually stored in the
  // database. An earlier version used a separate provider (with only the
  // gap/volume/outage script) for live ticks — its anchor computation
  // silently ignored the split (which lived in a different instance's
  // script), producing a live price ~4x off from the real last close.
  // Caught live, not assumed — one instance, one script, one consistent
  // reality is the actual fix.
  const scenarioScript: ScriptedEvent[] = [
    { type: "split", symbol: `${DEMO_SYMBOL}:daily`, atTick: 150, fromFactor: 4, toFactor: 1 },
    { type: "gap", symbol: DEMO_SYMBOL, atTick: 0, pct: 0.08 },
    { type: "volume-surge", symbol: DEMO_SYMBOL, atTick: 1, multiplier: 4 },
    { type: "feed-outage", symbol: DEMO_SYMBOL, fromTick: 2, toTick: 4 },
  ];
  const provider = new ReplayProvider({ seed: DEMO_SEED, script: scenarioScript });

  // seedSymbolHistory is already idempotent PER SYMBOL (Phase 3: "never
  // re-fetch what you already have") — call it unconditionally for both
  // rather than gating on DEMO_SYMBOL's bar count and assuming the index
  // is seeded whenever DEMO is. That assumption broke in practice: the
  // two can end up out of sync (e.g. something else — a test's cleanup
  // touching the same MARKET_INDEX_SYMBOL name, or a partial prior run —
  // clears one but not the other), and a gate scoped to the wrong symbol
  // silently skips reseeding the one that's actually missing. Caught
  // against the real dev database, not assumed.
  const alreadySeeded = (await prisma.barDaily.count({ where: { symbol: DEMO_SYMBOL } })) > 0;
  await seedSymbolHistory(DEMO_SYMBOL, provider);
  await seedSymbolHistory(MARKET_INDEX_SYMBOL, provider);
  steps.push({
    label: "Historical seed with a mid-history 4-for-1 split",
    detail: alreadySeeded
      ? "Already seeded from a prior run — not re-fetched (Phase 3's idempotent seeding)."
      : "260 daily bars seeded with a split at day 150. adj_factor absorbs it in symbol_stats.vol_20d — no fabricated crash.",
  });

  await runEvaluationTick(); // establishes baseline symbol_stats before any live quote exists

  await pollOnce(provider);
  await runEvaluationTick();
  steps.push({ label: "Live tick: +8% gap at the open", detail: "Fires a gap and/or price_move signal, market-adjusted." });

  await pollOnce(provider);
  await runEvaluationTick();
  steps.push({ label: "Live tick: 4x volume surge", detail: "Fires a volume_surge signal, banded 'exceptional', no causal claim." });

  for (let i = 0; i < 2; i++) {
    try {
      await provider.getQuotes([DEMO_SYMBOL]);
      recordPollSuccess();
    } catch (err) {
      recordPollFailure(err instanceof Error ? err.message : String(err));
    }
  }
  steps.push({
    label: "Feed outage (2 ticks)",
    detail: "Provider throws; the last known quote is left untouched, never overwritten with nulls.",
  });

  await pollOnce(provider);
  await runEvaluationTick();
  steps.push({ label: "Recovery: feed resumes", detail: "The next successful poll clears the consecutive-failure streak." });

  const events = await prisma.symbolEvent.findMany({ where: { symbol: DEMO_SYMBOL }, orderBy: { seq: "asc" } });

  return {
    watchlistId: watchlist.id,
    steps,
    events: events.map((e) => ({ type: e.eventType, tier: e.tier, reason: e.reason })),
    healthAfterOutage: ingestHealth(),
  };
}

async function pollOnce(provider: ReplayProvider) {
  try {
    const [quote] = await provider.getQuotes([DEMO_SYMBOL]);
    await upsertQuote(quote);
    recordPollSuccess();
  } catch (err) {
    recordPollFailure(err instanceof Error ? err.message : String(err));
  }
}
