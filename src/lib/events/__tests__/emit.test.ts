import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { emitEvent, buildDedupeKey } from "../emit";

function uniqueSymbol(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

describe("emitEvent (Phase 6, Test Gate 6)", () => {
  let symbol: string;

  beforeEach(async () => {
    symbol = uniqueSymbol("EV");
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });
  });

  afterEach(async () => {
    await prisma.userEventState.deleteMany({ where: { event: { symbol } } });
    await prisma.symbolEvent.deleteMany({ where: { symbol } });
    await prisma.symbol.deleteMany({ where: { symbol } });
  });

  function baseInput(overrides: Partial<Parameters<typeof emitEvent>[0]> = {}) {
    return {
      symbol,
      eventType: "price_move",
      tier: "high" as const,
      score: 85,
      reason: `${symbol} moved sharply.`,
      occurredAt: new Date("2026-03-10T14:00:00Z"),
      triggerMetric: "z_score",
      triggerThreshold: 1.0,
      ...overrides,
    };
  }

  it("the same event detected twice in one pass produces exactly one row", async () => {
    const first = await emitEvent(baseInput());
    const second = await emitEvent(baseInput());

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false); // deduped, not an error

    const count = await prisma.symbolEvent.count({ where: { symbol } });
    expect(count).toBe(1);
  });

  it("a retry with the exact same dedupe key is harmless (idempotent write)", async () => {
    await emitEvent(baseInput());
    await expect(emitEvent(baseInput())).resolves.toBeDefined();
    const count = await prisma.symbolEvent.count({ where: { symbol } });
    expect(count).toBe(1);
  });

  it("escalation to a worse tier gets a new row, not a mutated old one, and inherits no ack", async () => {
    const medium = await emitEvent(baseInput({ tier: "medium", score: 50 }));
    expect(medium.seq).not.toBeNull();

    // User acknowledges the medium event.
    await prisma.userEventState.create({
      data: { userId: "test-user", eventId: medium.seq!, acknowledgedAt: new Date() },
    });

    // Same day, same type, but now escalates to high.
    const high = await emitEvent(baseInput({ tier: "high", score: 90 }));
    expect(high.inserted).toBe(true);
    expect(high.seq).not.toBe(medium.seq);

    const mediumRow = await prisma.symbolEvent.findUnique({ where: { seq: medium.seq! } });
    expect(mediumRow?.tier).toBe("medium"); // old row untouched, not mutated to "high"

    const highAck = await prisma.userEventState.findUnique({
      where: { userId_eventId: { userId: "test-user", eventId: high.seq! } },
    });
    expect(highAck).toBeNull(); // the new (high) row starts unacked
  });

  it("a fresh date bucket also produces a new row (not a mutation)", async () => {
    const day1 = await emitEvent(baseInput({ occurredAt: new Date("2026-03-10T14:00:00Z") }));
    const day2 = await emitEvent(baseInput({ occurredAt: new Date("2026-03-11T14:00:00Z") }));
    expect(day1.seq).not.toBe(day2.seq);
  });

  it("buildDedupeKey is symbol:type:date:tier", () => {
    const key = buildDedupeKey({ symbol: "AAPL", eventType: "price_move", tier: "high", occurredAt: new Date("2026-03-10T14:00:00Z") });
    expect(key).toBe("AAPL:price_move:2026-03-10:high");
  });
});
