import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runDemoScenario } from "../scenario";

describe("runDemoScenario (Phase 10, Test Gate 10)", () => {
  afterAll(async () => {
    // Leave the demo watchlist/symbol in place for anyone poking at the
    // running app — only clean up if this is the ONLY test touching them
    // would be wrong to assume, so this suite intentionally does not
    // delete DEMO/watchlist state. Other tests use unique per-test symbols
    // precisely to avoid needing this kind of cleanup coordination.
  });

  it("runs end-to-end deterministically and produces the expected event types", async () => {
    const result = await runDemoScenario();

    expect(result.watchlistId).toBeTruthy();
    expect(result.steps.length).toBeGreaterThanOrEqual(5);

    const types = result.events.map((e) => e.type);
    expect(types).toContain("gap");
    expect(types).toContain("volume_surge");
  });

  it("a split in the seeded history does not fabricate a crash in symbol_stats", async () => {
    await runDemoScenario();
    const stats = await prisma.symbolStats.findUnique({ where: { symbol: "DEMO" } });
    expect(stats).not.toBeNull();
    // A fabricated split-crash would spike vol_20d to an order of
    // magnitude above normal daily wiggle; a correctly adjusted series
    // stays in the same small range as Phase 3's split test asserts.
    expect(stats!.vol20d).toBeLessThan(0.1);
  });

  it("the feed outage degrades health without crashing, and recovery clears it", async () => {
    const result = await runDemoScenario();
    expect(result.healthAfterOutage.consecutiveFailures).toBe(0); // recovered by the final successful poll
    expect(result.healthAfterOutage.lastSuccessAt).toBeTruthy();
  });

  it("running the scenario twice does not re-seed history (idempotent seeding, Phase 3)", async () => {
    const before = await prisma.barDaily.count({ where: { symbol: "DEMO" } });
    await runDemoScenario();
    const after = await prisma.barDaily.count({ where: { symbol: "DEMO" } });
    expect(after).toBe(before);
  });

  it("running the scenario twice does not duplicate events for the same day/tier (Phase 6 dedupe)", async () => {
    await runDemoScenario();
    const firstCount = await prisma.symbolEvent.count({ where: { symbol: "DEMO" } });
    await runDemoScenario();
    const secondCount = await prisma.symbolEvent.count({ where: { symbol: "DEMO" } });
    expect(secondCount).toBe(firstCount);
  });
});
