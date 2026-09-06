import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { emitEvent } from "../emit";
import { reconcileOpenEvents } from "../reconcile";
import { Signal } from "@/lib/signals/types";

function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function firingSignal(type: string): Signal {
  return { category: "price", type, subScore: 80, tier: "high", message: "still firing." };
}

describe("reconcileOpenEvents (Phase 6, Test Gate 6)", () => {
  let symbol: string;
  let seq: number;

  beforeEach(async () => {
    symbol = uniqueSymbol("RC");
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
    const result = await emitEvent({
      symbol,
      eventType: "price_move",
      tier: "high",
      score: 85,
      reason: "moved sharply.",
      occurredAt: new Date(),
      triggerMetric: "z_score",
      triggerThreshold: 1.0,
    });
    seq = result.seq!;
  });

  afterEach(async () => {
    await prisma.symbolEvent.deleteMany({ where: { symbol } });
    await prisma.symbol.deleteMany({ where: { symbol } });
  });

  it("condition persists across passes -> event stays open, clearStreak resets to 0", async () => {
    await reconcileOpenEvents(symbol, [firingSignal("price_move")]);
    const row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.resolvedAt).toBeNull();
    expect(row?.clearStreak).toBe(0);
  });

  it("condition clears once then holds again -> NOT resolved (hysteresis)", async () => {
    await reconcileOpenEvents(symbol, []); // pass 1: clear -> streak 1
    await reconcileOpenEvents(symbol, [firingSignal("price_move")]); // pass 2: firing again -> streak resets to 0

    const row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.resolvedAt).toBeNull();
    expect(row?.clearStreak).toBe(0);
  });

  it("condition clears two passes running -> resolved", async () => {
    await reconcileOpenEvents(symbol, []); // pass 1: clear -> streak 1
    await reconcileOpenEvents(symbol, []); // pass 2: clear -> streak 2 -> resolve

    const row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.resolvedAt).not.toBeNull();
    expect(row?.clearStreak).toBe(2);
  });

  it("a symbol with no open events does no wasted work (no update queries)", async () => {
    // Resolve the only open event first.
    await prisma.symbolEvent.update({ where: { seq }, data: { resolvedAt: new Date() } });

    // Should return immediately without touching the (already-resolved) row again.
    await reconcileOpenEvents(symbol, []);
    const row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.clearStreak).toBe(0); // untouched — reconciliation never re-visited a resolved row
  });

  it("resolution requires exactly the hysteresis threshold, not one pass early", async () => {
    await reconcileOpenEvents(symbol, []); // streak 1
    let row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.resolvedAt).toBeNull();

    await reconcileOpenEvents(symbol, []); // streak 2 -> resolved
    row = await prisma.symbolEvent.findUnique({ where: { seq } });
    expect(row?.resolvedAt).not.toBeNull();
  });
});
