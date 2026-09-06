# Pulse — "Since You Left" Market Watchlist

Built from [`Pulse_Implementation_Plan.pdf`](Pulse_Implementation_Plan.pdf), a
72-hour build spec structured as 10 phases, each with its own test gate. This
README is the graded narrative the plan asks for (§6.5) — it explains what
was built, the decisions behind it, and what's honestly still missing.

The product answers one question: *"I was away — what meaningfully changed
in my watchlist, why does it matter, and what should I look at first?"* Not
a price dashboard. The differentiator is a per-user, race-safe change
engine that ranks stocks by how much they genuinely deserve attention.

## Quick start

```bash
npm install
npx prisma migrate deploy   # schema is already migrated in prisma/migrations
npm run dev                 # starts the app AND the background ingest/evaluation pipeline
npm test                    # 118 tests, all phases
```

Open `http://localhost:3000`. `MARKET_PROVIDER` defaults to `replay`
(deterministic, simulated, no live dependency) — see `.env.example` for
switching to `twelvedata`. Click **"▶ Run demo scenario"** in the sidebar
for a scripted walkthrough that doesn't depend on market hours (see
[Demo mode](#demo-mode--resilience) below).

## The three required capabilities

| Capability | Where |
|---|---|
| 1. Create and manage a watchlist | Phase 8 — `lib/watchlists/crud.ts`, `/api/watchlists/*` |
| 2. View latest market information | Phase 2 + 9 — ingest poller, `/api/health`, staleness banners in the UI |
| 3. Return later and see what changed | Phases 5–7 + 9 — attention scoring, the watermark, the Briefing UI |

All three have dedicated tests and stayed green through every later phase —
no phase was allowed to regress an earlier one (plan §7).

## Architecture

```
┌──────────────────────────┐
│ Twelve Data /time_series  │
│ daily bars + splits       │  seed only, once per symbol
│ (or ReplayProvider)       │  (Phase 3)
└────────────┬──────────────┘
             │
             ▼
┌───────────────┐  poll   ┌───────────────────────┐
│ Twelve Data    │◄────────│ Ingest Poller          │  idempotent, out-of-order-safe
│ /quote  OR     │  quotes │ (MarketDataProvider)   │  (Phase 2)
│ ReplayProvider │         └──────────┬─────────────┘
└────────────────┘                    │ writes quotes_latest
                                       ▼
                    ┌──────────────────────────────────┐
                    │            SQLite / Postgres       │
                    │ symbols, quotes_latest, bars_daily, │
                    │ symbol_stats, symbol_events,        │
                    │ watchlists, watchlist_items,        │
                    │ read_state, user_event_state        │
                    └──────────┬───────────────┬─────────┘
                               │                │
                 ┌─────────────▼───┐   ┌────────▼──────────────┐
                 │ Evaluation tick │   │ API (Next.js routes)   │
                 │ update stats    │   │ /watchlists CRUD       │
                 │ compute signals │   │ /changes (safety-lag)  │
                 │ emit + reconcile│   │ /ack, /events/:id/*    │
                 └─────────────────┘   └───────────┬────────────┘
                                                    │
                                          ┌─────────▼─────────┐
                                          │ React "Since You   │
                                          │ Left" briefing UI  │
                                          └────────────────────┘
```

`src/instrumentation.ts` starts the poller + evaluation tick once when the
Next.js server process boots (`lib/pipeline/scheduler.ts`), so this runs
continuously for the life of the process — it isn't just tested-in-isolation
functions.

### The principle: compute once per symbol, correct once per user

**Materiality is computed once per symbol; correctness is maintained once
per user.** 1M users watching 5,000 unique symbols means 5,000 signal
evaluations, not 50M:

- The ingest poller (Phase 2) hits the **deduplicated union** of every
  watchlisted symbol — one HTTP call per poll cycle, batched
  (`/quote?symbol=AAPL,MSFT,...`), never one call per user or per watchlist.
- The evaluation tick (Phase 4–6) computes each symbol's signals **once**,
  against a fixed, symbol-level reference ("since the previous close" — see
  below), and emits at most one `symbol_events` row per (symbol, signal
  type, day, tier). It never re-runs per user.
- The append-only `symbol_events` log is shared by every watchlist that
  references the symbol. A user's personalized "since you left" feed is a
  cheap indexed read: `WHERE symbol IN (my symbols) AND seq > my_watermark`
  (`lib/watermark/changes.ts`). All the personalization lives in that one
  comparison, not in re-computing anything.

**A correction made along the way, worth stating explicitly:** the Phase 4
signal table's "Window = since last visit" reads as per-user. Taken
literally, it would mean re-running every signal for every user's own
checkpoint — exactly the O(users × symbols) blowup the architecture exists
to avoid. The resolution: signals are computed against a fixed "since the
previous close" reference (`lib/pipeline/evaluate.ts`), shared by every
watcher. The truly personal "since **you** left" experience is assembled
entirely at read time by the watermark filter — a user away three days
simply sees the union of three days' worth of already-computed, still-open,
un-acked events. This is a case where implementing the plan's literal
wording would have contradicted the plan's own stated goal; the goal won.

## What counts as a "meaningful change"

Six pure, individually unit-tested signal functions (`lib/signals/*.ts`),
each `(quote, stats, window) -> Signal | null` — no hidden state, no I/O:

| Signal | Rule | Category (weight) |
|---|---|---|
| Price move | `residual = actualReturn − beta×indexReturn`; `z = residual / (vol_20d × √days)`; fires if \|z\| ≥ 1.0 | price (30%) |
| Volatility expansion | short-window vol ÷ vol_20d; fires if ratio ≥ 1.3 | volatility (15%) |
| Volume anomaly | volume ÷ avg_volume_20d; banded normal/elevated/significant/exceptional; **never claims a cause** | volume (20%) |
| Relative performance | stock return − benchmark return, in percentage points; fires if ≥ 1.5pp | relative (15%) |
| 52-week break | price ≥ high_52w or ≤ low_52w; fixed sub-score (70) | event (20%) |
| Gap | (day_open − prev_close) / prev_close, scaled by the symbol's own vol | event (20%) |

**Market-adjustment, worked example:** during a market-wide selloff, a stock
moving *exactly* in line with its own beta produces `residual ≈ 0` — no
signal — even though the raw headline number ("down 6%!") looks dramatic.
Only the **residual** move (what the stock did beyond what the market
already explains) counts. Verified directly:
`lib/signals/__tests__/price-move.test.ts` — "market-wide selloff: a stock
moving exactly at its beta produces residual ~0 -> no false alert."

**Split, worked example:** a 4-for-1 split turns a raw ~$500 close into a
~$125 close overnight. Naively diffed, that's a fabricated −75% crash.
`bars_daily.adj_factor` (computed in `lib/seed/adjust.ts` from `/splits`)
multiplies every pre-split close so the *adjusted* series is continuous —
verified in `lib/seed/__tests__/adjust.test.ts` and, end-to-end through the
real pipeline, `lib/demo/__tests__/scenario.test.ts` ("a split in the
seeded history does not fabricate a crash in symbol_stats").

**Illiquid names:** `vol_20d` is floored at 1bp (`MIN_VOLATILITY` in
`lib/stats/math.ts`) so a near-zero-volatility fixture never produces a
divide-by-zero / `Infinity` z-score.

### The attention score (the "corrected" model, plan §5)

`symbol_events` stores one row **per fired signal** (matching the schema's
`event_type` enum and its `symbol:type:date:tier` dedupe key — see below).
The UI needs one combined per-symbol score, so grouping happens at the read
layer (`lib/scoring/group-into-stories.ts`), using:

```
base = Σ (category_weight × signal.subScore)      // weights sum to 1.0 — self-limiting, no artificial clamp
fired = count(signals where subScore > 40)
mult = fired >= 3 ? 1.15 : fired == 2 ? 1.05 : 1.0
score = min(100, base × mult)
```

A weighted **sum** (not an average) because the weights already sum to
1.0 — each category contributes at most `weight × 100`, so the base is
self-capping. The multiplier rewards genuine cross-signal agreement (three
independent, only-moderate signals corroborating each other is more
trustworthy than one strong signal alone) without letting several mediocre
signals fake a strong score on their own. The reason string is the top 2–3
firing signals' own messages, concatenated — nothing invented, nothing
summarized by an LLM. Test gate:
`lib/scoring/__tests__/attention-score.test.ts`.

## Race-safety: the watermark (the headline correctness property)

**Never advance or read the watermark up to raw `MAX(seq)`.** An
autoincrementing PK is assigned *before* commit. Under concurrent writers, a
slow transaction holding a lower `seq` can commit *after* a faster
transaction with a higher `seq` already has. If a reader trusts
`MAX(seq)` the instant that fast transaction lands, and a client acks up to
that value, the slow transaction's row — once it finally commits — is
permanently below the watermark. It's lost, not delayed.

**The fix:** `computeSafeSeq()` (`lib/watermark/safe-seq.ts`) only trusts a
`seq` value once a row that old exists — `MAX(seq) WHERE occurred_at < now()
- 2s`. A row that age implies (given this build's write pattern) that
nothing lower is still in flight.

**Verified directly, not just asserted:** the test suite constructs the
actual race — a higher-seq row committed first, then a *lower*-seq row
inserted 0.5s later (simulating a slow transaction that was allocated its
seq before the fast one but landed after) — and proves the lower-seq row is
still delivered once it lands, using controlled timestamps rather than real
sleeps for determinism
(`lib/watermark/__tests__/invariants.test.ts` — "safety-lag gap").

**The rejected alternative:** commit-order visibility (e.g. Postgres
`pg_current_snapshot`/transaction-commit ordering) or CDC off the
write-ahead log would be airtight regardless of transaction duration. Not
built, because this system's actual write pattern is single-row inserts
with no long-held transactions — a 2-second margin is generous relative to
that, and the added operational complexity (a CDC pipeline, or querying
transaction visibility directly) buys correctness this build's write
pattern doesn't need. Named here as a conscious cut, not a gap nobody
noticed.

**GET `/changes` never advances the watermark** — read-only, always. Only
`POST /ack { cursor }` does, and it does so as `watermark =
GREATEST(watermark, cursor)` in a single atomic UPSERT, so a stale device
replaying an old cursor can never rewind another device's progress. Both
directions are tested: no-lost-event-across-read/ack, double-ack is a
no-op, stale-device-ack doesn't rewind, freshly-added symbols don't dump
backfilled history (`seed_watermark`), and two devices sharing one
watchlist see every event exactly once between them.

## Event lifecycle: dedupe, hysteresis, escalation (Phase 6)

- **Dedupe key** = `symbol:type:date-bucket:tier`. `INSERT ... ON
  CONFLICT(dedupeKey) DO NOTHING` — the same signal detected twice in one
  evaluation pass, or a retried write, lands as exactly one row.
- **Resolution via recheck-on-rollup**, not time-decay: every evaluation
  tick re-evaluates each symbol's currently-open events against a freshly
  computed signal set. **Hysteresis** requires the condition to read
  "clear" for **2 consecutive passes** before resolving — one clear pass
  alone doesn't resolve it, preventing flapping open/closed on a single
  noisy tick (`lib/events/reconcile.ts`).
- **Escalation never mutates an old row.** A worse move (or a fresh
  occurrence) gets a different tier or date-bucket, hence a different
  dedupe key, hence a brand-new row with a clean, unacknowledged state. An
  acked medium-tier event that escalates to high produces a second,
  unacked row — verified in `lib/events/__tests__/emit.test.ts`.

## Scope-cut table

A stated cut reads as judgment; an unstated gap reads as failure.

| Cut | Why |
|---|---|
| Auth / login | Out of scope for a 72-hour build focused on the change-detection engine. The schema still models multi-user watchlists and per-user read-state correctly (`users`, `read_state` keyed by `(userId, watchlistId)`) — there's just one resolved "demo user" (`lib/demo-user.ts`) instead of a login flow. |
| Trading / order placement | Not the product. Explicitly an information & monitoring tool (plan §8) — no buy/sell language anywhere in the codebase. |
| Charts / technical indicators | Would compete with the actual differentiator (the change briefing) for screen space and engineering time. |
| Filing/earnings signal wired into the live pipeline | The pure signal function and its tests exist (`lib/signals/filing-event.ts`), sourced deterministically from `/earnings`, `/splits`, `/dividends` with no NLP. Wiring live earnings/dividend data into a stored, queryable events table (so the pipeline can compute it automatically) was cut for time. The "event" weight category isn't empty without it — `week52_break` and `gap` both live there too. |
| WebSockets / streaming | Twelve Data's streaming tier is paid-only, and a "since you left" product doesn't need sub-second latency by design (plan §1). REST polling, cadence-adjusted to market hours. The `MarketDataProvider` interface means a streaming provider could slot in behind it later without touching business logic. |
| Kafka / Redis / Kubernetes / microservices | One process, one database. At this scale (a handful of symbols, one poller), the added operational surface of a queue or a cache would cost more than it returns. Explicitly penalized by over-engineering (plan §6.4) if built anyway. |
| A separate test database | DB-touching tests share the dev SQLite file with uniquely-generated fixture symbols per test, cleaned up per test, rather than a dedicated test DB. Running test *files* in parallel against that shared file produced intermittent lock/FK errors under load, so `vitest.config.ts` sets `fileParallelism: false` — tests within a file already ran sequentially; this just extends that guarantee across files. A dedicated test DB would remove the constraint; not worth the setup at this project's size. |
| Fastify + Vite (the plan's suggested stack) | Next.js App Router already does what Fastify was chosen for (typed routes, minimal, boring) and doubles as the frontend host — "one deployable" was achieved without adding a second framework. |

## What breaks first at 100× — and what I'd do

At roughly 100× today's scale (hundreds of thousands of watched symbols,
millions of users):

1. **SQLite is the first wall**, well before 100× — it's a single-writer
   database. Move `datasource` to `postgresql` in `prisma/schema.prisma`
   (the schema was written to be Postgres-portable: `MAX(a,b)` stands in
   for `GREATEST()`, autoincrement for `BIGSERIAL` — both are noted inline
   in `schema.prisma`). This alone buys real concurrent writers.
2. **The evaluation tick becomes the bottleneck next.** It currently loops
   over every watched symbol sequentially in one process
   (`lib/pipeline/tick.ts`). At 100×, this needs to become a proper queue —
   a job per symbol, fanned out across workers — which is exactly the
   point in the architecture where "materiality computed once per symbol"
   starts paying for itself: the fan-out is over *symbols* (bounded, tens
   of thousands), not over users (unbounded).
3. **The safety-lag watermark's 2-second margin** was sized for this
   build's single-row-insert write pattern. At real scale with batched
   writes or longer transactions, that margin either needs to grow (cheap,
   but adds latency to every read) or the system needs to move to the
   commit-order/CDC approach named above as rejected-for-now — worth
   revisiting first, not blindly increasing the constant.
4. **The ingest poller's "union of watched symbols" query** becomes a
   large `DISTINCT` scan across `watchlist_items`. This wants a
   materialized, incrementally-maintained symbol set (updated on
   add/remove, not recomputed every poll) rather than the current live
   query in `lib/ingest/quotes.ts`.
5. **Twelve Data's free tier (800 credits/day) stops being viable almost
   immediately** past a few dozen real symbols polled continuously — a
   paid tier or a different provider would be needed; the
   `MarketDataProvider` abstraction means this is a config change, not a
   rewrite.

## Provider

**Twelve Data**, sole live provider, chosen deliberately for simplicity —
one API key covers quotes, historical bars, splits, dividends, earnings,
and symbol search for US equities on the free Basic plan (800 credits/day,
8 req/min), which keeps the integration surface small for a 72-hour build.
Verified live against the provided key during development: `/quote`,
`/time_series`, `/splits`, `/dividends`, `/symbol_search`, and `/earnings`
all responded correctly.

Everything flows through one interface, `MarketDataProvider` /
`HistoricalDataProvider` (`lib/providers/types.ts`) — nothing else in the
codebase calls an HTTP finance endpoint directly. `TwelveDataProvider`
batches an entire poll into one HTTP request (`/quote?symbol=A,B,C`),
which is what keeps a multi-symbol watchlist under the 8 req/min ceiling
regardless of how many credits it costs. A streaming provider could be
added behind the same interface later without touching the ingest worker,
the signal functions, or the scoring logic.

**Honest data caveat:** the free tier covers US-exchange symbols only —
other exchanges need a paid tier (the engine itself is exchange-agnostic;
only the ticker universe changes). Live corporate-action data (splits) can
take up to 48h to reflect in Twelve Data's feed due to their verification
process, so split-handling is demonstrated deterministically via
`ReplayProvider` (see [Demo mode](#demo-mode--resilience)) rather than
depending on a real split happening to occur during grading.

## Demo mode & resilience

`MARKET_PROVIDER=replay` (the default) is a deterministic seeded random
walk with scriptable events — gaps, spikes, splits, volume surges, feed
outages, duplicate ticks, out-of-order ticks
(`lib/providers/replay.ts`). Same seed, same sequence, every time
(`lib/providers/__tests__/replay.test.ts`) — used in every automated test
and as the demo-mode data source, so grading never depends on real market
hours or Twelve Data's credit budget. Every quote/bar it emits is labeled
`source: "replay"`, and the UI shows a visible banner when running on it —
simulated data is never presented as real.

**Click "▶ Run demo scenario"** in the sidebar (or `POST
/api/demo/run-scenario`) to run the scripted end-to-end scenario
(`lib/demo/scenario.ts`), deterministically:

1. Seeds 260 days of history for a `DEMO` symbol **with a 4-for-1 split at
   day 150** — `symbol_stats.vol_20d` stays in normal range afterward
   (asserted in `lib/demo/__tests__/scenario.test.ts`), proving the naive
   path (a fabricated crash) doesn't happen.
2. A live tick with an **8% gap at the open** — fires a `gap` signal.
3. A live tick with a **4x volume surge** — fires a `volume_surge` signal,
   banded "exceptional," with a message that makes no causal claim.
4. A **2-tick feed outage** — the poller's failure count rises, the last
   known quote is never overwritten with nulls, and `/health` reflects the
   degradation.
5. **Automatic recovery** — the next successful poll clears the failure
   streak.

Re-running the scenario is idempotent: history isn't re-seeded
(`lib/seed/historical-seed.ts`'s "never re-fetch what you already have"),
and events aren't duplicated (Phase 6 dedupe) — both asserted directly in
the scenario's own test suite.

**Two real bugs were caught building this scenario**, not simulated for
the writeup — worth stating because they show what the deterministic
replay mode is actually for:

- `ReplayProvider`'s live-quote walk and its historical-bars walk used
  independent random-walk anchors, so a freshly-watched symbol's first
  live quote could land tens of percent away from its own seeded
  "previous close," producing a fabricated 40+ standard-deviation price
  signal before any real movement occurred. Fixed by anchoring the live
  walk to the historical series' last close.
- A scripted feed outage never actually ended — the tick counter froze
  while an outage was active, so the "pending tick" could never reach the
  outage's end boundary. Fixed by always advancing the tick, and having
  the outage window govern only whether *that specific* poll throws.

Both are covered by regression tests
(`lib/providers/__tests__/replay.test.ts`).

**Other resilience properties, all tested:**

- Provider failure (rate limit, HTTP error, simulated outage) never
  crashes the process and never overwrites a good quote with nulls —
  `lib/ingest/__tests__/poller.test.ts`.
- Out-of-order and duplicate quotes are rejected atomically at the SQL
  layer (`ON CONFLICT ... WHERE excluded.asOf > stored.asOf`), not via a
  read-then-write race — `lib/ingest/__tests__/quotes.test.ts`.
- Market-closed / pre-post-market / holiday awareness drives poll cadence
  (`lib/market-hours.ts`, computed from NYSE holiday rules, not a
  hardcoded date list) and the UI's "market closed — showing prices as of
  the last close" banner.
- Concurrent duplicate watchlist-symbol adds and concurrent reorders of
  different items are both race-safe — `lib/watchlists/__tests__/crud.test.ts`.

## Language & compliance

Never "Buy / Sell / Strong Buy / target price / institutional buying."
Tiers are "High/Medium/Low attention"; volume anomalies are "unusual
activity," never attributed to a cause. `StoryDrawer.tsx` states outright:
*"Information and monitoring only — this is not investment advice."*
Grep the codebase for `buy|sell|target price` and the only matches are this
README and the scope-cut table describing what's *not* there.

## Tech stack

TypeScript end-to-end · Next.js App Router (API + frontend, one
deployable) · Prisma (SQLite locally, Postgres-portable — see "what breaks
first") · Vitest (118 tests, `npm test`) · TanStack Query (polling,
mutations) · Tailwind. `node-cron` was pulled in per the plan but the
actual scheduling ended up living in `lib/pipeline/scheduler.ts` via
`setTimeout`-based self-rescheduling (mirroring `IngestPoller`'s own
pattern) rather than cron syntax, since the cadence is dynamic
(market-hours-driven), not fixed-interval.

## Repo map

```
src/lib/providers/     Phase 1 — MarketDataProvider abstraction, ReplayProvider, TwelveData
src/lib/ingest/        Phase 2 — idempotent quote polling
src/lib/seed/          Phase 3 — historical seed + split adjustment + rolling stats
src/lib/signals/       Phase 4 — pure signal functions
src/lib/scoring/       Phase 5 — attention score + story grouping
src/lib/events/        Phase 6 — emit, dedupe, hysteresis resolution
src/lib/watermark/     Phase 7 — the race-safe /changes + /ack core
src/lib/watchlists/    Phase 8 — CRUD, race-safe add/reorder
src/lib/pipeline/      Bridges Phases 1-8 into one running process
src/lib/demo/          Phase 10 — the scripted, deterministic demo scenario
src/app/api/           All HTTP routes
src/components/, src/app/page.tsx   Phase 9 — the frontend
```
