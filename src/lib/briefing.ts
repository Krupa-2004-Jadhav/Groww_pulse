import { prisma } from "./db";
import {
  computePriceSignal,
  computeVolumeSignal,
  computeRelativeSignal,
  computeEventSignal,
  computeSentimentSignal,
  computeFreshnessSignal,
  calculateAttentionScore,
  classifySeverity,
  coreSignalScore,
  overallConfidence,
  countEvidence,
} from "./attention-score";
import { Signal, ChangeState } from "./signals";

export interface StoryDTO {
  instrument: { id: string; symbol: string; name: string; exchange: string };
  attentionScore: number;
  severity: string;
  changeState: ChangeState;
  confidence: string;
  evidenceCount: number;
  signals: Signal[];
  freshness: { price: string | null; event: string | null };
}

export interface BriefingDTO {
  watchlist: { id: string; name: string; lastSeenAt: string | null };
  summary: {
    attentionCount: number;
    highAttentionCount: number;
    newEventCount: number;
    volumeAnomalyCount: number;
  };
  stories: StoryDTO[];
  quiet: { id: string; symbol: string; name: string }[];
}

/**
 * Computes "what changed since checkpoint" for one watchlist.
 *
 * Deliberately read-only: this does NOT advance lastSeenAt. Per the
 * checkpoint model (docs/product-thesis.md section 4), only an explicit
 * "mark seen" / "mark reviewed" action should move the baseline — otherwise
 * a background refresh or repeated GET would erase the very changes the
 * product exists to surface.
 */
export async function buildBriefing(watchlistId: string, now: Date = new Date()): Promise<BriefingDTO | null> {
  const watchlist = await prisma.watchlist.findUnique({
    where: { id: watchlistId },
    include: {
      items: { where: { removedAt: null }, include: { instrument: true }, orderBy: { position: "asc" } },
      acknowledgements: true,
    },
  });

  if (!watchlist) return null;

  const lastSeenAt = watchlist.lastSeenAt;
  const acknowledgedInstrumentIds = new Set(watchlist.acknowledgements.map((a) => a.instrumentId));

  const stories: StoryDTO[] = [];
  const quiet: BriefingDTO["quiet"] = [];

  for (const item of watchlist.items) {
    const instrument = item.instrument;

    const [latestSnapshot, checkpointSnapshot] = await Promise.all([
      prisma.instrumentSnapshot.findFirst({
        where: { instrumentId: instrument.id },
        orderBy: { capturedAt: "desc" },
      }),
      lastSeenAt
        ? prisma.instrumentSnapshot.findFirst({
            where: { instrumentId: instrument.id, capturedAt: { lte: lastSeenAt } },
            orderBy: { capturedAt: "desc" },
          })
        : null,
    ]);

    if (!latestSnapshot) continue;

    const eventsSinceLastSeen = await prisma.event.findMany({
      where: {
        instrumentId: instrument.id,
        publishedAt: lastSeenAt ? { gt: lastSeenAt } : undefined,
      },
      orderBy: { publishedAt: "desc" },
    });

    const lastSeenPrice = checkpointSnapshot?.price ?? null;
    const priceChangePct = lastSeenPrice ? ((latestSnapshot.price - lastSeenPrice) / lastSeenPrice) * 100 : 0;
    const benchmarkReturnPct = checkpointSnapshot
      ? latestSnapshot.benchmarkReturnPct - checkpointSnapshot.benchmarkReturnPct
      : latestSnapshot.benchmarkReturnPct;

    const signals: Signal[] = [
      computePriceSignal({
        lastSeenPrice,
        currentPrice: latestSnapshot.price,
        volatility5d: latestSnapshot.volatility5d,
        volatility30d: latestSnapshot.volatility30d,
      }),
      computeVolumeSignal({
        volume: latestSnapshot.volume,
        avgVolume20d: latestSnapshot.avgVolume20d,
        priceChangePct,
      }),
      computeRelativeSignal({
        stockReturnPct: priceChangePct,
        benchmarkReturnPct,
        benchmarkLabel: instrument.benchmarkSymbol,
      }),
      computeEventSignal(
        eventsSinceLastSeen.map((e) => ({
          eventType: e.eventType,
          title: e.title,
          sourceUrl: e.sourceUrl,
          publishedAt: e.publishedAt,
          confidence: e.confidence as "low" | "medium" | "high",
        }))
      ),
      computeSentimentSignal({
        currentScore: latestSnapshot.sentimentScore,
        previousScore: latestSnapshot.previousSentimentScore,
        articleCount: latestSnapshot.sentimentArticleCount,
      }),
      computeFreshnessSignal(latestSnapshot.capturedAt, now),
    ];

    const attentionScore = calculateAttentionScore(signals);
    const severity = classifySeverity(attentionScore, coreSignalScore(signals));

    if (severity === "none") {
      quiet.push({ id: instrument.id, symbol: instrument.symbol, name: instrument.name });
      continue;
    }

    const isAcknowledged = acknowledgedInstrumentIds.has(instrument.id);
    const changeState: ChangeState = isAcknowledged ? "acknowledged" : eventsSinceLastSeen.length > 0 ? "new" : "updated";

    stories.push({
      instrument: { id: instrument.id, symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange },
      attentionScore: Math.round(attentionScore),
      severity,
      changeState,
      confidence: overallConfidence(signals),
      evidenceCount: countEvidence(signals),
      signals: signals.map((s) => ({ ...s, score: Math.round(s.score * 10) / 10 })),
      freshness: {
        price: latestSnapshot.capturedAt.toISOString(),
        event: eventsSinceLastSeen[0]?.publishedAt.toISOString() ?? null,
      },
    });
  }

  stories.sort((a, b) => b.attentionScore - a.attentionScore);

  return {
    watchlist: { id: watchlist.id, name: watchlist.name, lastSeenAt: lastSeenAt?.toISOString() ?? null },
    summary: {
      attentionCount: stories.length,
      highAttentionCount: stories.filter((s) => s.severity === "high").length,
      newEventCount: stories.filter((s) => s.signals.some((sig) => sig.type === "event" && sig.score > 0)).length,
      volumeAnomalyCount: stories.filter((s) => s.signals.some((sig) => sig.type === "volume" && sig.score > 0)).length,
    },
    stories,
    quiet,
  };
}
