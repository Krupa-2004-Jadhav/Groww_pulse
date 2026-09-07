"use client";

import { DetailSignal } from "@/lib/client/detail-api";
import { AttentionStat } from "@/components/AttentionStat";
import { isHighlightWorthy, directionOf } from "@/lib/client/attention-stat";

const CATEGORY_LABEL: Record<string, string> = {
  price: "Price",
  volatility: "Volatility",
  volume: "Volume",
  relative: "Relative performance",
  event: "Event",
};

const TYPE_LABEL: Record<string, string> = {
  price_move: "Price move",
  gap: "Overnight gap",
  vol_expansion: "Volatility expansion",
  volume_surge: "Volume",
  relative_perf: "Relative performance",
  week52_break: "52-week range",
  filing_earnings: "Earnings",
  filing_split: "Stock split",
  filing_dividend: "Dividend",
};

export function SignalBreakdown({ signals }: { signals: DetailSignal[] }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Why this is highlighted</h2>
        <p className="mt-2 text-sm text-zinc-500">Nothing crossed a meaningful threshold right now.</p>
      </div>
    );
  }

  const sorted = [...signals].sort((a, b) => b.subScore - a.subScore);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Why this is highlighted</h2>
      <div className="mt-3 space-y-2">
        {sorted.map((signal) => (
          <AttentionStat
            key={signal.type}
            label={CATEGORY_LABEL[signal.category] ?? TYPE_LABEL[signal.type] ?? signal.type}
            value={signal.value || signal.tier}
            direction={directionOf(signal)}
            highlighted={isHighlightWorthy(signal)}
            message={`${TYPE_LABEL[signal.type] ?? signal.type}: ${signal.message}`}
          />
        ))}
      </div>
    </div>
  );
}
