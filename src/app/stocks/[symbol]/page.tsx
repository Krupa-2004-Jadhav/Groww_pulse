"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/client/hooks";
import { StockDetailScreen } from "@/components/stock-detail/StockDetailScreen";

function StockDetailContent({ symbol }: { symbol: string }) {
  const searchParams = useSearchParams();
  const watchlistId = searchParams.get("watchlistId");
  const { data: me, isLoading } = useCurrentUser();

  if (isLoading || !me) {
    return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  }
  if (!watchlistId) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        Missing watchlist context. Open this stock from a watchlist briefing instead of visiting the URL directly.
      </div>
    );
  }

  return <StockDetailScreen symbol={symbol} watchlistId={watchlistId} userId={me.userId} />;
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);

  return (
    <Suspense fallback={<div className="p-8 text-sm text-zinc-400">Loading…</div>}>
      <StockDetailContent symbol={symbol.toUpperCase()} />
    </Suspense>
  );
}
