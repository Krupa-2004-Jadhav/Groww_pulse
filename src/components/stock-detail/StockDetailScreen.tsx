"use client";

import { useSymbolDetail, useAcknowledgeEvent } from "@/lib/client/hooks";
import { StockDetailHeader } from "./StockDetailHeader";
import { PriceChart } from "./PriceChart";
import { VolumeChart } from "./VolumeChart";
import { SignalBreakdown } from "./SignalBreakdown";
import { FreshnessFooter } from "./FreshnessFooter";

export function StockDetailScreen({ symbol, watchlistId, userId }: { symbol: string; watchlistId: string; userId: string }) {
  const { data: detail, isLoading, isError, error } = useSymbolDetail(symbol, watchlistId, userId);
  const acknowledge = useAcknowledgeEvent(watchlistId, userId);

  if (isLoading) {
    return <div className="p-8 text-sm text-zinc-400">Loading {symbol}…</div>;
  }
  if (isError || !detail) {
    return (
      <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn&apos;t load {symbol}. {(error as Error)?.message}
      </div>
    );
  }

  const eventDates = new Map(detail.events.map((e) => [e.occurredAt.slice(0, 10), e.reason]));

  const markAllReviewed = () => {
    for (const event of detail.events) acknowledge.mutate(event.seq);
  };

  return (
    <div className="min-h-full bg-[#FAFAFA]">
      <StockDetailHeader detail={detail} watchlistId={watchlistId} />

      {/* Desktop: 60/40 two-column, right panel sticky while the chart column scrolls. Mobile: single column, stacked (spec §6). */}
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex flex-1 flex-col gap-4 lg:w-[60%] lg:flex-none">
          <section className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Price · last 6 months</h2>
            <div className="overflow-x-auto">
              <div className="min-w-[640px] sm:min-w-0">
                <PriceChart
                  bars={detail.bars}
                  benchmarkBars={detail.benchmarkBars}
                  high52w={detail.stats?.high52w ?? null}
                  low52w={detail.stats?.low52w ?? null}
                  eventDates={eventDates}
                  lastSeenAt={detail.lastSeenAt}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Volume</h2>
            <div className="overflow-x-auto">
              <div className="min-w-[640px] sm:min-w-0">
                <VolumeChart bars={detail.bars} avgVolume20d={detail.stats?.avgVolume20d ?? null} />
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:w-[40%] lg:flex-none">
          <SignalBreakdown signals={detail.signals} />

          {detail.events.length > 0 && (
            <button
              onClick={markAllReviewed}
              disabled={acknowledge.isPending}
              className="min-h-11 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Mark reviewed
            </button>
          )}

          <p className="text-xs leading-relaxed text-zinc-400">
            Information and monitoring only — this is not investment advice, and nothing here is a buy or sell
            recommendation.
          </p>
        </div>
      </div>

      <FreshnessFooter price={detail.freshness.price} volume={detail.freshness.volume} lastEvent={detail.freshness.lastEvent} />
    </div>
  );
}
