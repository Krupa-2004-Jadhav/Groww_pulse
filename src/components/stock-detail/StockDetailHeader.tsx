"use client";

import { ArrowUp, ArrowDown, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SymbolDetail } from "@/lib/client/detail-api";
import { TIER_META } from "@/components/tier";

export function StockDetailHeader({ detail, watchlistId }: { detail: SymbolDetail; watchlistId: string }) {
  const tierMeta = TIER_META[detail.attentionScore.tier];
  const change = detail.quote?.dayChange ?? null;
  const changePct = detail.quote?.dayChangePct ?? null;
  const positive = (change ?? 0) >= 0;

  return (
    <header className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
      <Link href={`/?watchlist=${watchlistId}`} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700">
        <ArrowLeft size={14} aria-hidden /> Back to briefing
      </Link>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">{detail.symbol}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tierMeta.badgeClass}`}>{tierMeta.label}</span>
          </div>
          <p className="text-sm text-zinc-500">
            {detail.name} · {detail.exchange}
          </p>
        </div>
      </div>

      {/* Header stats: row on desktop, 2x2 grid on mobile (spec §6). */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:gap-8">
        <div>
          <div className="text-xs text-zinc-400">Price</div>
          <div className="text-2xl font-bold text-zinc-900 sm:text-3xl">
            {detail.quote ? detail.quote.price.toFixed(2) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">Day change</div>
          <div className={`flex items-center gap-1 text-lg font-semibold ${positive ? "text-[#00874D]" : "text-[#C7391E]"}`}>
            {change !== null && (positive ? <ArrowUp size={16} aria-hidden /> : <ArrowDown size={16} aria-hidden />)}
            {change !== null ? `${positive ? "+" : ""}${change.toFixed(2)}` : "—"}
            {changePct !== null && <span className="text-sm font-medium">({positive ? "+" : ""}{changePct.toFixed(2)}%)</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">52w range</div>
          <div className="text-sm font-medium text-zinc-700">
            {detail.stats?.low52w?.toFixed(0) ?? "—"} – {detail.stats?.high52w?.toFixed(0) ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">Attention score</div>
          <div className="text-sm font-medium text-zinc-700">{detail.attentionScore.score} / 100</div>
        </div>
      </div>
    </header>
  );
}
