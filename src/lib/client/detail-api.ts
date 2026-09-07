"use client";

export interface DetailBar {
  date: string;
  close: number;
  volume: number;
}

export interface DetailEvent {
  seq: number;
  eventType: string;
  tier: "low" | "medium" | "high";
  score: number;
  reason: string;
  occurredAt: string;
}

export interface DetailSignal {
  category: string;
  type: string;
  zscore?: number;
  ratio?: number;
  subScore: number;
  tier: "low" | "medium" | "high";
  message: string;
  value: string;
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
  } | null;
  stats: {
    high52w: number | null;
    low52w: number | null;
    vol20d: number | null;
    avgVolume20d: number | null;
    beta: number | null;
  } | null;
  bars: DetailBar[];
  benchmarkBars: DetailBar[];
  events: DetailEvent[];
  lastSeenAt: string | null;
  signals: DetailSignal[];
  attentionScore: { score: number; tier: "low" | "medium" | "high"; reason: string };
  freshness: { price: string | null; volume: string | null; lastEvent: string | null };
}

export async function fetchSymbolDetail(symbol: string, watchlistId: string, userId: string): Promise<SymbolDetail> {
  const res = await fetch(`/api/symbols/${symbol}/detail?watchlistId=${watchlistId}&userId=${userId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load ${symbol}: ${res.status}`);
  }
  return res.json();
}
