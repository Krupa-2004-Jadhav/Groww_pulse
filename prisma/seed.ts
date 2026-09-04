import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Deterministic demo dataset — see docs/demo-scenario.md.
 *
 * "Now" is anchored a few minutes in the past so freshness classification
 * (fresh < 5min) reads naturally regardless of when the seed is run relative
 * to the dev server starting.
 */
const NOW = new Date();
const LAST_SEEN_AT = new Date(NOW.getTime() - 22 * 60 * 60 * 1000); // "yesterday, 3:45 PM"-style checkpoint, ~22h ago
const EVENT_YESTERDAY = new Date(NOW.getTime() - 20 * 60 * 60 * 1000); // after last-seen, before now
const CURRENT_CAPTURE = new Date(NOW.getTime() - 2 * 60 * 1000); // "2 minutes ago" — fresh

interface InstrumentSeed {
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  sector: string;
  benchmarkSymbol: string;
  checkpointPrice: number;
  currentPrice: number;
  volume: number;
  avgVolume20d: number;
  volatility5d: number;
  volatility30d: number;
  benchmarkReturnPct: number; // benchmark/sector return over the same "since last visit" window
  sentimentScore: number | null;
  previousSentimentScore: number | null;
  sentimentArticleCount: number;
  events: {
    eventType: string;
    title: string;
    summary: string;
    sourceUrl: string;
    publishedAt: Date;
    confidence: "low" | "medium" | "high";
  }[];
}

// Section 13 of the strategy doc ("Demo Scenario for Judges") pins Reliance
// at high attention, Tata Motors at medium, Infosys as information-only, and
// HDFC Bank / ITC / Asian Paints as quiet. The rest of the 12-stock universe
// fills out realistic variety (weak/unconfirmed move, exceptional volume
// with no other confirmation, etc.) without being part of the scripted demo.
const INSTRUMENTS: InstrumentSeed[] = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    sector: "Energy",
    benchmarkSymbol: "NIFTY50",
    checkpointPrice: 2688.09,
    currentPrice: 2845.0,
    volume: 42_000_000,
    avgVolume20d: 17_500_000,
    volatility5d: 2.1,
    volatility30d: 1.3,
    benchmarkReturnPct: 2.7,
    sentimentScore: 0.42,
    previousSentimentScore: 0.05,
    sentimentArticleCount: 14,
    events: [
      {
        eventType: "board_meeting",
        title: "Outcome of Board Meeting",
        summary: "Board approved a new capital expenditure plan for the energy-to-retail transition.",
        sourceUrl: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
        publishedAt: EVENT_YESTERDAY,
        confidence: "high",
      },
    ],
  },
  {
    symbol: "TATAMOTORS",
    name: "Tata Motors",
    exchange: "NSE",
    sector: "Automobile",
    benchmarkSymbol: "NIFTYAUTO",
    checkpointPrice: 1013.0,
    currentPrice: 979.0, // -3.4%
    volume: 17_500_000, // ~1.8x avg -> "significant" band, confirms the decline
    avgVolume20d: 9_600_000,
    volatility5d: 1.4,
    volatility30d: 1.2,
    benchmarkReturnPct: -1.2, // Nifty Auto roughly flat-to-down -> stock underperformed by ~2.2pp
    sentimentScore: -0.22,
    previousSentimentScore: 0.02,
    sentimentArticleCount: 6,
    events: [],
  },
  {
    symbol: "INFY",
    name: "Infosys",
    exchange: "NSE",
    sector: "IT Services",
    benchmarkSymbol: "NIFTYIT",
    checkpointPrice: 1512.0,
    currentPrice: 1512.6, // effectively unchanged
    volume: 8_100_000,
    avgVolume20d: 7_900_000,
    volatility5d: 0.7,
    volatility30d: 0.8,
    benchmarkReturnPct: 0.1,
    sentimentScore: 0.03,
    previousSentimentScore: 0.01,
    sentimentArticleCount: 4,
    events: [
      {
        eventType: "investor_meet",
        title: "Analyst/Institutional Investor Meet",
        summary: "Scheduled investor meeting to discuss Q2 execution and hiring outlook.",
        sourceUrl: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
        publishedAt: EVENT_YESTERDAY,
        confidence: "medium",
      },
    ],
  },
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank",
    exchange: "NSE",
    sector: "Banking",
    benchmarkSymbol: "NIFTYBANK",
    checkpointPrice: 1698.0,
    currentPrice: 1703.5,
    volume: 9_200_000,
    avgVolume20d: 9_000_000,
    volatility5d: 0.6,
    volatility30d: 0.65,
    benchmarkReturnPct: 0.3,
    sentimentScore: 0.06,
    previousSentimentScore: 0.04,
    sentimentArticleCount: 2, // below the 3-article confidence floor, deliberately
    events: [],
  },
  {
    symbol: "ITC",
    name: "ITC",
    exchange: "NSE",
    sector: "FMCG",
    benchmarkSymbol: "NIFTYFMCG",
    checkpointPrice: 468.2,
    currentPrice: 469.1,
    volume: 6_500_000,
    avgVolume20d: 6_800_000,
    volatility5d: 0.4,
    volatility30d: 0.5,
    benchmarkReturnPct: 0.2,
    sentimentScore: null,
    previousSentimentScore: null,
    sentimentArticleCount: 0,
    events: [],
  },
  {
    symbol: "ASIANPAINT",
    name: "Asian Paints",
    exchange: "NSE",
    sector: "Consumer Durables",
    benchmarkSymbol: "NIFTY50",
    checkpointPrice: 2905.0,
    currentPrice: 2896.0,
    volume: 1_100_000,
    avgVolume20d: 1_150_000,
    volatility5d: 0.5,
    volatility30d: 0.6,
    benchmarkReturnPct: -0.1,
    sentimentScore: 0.0,
    previousSentimentScore: 0.0,
    sentimentArticleCount: 1,
    events: [],
  },
  {
    symbol: "TCS",
    name: "Tata Consultancy Services",
    exchange: "NSE",
    sector: "IT Services",
    benchmarkSymbol: "NIFTYIT",
    checkpointPrice: 3820.0,
    currentPrice: 3865.0,
    volume: 4_200_000,
    avgVolume20d: 3_900_000,
    volatility5d: 0.5,
    volatility30d: 0.55,
    benchmarkReturnPct: 0.4,
    sentimentScore: 0.1,
    previousSentimentScore: 0.08,
    sentimentArticleCount: 5,
    events: [],
  },
  {
    symbol: "ICICIBANK",
    name: "ICICI Bank",
    exchange: "NSE",
    sector: "Banking",
    benchmarkSymbol: "NIFTYBANK",
    checkpointPrice: 1210.0,
    currentPrice: 1258.0, // +4.0% but on low volume -> "weak/unconfirmed move" example
    volume: 8_000_000,
    avgVolume20d: 8_400_000,
    volatility5d: 0.9,
    volatility30d: 0.7,
    benchmarkReturnPct: 0.5,
    sentimentScore: 0.15,
    previousSentimentScore: 0.1,
    sentimentArticleCount: 4,
    events: [],
  },
  {
    symbol: "TATASTEEL",
    name: "Tata Steel",
    exchange: "NSE",
    sector: "Metals",
    benchmarkSymbol: "NIFTYMETAL",
    checkpointPrice: 162.0,
    currentPrice: 163.0,
    volume: 55_000_000, // exceptional volume, but price barely moved -> no confirmation
    avgVolume20d: 21_000_000,
    volatility5d: 1.1,
    volatility30d: 1.0,
    benchmarkReturnPct: 0.3,
    sentimentScore: 0.02,
    previousSentimentScore: 0.0,
    sentimentArticleCount: 3,
    events: [],
  },
  {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel",
    exchange: "NSE",
    sector: "Telecom",
    benchmarkSymbol: "NIFTY50",
    checkpointPrice: 1580.0,
    currentPrice: 1596.0,
    volume: 5_300_000,
    avgVolume20d: 5_100_000,
    volatility5d: 0.6,
    volatility30d: 0.6,
    benchmarkReturnPct: 0.4,
    sentimentScore: 0.08,
    previousSentimentScore: 0.07,
    sentimentArticleCount: 3,
    events: [],
  },
  {
    symbol: "ZOMATO",
    name: "Eternal (Zomato)",
    exchange: "NSE",
    sector: "Internet/Consumer Services",
    benchmarkSymbol: "NIFTY50",
    checkpointPrice: 262.0,
    currentPrice: 238.0, // -9.2%, high volume, negative sentiment shift, credit-rating event
    volume: 61_000_000,
    avgVolume20d: 24_000_000,
    volatility5d: 3.4,
    volatility30d: 1.9,
    benchmarkReturnPct: 0.1,
    sentimentScore: -0.38,
    previousSentimentScore: 0.12,
    sentimentArticleCount: 22,
    events: [
      {
        eventType: "credit_rating",
        title: "Credit Rating",
        summary: "Rating agency revised outlook to negative citing widening quick-commerce losses.",
        sourceUrl: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
        publishedAt: EVENT_YESTERDAY,
        confidence: "high",
      },
    ],
  },
  {
    symbol: "BAJFINANCE",
    name: "Bajaj Finance",
    exchange: "NSE",
    sector: "NBFC",
    benchmarkSymbol: "NIFTY50",
    checkpointPrice: 7100.0,
    currentPrice: 7085.0,
    volume: 1_400_000,
    avgVolume20d: 1_450_000,
    volatility5d: 0.5,
    volatility30d: 0.55,
    benchmarkReturnPct: 0.0,
    sentimentScore: 0.01,
    previousSentimentScore: 0.0,
    sentimentArticleCount: 2,
    events: [],
  },
];

async function main() {
  console.log("Seeding Groww Pulse demo data...");

  const watchlist = await prisma.watchlist.create({
    data: {
      name: "My Long-Term Stocks",
      lastSeenAt: LAST_SEEN_AT,
      preferences: {
        create: {
          priceThresholdPct: 3.0,
          volumeThresholdRatio: 2.0,
          sensitivity: "balanced",
          benchmarkSymbol: "NIFTY50",
        },
      },
    },
  });

  for (const [index, seed] of INSTRUMENTS.entries()) {
    const instrument = await prisma.instrument.create({
      data: {
        symbol: seed.symbol,
        name: seed.name,
        exchange: seed.exchange,
        sector: seed.sector,
        benchmarkSymbol: seed.benchmarkSymbol,
      },
    });

    await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        instrumentId: instrument.id,
        position: index,
      },
    });

    // Checkpoint snapshot: what the world looked like at the user's last visit.
    await prisma.instrumentSnapshot.create({
      data: {
        instrumentId: instrument.id,
        capturedAt: LAST_SEEN_AT,
        price: seed.checkpointPrice,
        previousClose: seed.checkpointPrice,
        volume: seed.avgVolume20d,
        avgVolume20d: seed.avgVolume20d,
        volatility5d: seed.volatility30d,
        volatility30d: seed.volatility30d,
        benchmarkReturnPct: 0,
        sentimentScore: seed.previousSentimentScore,
        previousSentimentScore: null,
        sentimentArticleCount: 0,
      },
    });

    // Current snapshot: latest ingested state.
    await prisma.instrumentSnapshot.create({
      data: {
        instrumentId: instrument.id,
        capturedAt: CURRENT_CAPTURE,
        price: seed.currentPrice,
        previousClose: seed.checkpointPrice,
        volume: seed.volume,
        avgVolume20d: seed.avgVolume20d,
        volatility5d: seed.volatility5d,
        volatility30d: seed.volatility30d,
        benchmarkReturnPct: seed.benchmarkReturnPct,
        sentimentScore: seed.sentimentScore,
        previousSentimentScore: seed.previousSentimentScore,
        sentimentArticleCount: seed.sentimentArticleCount,
      },
    });

    for (const event of seed.events) {
      await prisma.event.create({
        data: {
          instrumentId: instrument.id,
          eventType: event.eventType,
          title: event.title,
          summary: event.summary,
          sourceUrl: event.sourceUrl,
          publishedAt: event.publishedAt,
          confidence: event.confidence,
        },
      });
    }
  }

  console.log(`Seeded watchlist "${watchlist.name}" (${watchlist.id}) with ${INSTRUMENTS.length} instruments.`);
  console.log(`lastSeenAt = ${LAST_SEEN_AT.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
