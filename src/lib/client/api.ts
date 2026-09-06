"use client";

/**
 * Thin typed fetch wrappers for the frontend. Deliberately not a generated
 * client or an abstraction layer beyond this — the API surface is small
 * enough that hand-written functions stay more readable than the tooling
 * needed to generate them (plan §6.4: maintainability without
 * over-engineering).
 */

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  position: number;
  addedAt: string;
  seedWatermark: number;
}

export interface WatchlistDetail extends Watchlist {
  items: WatchlistItem[];
}

export interface ChangeEvent {
  seq: number;
  symbol: string;
  eventType: string;
  tier: "low" | "medium" | "high";
  score: number;
  reason: string;
  occurredAt: string;
}

export interface ChangesResult {
  cursor: number;
  events: ChangeEvent[];
  lastSeenAt: string | null;
  symbols: string[];
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
}

export interface HealthStatus {
  status: string;
  db: string;
  provider: { provider: string; rateLimiter: unknown };
  ingest: {
    lastSuccessAt: string | null;
    secondsSinceLastSuccess: number | null;
    consecutiveFailures: number;
    recentErrorRate: number;
    lastError: string | null;
  };
  timestamp: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  listWatchlists: (userId: string) => request<{ watchlists: Watchlist[] }>(`/api/watchlists?userId=${userId}`),
  createWatchlist: (userId: string, name: string) =>
    request<Watchlist>(`/api/watchlists?userId=${userId}`, { method: "POST", body: JSON.stringify({ name }) }),
  getWatchlist: (id: string) => request<WatchlistDetail>(`/api/watchlists/${id}`),
  renameWatchlist: (id: string, name: string) =>
    request<Watchlist>(`/api/watchlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteWatchlist: (id: string) => request<{ deleted: boolean }>(`/api/watchlists/${id}`, { method: "DELETE" }),

  addItem: (watchlistId: string, symbol: string, name: string, exchange: string) =>
    request<{ added: boolean; itemId: string }>(`/api/watchlists/${watchlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ symbol, name, exchange }),
    }),
  removeItem: (watchlistId: string, symbol: string) =>
    request<{ removed: boolean }>(`/api/watchlists/${watchlistId}/items/${symbol}`, { method: "DELETE" }),
  reorderItem: (watchlistId: string, symbol: string, position: number) =>
    request<{ symbol: string; position: number }>(`/api/watchlists/${watchlistId}/items/${symbol}`, {
      method: "PATCH",
      body: JSON.stringify({ position }),
    }),

  searchSymbols: (query: string) => request<{ results: SymbolSearchResult[] }>(`/api/symbols/search?q=${encodeURIComponent(query)}`),

  getChanges: (watchlistId: string, userId: string) =>
    request<ChangesResult>(`/api/watchlists/${watchlistId}/changes?userId=${userId}`),
  ack: (watchlistId: string, userId: string, cursor: number) =>
    request<{ watermark: number }>(`/api/watchlists/${watchlistId}/ack?userId=${userId}`, {
      method: "POST",
      body: JSON.stringify({ cursor }),
    }),
  acknowledgeEvent: (eventId: number, userId: string) =>
    request<{ acknowledged: boolean }>(`/api/events/${eventId}/acknowledge?userId=${userId}`, { method: "POST" }),
  dismissEvent: (eventId: number, userId: string) =>
    request<{ dismissed: boolean }>(`/api/events/${eventId}/dismiss?userId=${userId}`, { method: "POST" }),

  health: () => request<HealthStatus>("/api/health"),
};
