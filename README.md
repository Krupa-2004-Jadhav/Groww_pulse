# Groww Pulse — Since You Left

An "attention engine" for a stock watchlist: instead of redisplaying price,
volume, news, and sentiment at equal weight, it answers one question —
*"I was away from the market. What changed, why does it matter, and what
should I look at first?"*

Full product rationale: [`docs/product-thesis.md`](docs/product-thesis.md).

## Status: Hours 0–6 (product & data foundation)

Per the suggested 72-hour plan, this phase's deliverable is:

> A user can return after a checkpoint and receive a ranked change briefing.

Done:

- [x] Product thesis and non-goals — [`docs/product-thesis.md`](docs/product-thesis.md)
- [x] Signal vocabulary — [`src/lib/signals.ts`](src/lib/signals.ts)
- [x] Attention score (weighted, explainable, deterministic) — [`src/lib/attention-score.ts`](src/lib/attention-score.ts)
- [x] Schema (checkpoints, snapshots, events, preferences) — [`prisma/schema.prisma`](prisma/schema.prisma)
- [x] Deterministic 12-stock seed dataset — [`prisma/seed.ts`](prisma/seed.ts)
- [x] Demo scenario script — [`docs/demo-scenario.md`](docs/demo-scenario.md)
- [x] Screen sketches — [`docs/screens.md`](docs/screens.md)
- [x] Working briefing API (see below) — the deliverable is live, not just designed

Not yet built (later phases per the plan): the actual UI (hours 18–46),
threshold/preferences UI, alert deduplication lifecycle states, real
Groww/NSE ingestion jobs (currently seeded data stands in for them).

## Getting started

```bash
npm install
npm run db:seed   # applies migrations are already run; seeds demo data
npm run dev
```

Then fetch the briefing for the seeded watchlist:

```bash
# get the watchlist id
node -e "require('@prisma/client'); new (require('@prisma/client').PrismaClient)().watchlist.findFirst().then(w=>console.log(w.id))"

curl http://localhost:3000/api/watchlists/<id>/briefing
```

## API surface (hour 0–6 scope)

| Endpoint | Purpose |
|---|---|
| `GET /api/watchlists/:id/briefing` | Read-only ranked change briefing. Does **not** advance the checkpoint. |
| `POST /api/watchlists/:id/seen` | Advances `Watchlist.lastSeenAt` — call when the user actually opens the briefing. |
| `POST /api/watchlists/:id/instruments/:instrumentId/acknowledge` | Records a per-stock "Mark reviewed," independent of the watchlist-level checkpoint. |

See [`docs/product-thesis.md`](docs/product-thesis.md#the-checkpoint-model-the-load-bearing-idea)
for why these are three separate actions instead of one.

## Stack

Next.js (App Router, TypeScript) · Prisma + SQLite for local/demo
persistence (swap the datasource to Postgres for deployment — nothing else
changes) · Tailwind for the UI to come.
