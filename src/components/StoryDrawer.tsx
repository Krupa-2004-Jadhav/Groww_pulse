"use client";

import { Story } from "@/lib/scoring/group-into-stories";
import { ChangeEvent } from "@/lib/client/api";
import { TIER_META } from "./tier";
import { formatFreshness, freshnessState } from "@/lib/client/format";
import { useAcknowledgeEvent } from "@/lib/client/hooks";

const FRESHNESS_LABEL: Record<string, string> = { fresh: "Fresh", delayed: "Delayed", stale: "Stale" };

export function StoryDrawer({
  story,
  watchlistId,
  userId,
  onClose,
}: {
  story: Story<ChangeEvent>;
  watchlistId: string;
  userId: string;
  onClose: () => void;
}) {
  const meta = TIER_META[story.tier];
  const acknowledge = useAcknowledgeEvent(watchlistId, userId);

  const markAllReviewed = () => {
    for (const event of story.events) acknowledge.mutate(event.seq);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{story.symbol}</h2>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.badgeClass}`}>
              {meta.label} · score {story.attentionScore}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600" aria-label="Close">
            ✕
          </button>
        </div>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">Why this is highlighted</h3>
        <ul className="mt-2 space-y-3">
          {story.events.map((event) => {
            const state = freshnessState(event.occurredAt);
            return (
              <li key={event.seq} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-medium uppercase tracking-wide text-zinc-500">
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  <span
                    className={
                      state === "fresh" ? "text-emerald-600" : state === "delayed" ? "text-amber-600" : "text-zinc-400"
                    }
                  >
                    {FRESHNESS_LABEL[state]} · {formatFreshness(event.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-700">{event.reason}</p>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex gap-2">
          <button
            onClick={markAllReviewed}
            disabled={acknowledge.isPending}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Mark reviewed
          </button>
          <button onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
            Close
          </button>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-zinc-400">
          Information and monitoring only — this is not investment advice, and nothing here is a buy or sell
          recommendation.
        </p>
      </div>
    </div>
  );
}
