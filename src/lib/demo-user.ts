import { prisma } from "@/lib/db";

/**
 * Auth is an explicit scope cut for this build (see README's scope-cut
 * table) — the schema still models multi-user watchlists/read-state
 * correctly, but there's no login flow. This resolves a single demo user,
 * created once, so the API routes have a real userId to key checkpoints on
 * without inventing a fake auth layer just to satisfy a foreign key.
 */
let cachedDemoUserId: string | null = null;

export async function getOrCreateDemoUser(): Promise<string> {
  if (cachedDemoUserId) return cachedDemoUserId;

  const existing = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) {
    cachedDemoUserId = existing.id;
    return existing.id;
  }

  const created = await prisma.user.create({ data: {} });
  cachedDemoUserId = created.id;
  return created.id;
}

/** Reads ?userId= from a request, falling back to the demo user. */
export async function resolveUserId(request: Request): Promise<string> {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("userId");
  if (explicit) return explicit;
  return getOrCreateDemoUser();
}
