"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 12, fill: "#4a5868" };

/** Points delivered per day (from task_contributions via my_dashboard). */
export function ProgressTrend({ data }: { data: { day: string; delivered_points: number }[] }) {
  if (!data.length) return <p className="text-sm text-ink-soft">No progress recorded in the last 30 days.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#e8ecf1" vertical={false} />
          <XAxis dataKey="day" tick={axis} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={axis} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} pts`, "Delivered"]} />
          <Line type="monotone" dataKey="delivered_points" stroke="#355c7d" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars: completion vs planned per project. */
export function CompletionBars({ data }: { data: { name: string; completion: number; planned: number | null }[] }) {
  if (!data.length) return null;
  return (
    <div className="w-full" style={{ height: Math.max(160, data.length * 36) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#e8ecf1" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={axis} unit="%" />
          <YAxis type="category" dataKey="name" tick={axis} width={70} />
          <Tooltip formatter={(v, n) => [`${Number(v).toFixed(0)}%`, n === "completion" ? "Completed" : "Planned"]} />
          <Bar dataKey="planned" fill="#d8dee6" barSize={8} />
          <Bar dataKey="completion" fill="#355c7d" barSize={8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
