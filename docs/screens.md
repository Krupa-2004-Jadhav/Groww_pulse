# Screen Sketches (Hours 0–6 — text wireframes)

Full builds land in hours 18–46; these are the layouts the data model and
API contract above are already shaped to support.

## Screen 1 — Watchlist briefing (default landing page)

```
Good morning
Your watchlist changed since yesterday
Last checked: Yesterday, 6:42 PM

[ 4 need attention ] [ 2 major price moves ] [ 1 new event ] [ 3 unusual volume ]

Needs your attention
┌─────────────────────────────────────────────┐
│ Reliance Industries              High attn ●│
│ +5.8% since last visit · Volume 2.4x normal  │
│ New board-meeting outcome                    │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Tata Motors                    Medium attn ●│
│ -3.4% since last visit · underperformed      │
│ Nifty Auto by 2.2pp                          │
└─────────────────────────────────────────────┘

Quiet — no meaningful change
HDFC Bank · ITC · Asian Paints
```

## Screen 2 — Timeline mode (per instrument)

```
Today, 10:34 AM   Price +2.7%; volume reached 2.1x average
Today, 9:45 AM    NSE filing: Outcome of board meeting
Yesterday         Sentiment shifted from neutral to positive
3 days ago        Price was ₹1,240.50
```

## Screen 3 — Explain-this-change drawer

```
Why this is highlighted
  Price          ₹1,240 → ₹1,310   +5.65% since your last visit
  Participation  Today's volume is 2.4x the 20-day average
  Relative perf  Outperformed Nifty 50 by 3.2pp
  New info       Board-meeting outcome published 2h ago  [source]
  Sentiment      Positive coverage 42% → 68% (11 articles)
  Freshness      Market data 2 min ago · Event data 18 min ago

  [ Mark reviewed ]
```

Every field maps 1:1 to a `Signal` from `computeAttentionScore` — this
drawer is a direct render of the `signals[]` array from the briefing
response, not a separate hand-written view.

## Screen 4 — Add stock flow

```
Search: "Tata"
  Tata Motors — NSE
  Tata Steel — NSE
  Tata Consumer Products — NSE
[+ Add to My Long-Term Stocks]
```

## Screen 5 — Alert preferences

```
Attention sensitivity:  ○ Relaxed  ● Balanced  ○ High

Notify me when:
  [x] Price moves materially
  [x] Volume becomes unusual
  [x] A company event is published
  [x] Sentiment shifts sharply

Advanced
  Price threshold: 3%     Volume threshold: 2x
  Benchmark: Nifty 50
```

Maps directly to `WatchlistPreferences` in the schema.
