"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { fetchSymbolDetail } from "./detail-api";
import { marketSession, MarketSession } from "@/lib/market-hours";

/** Pure Date/Intl math, no server dependency — safe to run client-side. Re-checked every minute so the UI reflects the market opening/closing without a reload. */
export function useMarketSession(): MarketSession {
  return useQuery({
    queryKey: ["market-session"],
    queryFn: () => marketSession(),
    initialData: () => marketSession(),
    refetchInterval: 60_000,
  }).data!;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await fetch("/api/me").then((r) => r.json())) as { userId: string },
    staleTime: Infinity, // the demo user never changes mid-session
    refetchInterval: false,
  });
}

export function useWatchlists(userId: string | undefined) {
  return useQuery({
    queryKey: ["watchlists", userId],
    queryFn: () => api.listWatchlists(userId!),
    enabled: !!userId,
    refetchInterval: false,
  });
}

export function useCreateWatchlist(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createWatchlist(userId!, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists", userId] }),
  });
}

export function useWatchlist(watchlistId: string | undefined) {
  return useQuery({
    queryKey: ["watchlist", watchlistId],
    queryFn: () => api.getWatchlist(watchlistId!),
    enabled: !!watchlistId,
  });
}

export function useChanges(watchlistId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["changes", watchlistId, userId],
    queryFn: () => api.getChanges(watchlistId!, userId!),
    enabled: !!watchlistId && !!userId,
  });
}

export function useAck(watchlistId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cursor: number) => api.ack(watchlistId!, userId!, cursor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["changes", watchlistId, userId] });
    },
  });
}

export function useAcknowledgeEvent(watchlistId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => api.acknowledgeEvent(eventId, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["changes", watchlistId, userId] }),
  });
}

export function useDismissEvent(watchlistId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => api.dismissEvent(eventId, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["changes", watchlistId, userId] }),
  });
}

export function useSymbolSearch(query: string) {
  return useQuery({
    queryKey: ["symbol-search", query],
    queryFn: () => api.searchSymbols(query),
    enabled: query.trim().length > 0,
    refetchInterval: false,
    staleTime: 60_000,
  });
}

export function useAddSymbol(watchlistId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ symbol, name, exchange }: { symbol: string; name: string; exchange: string }) =>
      api.addItem(watchlistId!, symbol, name, exchange),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", watchlistId] });
      queryClient.invalidateQueries({ queryKey: ["changes", watchlistId] });
    },
  });
}

export function useRemoveSymbol(watchlistId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (symbol: string) => api.removeItem(watchlistId!, symbol),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", watchlistId] });
      queryClient.invalidateQueries({ queryKey: ["changes", watchlistId] });
    },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30_000,
  });
}

export function useSymbolDetail(symbol: string | undefined, watchlistId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["symbol-detail", symbol, watchlistId, userId],
    queryFn: () => fetchSymbolDetail(symbol!, watchlistId!, userId!),
    enabled: !!symbol && !!watchlistId && !!userId,
  });
}
