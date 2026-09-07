"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { DetailBar } from "@/lib/client/detail-api";

const NORMAL = "#C9C9C9";
const HIGHLIGHT = "#F5A524"; // amber — "unusual," a third state, not a shade of green/red
const GRID = "#EDEDED";
const HIGHLIGHT_RATIO = 2; // bars exceeding 2x the 20-day average render highlighted (spec §2C)

interface VolumePoint {
  date: string;
  volume: number;
  ratio: number;
  highlighted: boolean;
}

export function VolumeChart({ bars, avgVolume20d }: { bars: DetailBar[]; avgVolume20d: number | null }) {
  const data: VolumePoint[] = bars.map((b) => {
    const ratio = avgVolume20d ? b.volume / avgVolume20d : 0;
    return { date: b.date, volume: b.volume, ratio, highlighted: ratio >= HIGHLIGHT_RATIO };
  });

  return (
    <div className="h-32 w-full sm:h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8A8A8A" }} tickFormatter={(d: string) => d.slice(5)} minTickGap={40} />
          <YAxis
            tick={{ fontSize: 11, fill: "#8A8A8A" }}
            width={48}
            tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}K`)}
          />
          <Tooltip content={<VolumeTooltip />} />

          {avgVolume20d !== null && (
            <ReferenceLine
              y={avgVolume20d}
              stroke="#8A8A8A"
              strokeDasharray="4 4"
              label={{ value: "20d avg", position: "insideTopRight", fontSize: 10, fill: "#8A8A8A" }}
            />
          )}

          <Bar dataKey="volume" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.highlighted ? HIGHLIGHT : NORMAL} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VolumeTooltip({ active, payload }: { active?: boolean; payload?: { payload: VolumePoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <div className="font-semibold text-zinc-900">{point.date}</div>
      <div className="mt-0.5 text-zinc-600">Volume: {point.volume.toLocaleString()}</div>
      {point.ratio > 0 && (
        <div className={point.highlighted ? "mt-0.5 font-medium text-amber-600" : "mt-0.5 text-zinc-500"}>
          {point.ratio.toFixed(1)}x 20-day average{point.highlighted ? " — unusual" : ""}
        </div>
      )}
    </div>
  );
}
