"use client";

/**
 * "Since Friday's close," not "18h ago" — plan Phase 9: absence windows
 * framed in market terms, not raw hours.
 */
export function formatLastSeen(iso: string | null): string {
  if (!iso) return "your first visit";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin < 2) return "moments ago";
  if (diffMin < 60) return `${diffMin} min ago`;

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `today, ${time}`;
  if (isYesterday) return `yesterday, ${time}`;

  const daysAgo = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (daysAgo < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: "long" })}, ${time}`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + `, ${time}`;
}

export function formatFreshness(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "moments ago";
  if (diffMin === 1) return "1 min ago";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  return `${hours}h ago`;
}

export function freshnessState(iso: string): "fresh" | "delayed" | "stale" {
  const diffMin = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (diffMin < 5) return "fresh";
  if (diffMin < 30) return "delayed";
  return "stale";
}
