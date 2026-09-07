"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Dot,
} from "recharts";
import { DetailBar } from "@/lib/client/detail-api";

const GREEN = "#00B386";
const RED = "#EB5B3C";
const GRID = "#EDEDED";

interface ChartPoint {
  date: string;
  close: number;
  benchmark?: number;
  isEvent: boolean;
  eventReason?: string;
}

export function PriceChart({
  bars,
  benchmarkBars,
  high52w,
  low52w,
  eventDates,
  lastSeenAt,
}: {
  bars: DetailBar[];
  benchmarkBars: DetailBar[];
  high52w: number | null;
  low52w: number | null;
  eventDates: Map<string, string>; // date -> reason, for the marker + tooltip
  lastSeenAt: string | null;
}) {
  const benchmarkByDate = new Map(benchmarkBars.map((b) => [b.date, b.close]));
  const data: ChartPoint[] = bars.map((b) => ({
    date: b.date,
    close: b.close,
    benchmark: benchmarkByDate.get(b.date),
    isEvent: eventDates.has(b.date),
    eventReason: eventDates.get(b.date),
  }));

  const sinceYouLeftStart = lastSeenAt ? lastSeenAt.slice(0, 10) : null;
  const trend = data.length >= 2 && data[data.length - 1].close >= data[0].close ? GREEN : RED;

  return (
    <div className="h-64 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#8A8A8A" }}
            tickFormatter={(d: string) => d.slice(5)}
            minTickGap={40}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: "#8A8A8A" }}
            width={48}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip content={<PriceTooltip />} />

          {sinceYouLeftStart && <ReferenceArea x1={sinceYouLeftStart} x2={data[data.length - 1]?.date} fill="#00D09C" fillOpacity={0.06} />}

          {high52w !== null && (
            <ReferenceLine
              y={high52w}
              stroke="#B0B0B0"
              strokeDasharray="4 4"
              label={{ value: `52w high ${high52w.toFixed(0)}`, position: "insideTopRight", fontSize: 10, fill: "#8A8A8A" }}
            />
          )}
          {low52w !== null && (
            <ReferenceLine
              y={low52w}
              stroke="#B0B0B0"
              strokeDasharray="4 4"
              label={{ value: `52w low ${low52w.toFixed(0)}`, position: "insideBottomRight", fontSize: 10, fill: "#8A8A8A" }}
            />
          )}

          {benchmarkBars.length > 0 && (
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#B0B0B0"
              strokeWidth={1.5}
              strokeOpacity={0.6}
              dot={false}
              isAnimationActive={false}
              name="Benchmark (normalized)"
            />
          )}

          <Line
            type="monotone"
            dataKey="close"
            stroke={trend}
            strokeWidth={2}
            dot={<EventDot />}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
            name="Price"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Renders a visible dot only on days with a symbol_event — an ordinary trading day has no dot, keeping the line clean. */
function EventDot(props: unknown) {
  const p = props as { cx?: number; cy?: number; payload?: ChartPoint };
  if (!p.payload?.isEvent || p.cx === undefined || p.cy === undefined) return <></>;
  return <Dot cx={p.cx} cy={p.cy} r={4} fill="#00B386" stroke="#fff" strokeWidth={1.5} />;
}

function PriceTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="max-w-64 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <div className="font-semibold text-zinc-900">{point.date}</div>
      <div className="mt-0.5 text-zinc-600">Close: {point.close.toFixed(2)}</div>
      {point.isEvent && point.eventReason && (
        <div className="mt-1.5 border-t border-zinc-100 pt-1.5 text-zinc-700">{point.eventReason}</div>
      )}
    </div>
  );
}
