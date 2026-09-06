import { prisma } from "@/lib/db";

/**
 * POST /watchlists/:id/ack (plan Phase 7): confirm-then-advance.
 *
 * `GREATEST(watermark, cursor)` — not a plain assignment — because a stale
 * device (one that fetched an older /changes response and is only now
 * getting around to acking it) must never rewind a watermark another
 * device has already advanced further. The comparison and the write happen
 * in one atomic UPSERT, so there's no read-then-write race between two
 * concurrent acks either.
 */
export async function ackWatermark(userId: string, watchlistId: string, cursor: number): Promise<number> {
  await prisma.$executeRaw`
    INSERT INTO "ReadState" ("userId", "watchlistId", "watermark", "lastSeenAt")
    VALUES (${userId}, ${watchlistId}, ${cursor}, ${new Date()})
    ON CONFLICT("userId", "watchlistId") DO UPDATE SET
      "watermark" = MAX("ReadState"."watermark", excluded."watermark"),
      "lastSeenAt" = excluded."lastSeenAt"
  `;

  const row = await prisma.readState.findUnique({ where: { userId_watchlistId: { userId, watchlistId } } });
  return row!.watermark;
}

/**
 * POST /events/:id/acknowledge and /dismiss (plan Phase 7) — idempotent via
 * the (userId, eventId) primary key. A double-ack is a no-op: the second
 * call just re-writes the same acknowledgedAt-is-set state, no error, no
 * second row, no duplicate side effect.
 */
export async function acknowledgeEvent(userId: string, eventId: number): Promise<void> {
  await prisma.userEventState.upsert({
    where: { userId_eventId: { userId, eventId } },
    create: { userId, eventId, acknowledgedAt: new Date() },
    update: { acknowledgedAt: new Date() },
  });
}

export async function dismissEvent(userId: string, eventId: number): Promise<void> {
  await prisma.userEventState.upsert({
    where: { userId_eventId: { userId, eventId } },
    create: { userId, eventId, dismissedAt: new Date() },
    update: { dismissedAt: new Date() },
  });
}
