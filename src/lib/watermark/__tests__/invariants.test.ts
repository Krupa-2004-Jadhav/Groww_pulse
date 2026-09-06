import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { computeSafeSeq, SAFETY_LAG_MS } from "../safe-seq";
import { getChanges } from "../changes";
import { ackWatermark, acknowledgeEvent } from "../ack";

function uniqueId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

async function makeEvent(symbol: string, opts: Partial<{ occurredAt: Date; score: number; seq: number }> = {}) {
  if (opts.seq !== undefined) {
    await prisma.$executeRaw`
      INSERT INTO "SymbolEvent" ("seq", "symbol", "eventType", "tier", "score", "reason", "occurredAt", "clearStreak", "dedupeKey")
      VALUES (${opts.seq}, ${symbol}, 'price_move', 'low', ${opts.score ?? 50}, 'test event', ${opts.occurredAt ?? new Date()}, 0, ${uniqueId("dk")})
    `;
    return opts.seq;
  }
  const row = await prisma.symbolEvent.create({
    data: {
      symbol,
      eventType: "price_move",
      tier: "low",
      score: opts.score ?? 50,
      reason: "test event",
      occurredAt: opts.occurredAt ?? new Date(),
      dedupeKey: uniqueId("dk"),
    },
  });
  return row.seq;
}

describe("Phase 7 — watermark race-safety invariants (Test Gate 7, the invariant)", () => {
  let symbol: string;
  let userId: string;
  let watchlistId: string;

  beforeEach(async () => {
    symbol = uniqueId("WM").toUpperCase();
    userId = uniqueId("user");
    await prisma.symbol.create({ data: { symbol, name: symbol, exchange: "TEST" } });

    const owner = await prisma.user.create({ data: {} });
    const wl = await prisma.watchlist.create({ data: { userId: owner.id, name: "Watermark test" } });
    watchlistId = wl.id;
    await prisma.watchlistItem.create({ data: { watchlistId, symbol, position: 1, seedWatermark: 0 } });
  });

  afterEach(async () => {
    await prisma.userEventState.deleteMany({ where: { event: { symbol } } });
    await prisma.readState.deleteMany({ where: { watchlistId } });
    await prisma.watchlistItem.deleteMany({ where: { watchlistId } });
    await prisma.watchlist.delete({ where: { id: watchlistId } });
    await prisma.symbolEvent.deleteMany({ where: { symbol } });
    await prisma.symbol.deleteMany({ where: { symbol } });
  });

  it("no lost event: an event written between a /changes read and its /ack appears on the next /changes", async () => {
    const old = new Date(Date.now() - 10_000);
    await makeEvent(symbol, { occurredAt: old });

    const firstRead = await getChanges(userId, watchlistId);
    expect(firstRead.events).toHaveLength(1);
    await ackWatermark(userId, watchlistId, firstRead.cursor);

    // A new event lands right after the ack, but before it's aged past the safety lag.
    const freshSeq = await makeEvent(symbol, { occurredAt: new Date() });

    // Immediately re-reading won't show it yet (still inside the lag window) — that's expected, not a loss.
    const secondRead = await getChanges(userId, watchlistId);
    expect(secondRead.events.map((e) => e.seq)).not.toContain(freshSeq);

    // Once it ages past the lag, it must appear.
    await prisma.symbolEvent.update({
      where: { seq: freshSeq },
      data: { occurredAt: new Date(Date.now() - (SAFETY_LAG_MS + 500)) },
    });
    const thirdRead = await getChanges(userId, watchlistId);
    expect(thirdRead.events.map((e) => e.seq)).toContain(freshSeq);
  });

  it("safety-lag gap: a lower-seq event that commits after a higher-seq one is not permanently skipped", async () => {
    const t0 = new Date("2026-05-01T12:00:00.000Z");

    // The "fast" transaction: commits first, gets the higher seq.
    const highSeq = await makeEvent(symbol, { occurredAt: t0 });

    // Immediately after (still well inside the 2s lag), a reader must not yet trust it.
    const tooSoon = new Date(t0.getTime() + 500);
    expect(await computeSafeSeq(tooSoon)).toBeLessThan(highSeq);

    // The "slow" transaction: was allocated a LOWER seq before the fast one,
    // but only commits now, 0.5s after the fast one already landed.
    const lowSeq = highSeq - 1;
    await makeEvent(symbol, { seq: lowSeq, occurredAt: new Date(t0.getTime() + 500) });

    // 2.1s after the fast transaction's occurredAt, a reader polls again.
    const later = new Date(t0.getTime() + SAFETY_LAG_MS + 100);
    const safeSeqLater = await computeSafeSeq(later);
    expect(safeSeqLater).toBeGreaterThanOrEqual(highSeq);

    // The low-seq row — despite its own occurredAt still being under 2s old
    // at `later` — is included, because `seq <= safeSeq` is the actual
    // visibility test, not "this row's own age." Had the reader instead
    // advanced its watermark to a naive MAX(seq)=highSeq the moment the
    // fast transaction landed (before the slow one existed), this lowSeq
    // row would be permanently invisible (seq < watermark) once it finally
    // committed — that's the exact bug the lag prevents.
    const result = await getChanges(userId, watchlistId);
    expect(result.events.map((e) => e.seq)).toContain(lowSeq);
  });

  it("double-ack is a no-op", async () => {
    const seq = await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    await acknowledgeEvent(userId, seq);
    await expect(acknowledgeEvent(userId, seq)).resolves.not.toThrow();

    const count = await prisma.userEventState.count({ where: { userId, eventId: seq } });
    expect(count).toBe(1); // still exactly one row, not two
  });

  it("a stale-device ack (lower cursor) does not rewind the watermark", async () => {
    await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    const current = await ackWatermark(userId, watchlistId, 500);
    expect(current).toBe(500);

    // A second, older device replays an ack with a lower cursor.
    const afterStaleAck = await ackWatermark(userId, watchlistId, 100);
    expect(afterStaleAck).toBe(500); // unchanged — GREATEST prevented the rewind
  });

  it("a freshly-added symbol does not dump its pre-existing event history (seed_watermark)", async () => {
    // Pre-existing history before the symbol is "added" to this watchlist.
    const oldSeq = await makeEvent(symbol, { occurredAt: new Date(Date.now() - 30_000) });

    // Simulate re-adding the symbol fresh: bump its seed_watermark to the
    // current safe_seq, as watchlist add-flow does (Phase 8).
    const currentSafeSeq = await computeSafeSeq();
    await prisma.watchlistItem.update({
      where: { watchlistId_symbol: { watchlistId, symbol } },
      data: { seedWatermark: currentSafeSeq },
    });

    const result = await getChanges(userId, watchlistId);
    expect(result.events.map((e) => e.seq)).not.toContain(oldSeq);

    // A NEW event after the re-add must still show up.
    const newSeq = await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    const result2 = await getChanges(userId, watchlistId);
    expect(result2.events.map((e) => e.seq)).toContain(newSeq);
  });

  it("two devices, one watchlist: events are delivered exactly once, no loss, across both", async () => {
    await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });

    // "Device A" and "device B" are the same user, same watchlist — they
    // share read_state, which is the whole point (Phase 7's model has no
    // per-device state, only per-user).
    const deviceARead = await getChanges(userId, watchlistId);
    expect(deviceARead.events).toHaveLength(1);
    await ackWatermark(userId, watchlistId, deviceARead.cursor);

    // Device B reads afterward — must NOT see the same event again (already acked).
    const deviceBRead = await getChanges(userId, watchlistId);
    expect(deviceBRead.events).toHaveLength(0);

    // A new event arrives; both devices must see it exactly once between them.
    await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    const deviceASecondRead = await getChanges(userId, watchlistId);
    expect(deviceASecondRead.events).toHaveLength(1);
    await ackWatermark(userId, watchlistId, deviceASecondRead.cursor);

    const deviceBSecondRead = await getChanges(userId, watchlistId);
    expect(deviceBSecondRead.events).toHaveLength(0); // device A already confirmed it
  });

  it("an acknowledged event is excluded from subsequent /changes reads", async () => {
    const seq = await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    let result = await getChanges(userId, watchlistId);
    expect(result.events.map((e) => e.seq)).toContain(seq);

    await acknowledgeEvent(userId, seq);
    result = await getChanges(userId, watchlistId);
    expect(result.events.map((e) => e.seq)).not.toContain(seq);
  });

  it("/changes never advances the watermark itself — only /ack does", async () => {
    await makeEvent(symbol, { occurredAt: new Date(Date.now() - 10_000) });
    await getChanges(userId, watchlistId);
    await getChanges(userId, watchlistId);
    await getChanges(userId, watchlistId);

    const readState = await prisma.readState.findUnique({ where: { userId_watchlistId: { userId, watchlistId } } });
    expect(readState).toBeNull(); // never created/advanced by reads alone
  });
});
