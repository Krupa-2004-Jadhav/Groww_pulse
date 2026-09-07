"use client";

import { ArrowUp, ArrowDown, TriangleAlert } from "lucide-react";
import { Direction } from "@/lib/client/attention-stat";

const DIRECTION_META: Record<
  Direction,
  { border: string; bg: string; text: string; Icon: typeof ArrowUp | null; iconLabel: string }
> = {
  positive: { border: "border-[#00B386]", bg: "bg-[#00D09C]/10", text: "text-[#00874D]", Icon: ArrowUp, iconLabel: "up" },
  negative: { border: "border-[#EB5B3C]", bg: "bg-[#EB5B3C]/10", text: "text-[#C7391E]", Icon: ArrowDown, iconLabel: "down" },
  unusual: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700", Icon: TriangleAlert, iconLabel: "unusual" },
  neutral: { border: "border-zinc-300", bg: "bg-zinc-50", text: "text-zinc-600", Icon: null, iconLabel: "" },
};

export interface AttentionStatProps {
  /** Short label above the value, e.g. "Price move", "Volume". */
  label: string;
  /** The formatted headline value, e.g. "+5.8%", "2.4x", "z=2.2". */
  value: string;
  direction: Direction;
  /** true = bordered/tinted "stat card" treatment (crosses the materiality threshold); false = plain body text. Never decided by this component — callers pass the result of isHighlightWorthy()/primarySignal(). */
  highlighted: boolean;
  /** One-line plain-English explanation, always shown — never color/highlight alone. */
  message?: string;
  className?: string;
}

/**
 * The one shared "is this number worth your attention" treatment (plan
 * §3): a bordered, tinted stat card for numbers that cross the materiality
 * threshold, plain body text otherwise. Used by both the briefing feed's
 * StoryCard and the stock detail screen's signal breakdown — one
 * component, not restyled per screen.
 *
 * Never color-only: every highlighted card pairs its color with an icon
 * (↑/↓/⚠) and a text label, so the signal survives grayscale/colorblind
 * rendering.
 */
export function AttentionStat({ label, value, direction, highlighted, message, className = "" }: AttentionStatProps) {
  const meta = DIRECTION_META[direction];

  if (!highlighted) {
    return (
      <div className={`py-1.5 ${className}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-zinc-500">{label}</span>
          <span className="text-sm font-medium text-zinc-700">{value}</span>
        </div>
        {message && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{message}</p>}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${meta.border} ${meta.bg} px-3 py-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        {meta.iconLabel && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.text}`}>
            {meta.Icon && <meta.Icon size={12} aria-hidden />}
            {meta.iconLabel}
          </span>
        )}
      </div>
      <div className={`mt-0.5 text-2xl font-bold leading-tight ${meta.text}`}>{value}</div>
      {message && <p className="mt-1 text-xs leading-relaxed text-zinc-600">{message}</p>}
    </div>
  );
}
