# Demo Scenario — "Since You Left"

Seeded by `prisma/seed.ts`. One watchlist, **My Long-Term Stocks**, 12 NSE
instruments, checkpoint (`lastSeenAt`) set ~22 hours before the current
snapshot, matching "last checked yesterday" from the strategy doc.

## Scripted walkthrough

1. Open the watchlist briefing (`GET /api/watchlists/:id/briefing`).
2. **Reliance Industries — high attention.** +5.8% since last visit, volume
   2.4x normal, a board-meeting outcome filed after the checkpoint, positive
   sentiment shift across 14 articles. All signals agree → high confidence.
3. **Tata Motors — medium attention.** -3.4% since last visit,
   underperformed Nifty Auto, no new filing, mild negative sentiment shift.
4. **Infosys — information-only.** Price essentially unchanged; the only
   signal is a new investor-meeting announcement. Low attention score, shown
   for completeness rather than urgency.
5. **Quiet section:** HDFC Bank (sentiment present but below the 3-article
   confidence floor, so it doesn't count), ITC (no coverage at all — "no
   news" vs. "neutral news"), Asian Paints — all below the attention
   threshold.
6. Click into Reliance → see the signal breakdown with sources and
   freshness, open the NSE filing link, `POST .../acknowledge`.
7. Re-fetch the briefing → Reliance's `changeState` flips to
   `acknowledged`; it stays visible (nothing here auto-dismisses on
   re-open) but the state change is visible in the payload.
8. `POST /api/watchlists/:id/seen` → the checkpoint advances; a subsequent
   briefing call starts diffing from "now" instead of yesterday.

## Supporting variety in the seed (not part of the scripted path)

- **Zomato**: sharp move (-9.2%), exceptional volume, a credit-rating
  downgrade, and a strong negative sentiment shift — a second "everything
  agrees" high-attention story to show the score isn't Reliance-specific.
- **ICICI Bank**: a +4% move on volume that's actually *below* its 20-day
  average — the "weak or unconfirmed move" participation label.
- **Tata Steel**: exceptional volume (2.6x) with almost no price move — the
  inverse case, volume without price confirmation.

## Why this dataset (Option 2/3 from the strategy doc)

Deterministic seeded snapshots, not a live API call, so the judged demo
never depends on market hours or a flaky upstream feed. Real Groww API
integration is a drop-in replacement for the ingestion job later — the
scoring engine and schema don't change.
