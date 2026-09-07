"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchlists, useCreateWatchlist } from "@/lib/client/hooks";

export function Sidebar({
  userId,
  selectedId,
  onSelect,
}: {
  userId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = useWatchlists(userId);
  const createWatchlist = useCreateWatchlist(userId);
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [runningDemo, setRunningDemo] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    createWatchlist.mutate(name.trim(), {
      onSuccess: (wl) => {
        onSelect(wl.id);
        setName("");
        setCreating(false);
      },
    });
  };

  const runDemoScenario = async () => {
    setRunningDemo(true);
    try {
      const res = await fetch("/api/demo/run-scenario", { method: "POST" });
      const result = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["watchlists", userId] });
      onSelect(result.watchlistId);
    } finally {
      setRunningDemo(false);
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold tracking-tight text-zinc-900">Pulse</h1>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Watchlists</h2>
        <button onClick={() => setCreating((c) => !c)} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
          + New
        </button>
      </div>

      {creating && (
        <div className="mt-2 flex gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Watchlist name"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:border-brand"
          />
          <button onClick={submit} className="rounded-md bg-brand px-2 text-xs text-white hover:bg-brand-dark">
            Add
          </button>
        </div>
      )}

      <nav className="mt-3 flex flex-col gap-0.5">
        {isLoading && <p className="px-2 py-1 text-xs text-zinc-400">Loading…</p>}
        {data?.watchlists.length === 0 && !isLoading && (
          <p className="px-2 py-1 text-xs text-zinc-400">No watchlists yet.</p>
        )}
        {data?.watchlists.map((wl) => (
          <button
            key={wl.id}
            onClick={() => onSelect(wl.id)}
            className={`rounded-md px-2 py-1.5 text-left text-sm ${
              selectedId === wl.id ? "bg-brand/10 font-medium text-brand-dark" : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {wl.name}
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-4">
        <button
          onClick={runDemoScenario}
          disabled={runningDemo}
          className="w-full rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-50"
          title="Runs a scripted, deterministic scenario: a gap, a volume spike, a split-adjusted history, and a feed outage with automatic recovery."
        >
          {runningDemo ? "Running scenario…" : "▶ Run demo scenario"}
        </button>
      </div>
    </aside>
  );
}
