"use client";

import { useState } from "react";
import { useCurrentUser, useWatchlists } from "@/lib/client/hooks";
import { Sidebar } from "@/components/Sidebar";
import { Briefing } from "@/components/Briefing";

export default function Home() {
  const { data: me, isLoading: userLoading } = useCurrentUser();
  const { data: watchlistsData } = useWatchlists(me?.userId);
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);

  // First-time convenience: land on the first watchlist automatically, but
  // let an explicit user pick override it — derived, not effect-driven, so
  // there's no extra render cascade.
  const selectedId = explicitSelectedId ?? watchlistsData?.watchlists[0]?.id ?? null;

  if (userLoading || !me) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading…</div>;
  }

  return (
    <div className="flex flex-1">
      <Sidebar userId={me.userId} selectedId={selectedId} onSelect={setExplicitSelectedId} />
      <main className="flex-1 overflow-y-auto">
        {selectedId ? (
          <Briefing watchlistId={selectedId} userId={me.userId} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <h2 className="text-lg font-semibold text-zinc-800">Create a watchlist to get started</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Pulse tells you what changed since you last checked — not another price ticker.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
