import { Signal, SignalCategory, Tier } from "@/lib/signals/types";
import { attentionScore } from "./attention-score";

/** Maps a stored event's `eventType` back to the weight category its originating signal belongs to (plan §5's WEIGHTS). */
const EVENT_TYPE_TO_CATEGORY: Record<string, SignalCategory> = {
  price_move: "price",
  gap: "event",
  vol_expansion: "volatility",
  volume_surge: "volume",
  relative_perf: "relative",
  week52_break: "event",
  filing_earnings: "event",
  filing_split: "event",
  filing_dividend: "event",
};

/** The minimal shape this needs — deliberately NOT importing watermark/changes's ChangeEvent, since that fixes occurredAt to `Date` while the browser only ever sees the JSON-serialized `string` form of the same data. */
export interface GroupableEvent {
  seq: number;
  symbol: string;
  eventType: string;
  tier: string;
  score: number;
  reason: string;
}

export interface Story<E extends GroupableEvent = GroupableEvent> {
  symbol: string;
  attentionScore: number;
  tier: Tier;
  reason: string;
  events: E[];
}

/**
 * Groups the flat, per-signal event list /changes returns into per-symbol
 * "stories," each with one combined attention score (plan Phase 5's
 * "combine a stock's fired signals into one ranked 0-100 score" — applied
 * here, at the presentation layer, since symbol_events itself is stored at
 * signal granularity, one row per fired signal type per day per tier).
 *
 * Pure and synchronous: takes whatever /changes already returned (already
 * filtered by watermark, resolution, ack state, and seed_watermark), so
 * this never re-queries anything. Generic over the event shape so both the
 * server (Date) and the client (JSON string) representations work without
 * a cast.
 */
export function groupIntoStories<E extends GroupableEvent>(events: E[]): Story<E>[] {
  const bySymbol = new Map<string, E[]>();
  for (const event of events) {
    const list = bySymbol.get(event.symbol) ?? [];
    list.push(event);
    bySymbol.set(event.symbol, list);
  }

  const stories: Story<E>[] = [];
  for (const [symbol, symbolEvents] of bySymbol) {
    const signals: Signal[] = symbolEvents.map((e) => ({
      category: EVENT_TYPE_TO_CATEGORY[e.eventType] ?? "event",
      type: e.eventType,
      subScore: e.score,
      tier: e.tier as Tier,
      message: e.reason,
    }));

    const result = attentionScore(signals);
    stories.push({
      symbol,
      attentionScore: Math.round(result.score),
      tier: result.tier,
      reason: result.reason,
      events: symbolEvents,
    });
  }

  stories.sort((a, b) => b.attentionScore - a.attentionScore);
  return stories;
}
