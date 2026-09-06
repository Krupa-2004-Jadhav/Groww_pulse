"use client";

import { Story } from "@/lib/scoring/group-into-stories";
import { ChangeEvent } from "@/lib/client/api";
import { TIER_META, directionArrow } from "./tier";

export function StoryCard({ story, onOpen }: { story: Story<ChangeEvent>; onOpen: () => void }) {
  const meta = TIER_META[story.tier];
  const arrow = directionArrow(story.reason);

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-2 w-2 rounded-full ${meta.dotClass}`} aria-hidden />
          <span className="text-base font-semibold text-zinc-900">{story.symbol}</span>
          <span aria-hidden className="text-zinc-400">
            {arrow}
          </span>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${meta.badgeClass}`}>
          {meta.label}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-zinc-700">{story.reason}</p>

      <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
        <span>Attention score {story.attentionScore}</span>
        <span aria-hidden>·</span>
        <span>
          {story.events.length} signal{story.events.length === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}
