# Groww Pulse — Product Thesis

## The one question this product answers

> "I was away from the market. What changed in my watchlist, why does it
> matter, and what should I look at first?"

Not a dashboard that redisplays price, volume, news, and sentiment at equal
weight. A **change briefing**, ranked by an explainable attention score.

## What Pulse does

1. Captures a user's last meaningful checkpoint (`watchlist.lastSeenAt`).
2. Detects material changes across price, volatility, volume, relative
   performance, corporate events, and sentiment.
3. Groups related signals for one instrument into a single "story."
4. Ranks stories by an **Attention Score** (0–100).
5. Explains every score in plain language — no black-box AI labels.
6. Lets the user acknowledge a story independently of the watchlist-level
   checkpoint ("Mark reviewed").
7. Preserves both checkpoints so the next visit starts from the correct
   state, regardless of how many background refreshes happened in between.

## Non-goals (explicitly out of scope for the MVP)

- No buy/sell/target-price language. Regulated territory in India (SEBI);
  the product is an information and monitoring tool, not an advice engine.
- No unrestricted AI news interpretation — events are classified
  deterministically from filing subjects first; LLM summarization (if any)
  is layered on top of a structured event, never a replacement for it.
- No "institutional buying detected" claims — volume anomalies are reported
  neutrally ("unusual volume"), since high volume has many possible causes.
- No full fundamental-analysis platform — only event-driven fundamental
  changes (earnings, guidance, ratings, promoter holding).

## Signal categories (see `src/lib/signals.ts`, `src/lib/attention-score.ts`)

| Component | Weight | What it captures |
|---|---|---|
| Price + volatility | 30% | Return since last visit, scaled up when volatility has expanded vs. its 30-day baseline |
| Volume anomaly | 20% | Current volume vs. 20-day average, paired with price direction for a participation read |
| Relative performance | 15% | Stock return vs. its benchmark/sector index over the same window |
| Corporate event | 20% | Highest-significance filing since last visit (deterministic subject-based classifier) |
| Sentiment shift | 10% | Requires ≥3 articles; reports direction, magnitude, and coverage count, never a bare score |
| Data freshness | 5% | Penalizes stale/unavailable data instead of presenting it as current |

Every signal is emitted as evidence (`label`, `value`, `description`,
`confidence`) — the score is a sum of these, never a mystery number.

## The checkpoint model (the load-bearing idea)

Two independent timestamps, not "diff against the last API fetch":

- **`Watchlist.lastSeenAt`** — when the user last opened this watchlist.
  Only advanced by an explicit `POST /api/watchlists/:id/seen`, never by a
  background data refresh or by the read-only briefing `GET`. Otherwise a
  scheduled ingestion tick would silently erase the user's baseline.
- **`StockAcknowledgement.acknowledgedAt`** — per-stock, per-watchlist. Lets
  a user dismiss one story without resetting the whole watchlist's
  checkpoint. An unacknowledged event stays highlighted across repeated
  visits until the user actually reviews it.

## Naming

**Groww Pulse — Since You Left.** Maps directly to the challenge wording
("what has meaningfully changed") and is concrete enough to demo in one
sentence.
