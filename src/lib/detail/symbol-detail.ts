import { prisma } from "@/lib/db";
import { loadAdjustedBars, AdjustedBar, MARKET_INDEX_SYMBOL } from "@/lib/seed/rollup";
import { computeCurrentSignals } from "@/lib/pipeline/evaluate";
import { getChanges } from "@/lib/watermark/changes";
import { attentionScore } from "@/lib/scoring/attention-score";
import { Signal } from "@/lib/signals/types";

const DETAIL_WINDOW_MONTHS = 6;

export interface DetailBar {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number;
}

export interface DetailSignal extends Signal {
  /** A short, type-aware display value derived from zscore/ratio — "z=2.2", "2.4x", "+3.1pp" — so the frontend doesn't need to know per-signal-type formatting rules. */
  value: string;
}

export interface DetailEvent {
  seq: number;
  eventType: string;
  tier: string;
  score: number;
  reason: string;
  occurredAt: string;
}

export interface SymbolDetail {
  symbol: string;
  name: string;
  exchange: string;
  quote: {
    price: number;
    prevClose: number | null;
    dayChange: number | null;
    dayChangePct: number | null;
    asOf: string;
    /** false when there's no live quotes_latest row yet (just added, or mid poll-gap) and this is a fallback built from the last daily close instead. */
    live: boolean;
  } | null;
  stats: {
    high52w: number | null;
    low52w: number | null;
    vol20d: number | null;
    avgVolume20d: number | null;
    beta: number | null;
  } | null;
  /** Last ~6 months of adjusted daily closes/volume, chronological. */
  bars: DetailBar[];
  /** The market-index proxy over the same window, normalized to the same starting close as `bars[0]` — a directly comparable relative-performance line, not a second Y-axis. */
  benchmarkBars: DetailBar[];
  /**
   * Events for this symbol — deliberately reuses the SAME filters the
   * briefing feed applies (unresolved, unacknowledged by this user, past
   * this watchlist item's seed_watermark), not a full historical log. A
   * chart full of markers for events the user has already dealt with
   * would contradict the whole point of the product: showing what still
   * deserves attention, not everything that ever happened.
   */
  events: DetailEvent[];
  lastSeenAt: string | null;
  signals: DetailSignal[];
  attentionScore: { score: number; tier: string; reason: string };
  /** Per-data-group freshness — never a single generic "last updated" (plan §9's design principle). */
  freshness: {
    price: string | null;
    volume: string | null;
    lastEvent: string | null;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toDetailBars(bars: AdjustedBar[]): DetailBar[] {
  return bars.map((b) => ({ date: b.date.toISOString().slice(0, 10), close: round2(b.close), volume: Math.round(b.volume) }));
}

/** Scales `bars` so its first close matches `targetStart` — makes the benchmark line start exactly where the stock's own line starts, so the two are visually comparable without a second axis. */
function normalizeToStart(bars: AdjustedBar[], targetStart: number | null): DetailBar[] {
  if (bars.length === 0 || targetStart === null || bars[0].close === 0) return [];
  const scale = targetStart / bars[0].close;
  return bars.map((b) => ({ date: b.date.toISOString().slice(0, 10), close: round2(b.close * scale), volume: Math.round(b.volume) }));
}

function signalValue(signal: Signal): string {
  switch (signal.type) {
    case "price_move":
    case "gap":
      return signal.zscore !== undefined ? `z=${signal.zscore.toFixed(1)}` : "";
    case "vol_expansion":
    case "volume_surge":
      return signal.ratio !== undefined ? `${signal.ratio.toFixed(1)}x` : "";
    case "relative_perf":
      return signal.ratio !== undefined ? `${signal.ratio >= 0 ? "+" : ""}${signal.ratio.toFixed(1)}pp` : "";
    default:
      return "";
  }
}

/**
 * Gathers everything the stock detail screen needs in one response, reusing
 * already-computed backend data rather than re-deriving any of it:
 * bars_daily (via the same split-adjustment rollup.ts uses for stats),
 * symbol_stats, computeCurrentSignals (Phase 4), attentionScore (Phase 5),
 * and getChanges (Phase 7's watermark/ack/resolution filters).
 */
export async function getSymbolDetail(symbol: string, watchlistId: string, userId: string): Promise<SymbolDetail | null> {
  const instrument = await prisma.symbol.findUnique({ where: { symbol } });
  if (!instrument) return null;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - DETAIL_WINDOW_MONTHS);

  const [quote, stats, allBars, allIndexBars, signals, changes, lastEventRow] = await Promise.all([
    prisma.quoteLatest.findUnique({ where: { symbol } }),
    prisma.symbolStats.findUnique({ where: { symbol } }),
    loadAdjustedBars(symbol),
    loadAdjustedBars(MARKET_INDEX_SYMBOL),
    computeCurrentSignals(symbol),
    getChanges(userId, watchlistId),
    prisma.symbolEvent.findFirst({ where: { symbol }, orderBy: { occurredAt: "desc" } }),
  ]);

  const windowBars = allBars.filter((b) => b.date >= cutoff);
  const bars = toDetailBars(windowBars);
  const benchmarkBars = normalizeToStart(
    allIndexBars.filter((b) => b.date >= cutoff),
    bars[0]?.close ?? null
  );

  const events: DetailEvent[] = changes.events
    .filter((e) => e.symbol === symbol)
    .map((e) => ({
      seq: e.seq,
      eventType: e.eventType,
      tier: e.tier,
      score: Math.round(e.score * 10) / 10,
      reason: e.reason,
      occurredAt: e.occurredAt.toISOString(),
    }));

  const detailSignals: DetailSignal[] = signals
    .filter((s) => s.subScore > 0)
    .map((s) => ({ ...s, value: signalValue(s) }));

  const result = attentionScore(signals);

  // No live quote yet (symbol just added, or mid poll-gap) — bars_daily is
  // seeded synchronously at add-time, so fall back to the last daily close
  // rather than leaving the header blank while the chart already has data.
  const lastBar = windowBars[windowBars.length - 1] ?? null;
  const prevBar = windowBars[windowBars.length - 2] ?? null;
  const fallbackQuote =
    !quote && lastBar
      ? {
          price: round2(lastBar.close),
          prevClose: prevBar ? round2(prevBar.close) : null,
          dayChange: prevBar ? round2(lastBar.close - prevBar.close) : null,
          dayChangePct: prevBar && prevBar.close ? round2(((lastBar.close - prevBar.close) / prevBar.close) * 100) : null,
          asOf: lastBar.date.toISOString(),
          live: false,
        }
      : null;

  return {
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    quote: quote
      ? {
          price: quote.price,
          prevClose: quote.prevClose,
          dayChange: quote.prevClose != null ? round2(quote.price - quote.prevClose) : null,
          dayChangePct: quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : null,
          asOf: quote.asOf.toISOString(),
          live: true,
        }
      : fallbackQuote,
    stats: stats
      ? { high52w: stats.high52w, low52w: stats.low52w, vol20d: stats.vol20d, avgVolume20d: stats.avgVolume20d, beta: stats.beta }
      : null,
    bars,
    benchmarkBars,
    events,
    lastSeenAt: changes.lastSeenAt,
    signals: detailSignals,
    attentionScore: { score: Math.round(result.score), tier: result.tier, reason: result.reason },
    freshness: {
      // Price and volume share one quote row in this system (a single
      // poll tick carries both) — reporting them separately here is
      // honest, not a fabricated distinction: they really do always
      // update together, but the UI shouldn't assume that structurally.
      price: quote?.receivedAt.toISOString() ?? null,
      volume: quote?.receivedAt.toISOString() ?? null,
      lastEvent: lastEventRow?.occurredAt.toISOString() ?? null,
    },
  };
}
