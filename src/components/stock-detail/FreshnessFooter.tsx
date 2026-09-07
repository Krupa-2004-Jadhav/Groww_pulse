"use client";

import { formatFreshness } from "@/lib/client/format";

function label(iso: string | null): string {
  return iso ? formatFreshness(iso) : "no data";
}

/** Per-data-group freshness, never one generic "last updated" (plan §9 / spec §2E). Real timestamps from the API response. */
export function FreshnessFooter({ price, volume, lastEvent }: { price: string | null; volume: string | null; lastEvent: string | null }) {
  return (
    <div className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-400 sm:px-6">
      Price: {label(price)} · Volume: {label(volume)} · Last event: {label(lastEvent)}
    </div>
  );
}
