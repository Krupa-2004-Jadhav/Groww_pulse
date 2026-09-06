import { prisma } from "@/lib/db";
import { ReplayProvider, ScriptedEvent } from "@/lib/providers/replay";
import { upsertQuote } from "@/lib/ingest/quotes";
import { seedSymbolHistory } from "@/lib/seed/historical-seed";
import { runEvaluationTick } from "@/lib/pipeline/tick";
import { recordPollSuccess, recordPollFailure, ingestHealth } from "@/lib/health";
import { MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";
import { getOrCreateDemoUser } from "@/lib/demo-user";

const DEMO_SYMBOL = "DEMO";
const DEMO_SEED = "pulse-scenario-v1";
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

  // Only seed once — re-running the scenario against already-seeded history
  // exercises the "never re-fetch what you already have" path too.
  const alreadySeeded = (await prisma.barDaily.count({ where: { symbol: DEMO_SYMBOL } })) > 0;
  if (!alreadySeeded) {
    const historyScript: ScriptedEvent[] = [
      { type: "split", symbol: `${DEMO_SYMBOL}:daily`, atTick: 150, fromFactor: 4, toFactor: 1 },
    ];
    await seedSymbolHistory(DEMO_SYMBOL, new ReplayProvider({ seed: DEMO_SEED, script: historyScript }));
    await seedSymbolHistory(MARKET_INDEX_SYMBOL, new ReplayProvider({ seed: DEMO_SEED }));
  }
  steps.push({
    label: "Historical seed with a mid-history 4-for-1 split",
    detail: alreadySeeded
      ? "Already seeded from a prior run — not re-fetched (Phase 3's idempotent seeding)."
      : "260 daily bars seeded with a split at day 150. adj_factor absorbs it in symbol_stats.vol_20d — no fabricated crash.",
  });

  await runEvaluationTick(); // establishes baseline symbol_stats before any live quote exists

  const liveScript: ScriptedEvent[] = [
    { type: "gap", symbol: DEMO_SYMBOL, atTick: 0, pct: 0.08 },
    { type: "volume-surge", symbol: DEMO_SYMBOL, atTick: 1, multiplier: 4 },
    { type: "feed-outage", symbol: DEMO_SYMBOL, fromTick: 2, toTick: 4 },
  ];
  const liveProvider = new ReplayProvider({ seed: DEMO_SEED, script: liveScript });

  await pollOnce(liveProvider);
  await runEvaluationTick();
  steps.push({ label: "Live tick: +8% gap at the open", detail: "Fires a gap and/or price_move signal, market-adjusted." });

  await pollOnce(liveProvider);
  await runEvaluationTick();
  steps.push({ label: "Live tick: 4x volume surge", detail: "Fires a volume_surge signal, banded 'exceptional', no causal claim." });

  for (let i = 0; i < 2; i++) {
    try {
      await liveProvider.getQuotes([DEMO_SYMBOL]);
      recordPollSuccess();
    } catch (err) {
      recordPollFailure(err instanceof Error ? err.message : String(err));
    }
  }
  steps.push({
    label: "Feed outage (2 ticks)",
    detail: "Provider throws; the last known quote is left untouched, never overwritten with nulls.",
  });

  await pollOnce(liveProvider);
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
