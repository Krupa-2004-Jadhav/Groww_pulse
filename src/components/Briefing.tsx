"use client";

import { useEffect, useRef, useState } from "react";
import { useChanges, useWatchlist, useAck, useHealth, useRemoveSymbol, useMarketSession } from "@/lib/client/hooks";
import { groupIntoStories, Story } from "@/lib/scoring/group-into-stories";
import { ChangeEvent } from "@/lib/client/api";
import { formatLastSeen } from "@/lib/client/format";
import { StoryCard } from "./StoryCard";
import { StoryDrawer } from "./StoryDrawer";
import { AddSymbolDialog } from "./AddSymbolDialog";

export function Briefing({ watchlistId, userId }: { watchlistId: string; userId: string }) {
  const { data: watchlist, isLoading: watchlistLoading } = useWatchlist(watchlistId);
  const { data: changes, isLoading: changesLoading, isError, error } = useChanges(watchlistId, userId);
  const { data: health } = useHealth();
  const marketSession = useMarketSession();
  const ack = useAck(watchlistId, userId);
  const removeSymbol = useRemoveSymbol(watchlistId);

  const [openStory, setOpenStory] = useState<Story<ChangeEvent> | null>(null);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const ackedCursor = useRef<number | null>(null);

  // "On render of the feed, call /ack with the returned cursor" (plan Phase
  // 9) — confirms the user has actually seen this batch of stories, once
  // per distinct cursor value (not on every re-render/poll).
  useEffect(() => {
    if (!changes) return;
    if (ackedCursor.current === changes.cursor) return;
    ackedCursor.current = changes.cursor;
    ack.mutate(changes.cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes?.cursor]);

  if (watchlistLoading || changesLoading) {
    return <div className="p-8 text-sm text-zinc-400">Loading your briefing…</div>;
  }

  if (isError) {
    return (
      <div className="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn&apos;t load this watchlist. {(error as Error)?.message}
      </div>
    );
  }

  if (!watchlist || !changes) return null;

  const stories = groupIntoStories(changes.events);
  const storySymbols = new Set(stories.map((s) => s.symbol));
  const quietSymbols = changes.symbols.filter((s) => !storySymbols.has(s));

  const ingestStale = health && health.ingest.secondsSinceLastSuccess !== null && health.ingest.secondsSinceLastSuccess > 300;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{watchlist.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {stories.length === 0
              ? "Nothing meaningful changed since your last visit."
              : `${stories.length} thing${stories.length === 1 ? "" : "s"} need your attention since your last visit.`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">Last checked: {formatLastSeen(changes.lastSeenAt)}</p>
        </div>
        <button
          onClick={() => setAddingSymbol(true)}
          className="whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          + Add stock
        </button>
      </header>

      {marketSession === "closed" ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          Market closed — showing prices and stories as of the last close.
        </div>
      ) : (
        ingestStale && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Market data hasn&apos;t refreshed in a while ({health!.ingest.secondsSinceLastSuccess}s) — showing the
            last known prices.
          </div>
        )
      )}
      {health?.provider.provider === "replay" && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Running on simulated market data (MARKET_PROVIDER=replay) — prices and events here are generated, not real.
        </div>
      )}

      {watchlist.items.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 p-8 text-center">
          <p className="text-sm text-zinc-500">This watchlist is empty.</p>
          <button
            onClick={() => setAddingSymbol(true)}
            className="mt-3 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Add your first stock
          </button>
        </div>
      )}

      {stories.length > 0 && (
        <section className="mt-6 space-y-3">
          {stories.map((story) => (
            <StoryCard key={story.symbol} story={story} onOpen={() => setOpenStory(story)} />
          ))}
        </section>
      )}

      {quietSymbols.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">No meaningful change</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {quietSymbols.map((symbol) => (
              <span
                key={symbol}
                className="group inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500"
              >
                {symbol}
                <button
                  onClick={() => removeSymbol.mutate(symbol)}
                  className="text-zinc-300 opacity-0 hover:text-zinc-600 group-hover:opacity-100"
                  aria-label={`Remove ${symbol}`}
                  title="Remove from watchlist"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {openStory && (
        <StoryDrawer story={openStory} watchlistId={watchlistId} userId={userId} onClose={() => setOpenStory(null)} />
      )}
      {addingSymbol && <AddSymbolDialog watchlistId={watchlistId} onClose={() => setAddingSymbol(false)} />}
    </div>
  );
}
