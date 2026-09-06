/**
 * Tier -> color + icon + label. Plan §9's design principle: never color
 * alone (accessibility) — every tier also carries a text label and a
 * distinct glyph, so the signal survives grayscale/colorblind rendering.
 */
export type Tier = "high" | "medium" | "low";

export const TIER_META: Record<Tier, { label: string; icon: string; badgeClass: string; dotClass: string }> = {
  high: {
    label: "High attention",
    icon: "●",
    badgeClass: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
    dotClass: "bg-red-500",
  },
  medium: {
    label: "Medium attention",
    icon: "●",
    badgeClass: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    dotClass: "bg-amber-500",
  },
  low: {
    label: "Low attention",
    icon: "○",
    badgeClass: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
    dotClass: "bg-blue-400",
  },
};

export function directionArrow(reason: string): string {
  if (/\bup\b|\boutperformed\b|\+\d/.test(reason)) return "↑";
  if (/\bdown\b|\bunderperformed\b|-\d/.test(reason)) return "↓";
  return "•";
}
