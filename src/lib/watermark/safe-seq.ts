import { prisma } from "@/lib/db";

export const SAFETY_LAG_MS = 2000;

/**
 * The highest event `seq` we can safely treat as "fully visible" (plan
 * Phase 7 — the headline correctness property).
 *
 * Why raw MAX(seq) is wrong: an autoincrementing PK is assigned BEFORE
 * commit. Under concurrent writers, a slow transaction holding seq=5 can
 * commit AFTER a fast transaction holding seq=7 already has. If a reader
 * takes MAX(seq)=7 as "everything up to here is delivered" at that moment,
 * and the watermark then advances to 7, seq=5 is permanently skipped once
 * it finally lands — it's below the watermark before a reader ever saw it.
 *
 * The fix: only trust rows old enough that any transaction which could
 * still be holding a lower seq has almost certainly committed by now.
 * `occurredAt` is set application-side at write time, so "old enough" means
 * `occurredAt < now() - SAFETY_LAG_MS`.
 *
 * Deliberately not airtight: a transaction held open longer than
 * SAFETY_LAG_MS could still be missed. The airtight alternative is
 * commit-order visibility (e.g. Postgres snapshot/xact ordering) or CDC off
 * the write-ahead log — real infrastructure for a guarantee this build
 * doesn't need, given its actual write pattern is single-row inserts with
 * no long-held transactions. A 2-second margin is generous relative to
 * that, and the tradeoff is named here rather than silently assumed.
 */
export async function computeSafeSeq(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SAFETY_LAG_MS);
  const result = await prisma.symbolEvent.aggregate({
    _max: { seq: true },
    where: { occurredAt: { lt: cutoff } },
  });
  return result._max.seq ?? 0;
}
