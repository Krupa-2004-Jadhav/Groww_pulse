"use client";

import { useState } from "react";
import { useSymbolSearch, useAddSymbol } from "@/lib/client/hooks";

export function AddSymbolDialog({ watchlistId, onClose }: { watchlistId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const { data, isFetching } = useSymbolSearch(query);
  const addSymbol = useAddSymbol(watchlistId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Add a stock</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600" aria-label="Close">
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by symbol or company name…"
          className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-brand"
        />

        <div className="mt-3 max-h-72 overflow-y-auto">
          {isFetching && <p className="px-1 py-2 text-xs text-zinc-400">Searching…</p>}
          {!isFetching && query.trim().length > 0 && data?.results.length === 0 && (
            <p className="px-1 py-2 text-xs text-zinc-400">No matches.</p>
          )}
          <ul className="divide-y divide-zinc-100">
            {data?.results.map((r) => (
              <li key={`${r.symbol}-${r.exchange}`} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {r.symbol} <span className="font-normal text-zinc-400">— {r.exchange}</span>
                  </div>
                  <div className="text-xs text-zinc-500">{r.name}</div>
                </div>
                <button
                  onClick={() => addSymbol.mutate({ symbol: r.symbol, name: r.name, exchange: r.exchange })}
                  disabled={addSymbol.isPending}
                  className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          {addSymbol.data && (
            <p className="mt-2 text-xs text-emerald-600">
              {addSymbol.data.added ? "Added." : "Already on this watchlist."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
