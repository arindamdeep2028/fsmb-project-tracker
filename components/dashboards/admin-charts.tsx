"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dhakaClock } from "@/lib/dashboard-status";

const axis = { fontSize: 12, fill: "#26332b" };

/** One bar per group with its count on top (colours come from the app's Forest Green tokens). */
export function CountBars({ data, unit = "project" }: { data: { label: string; count: number; color: string }[]; unit?: string }) {
  return (
    <div className="h-48 w-full" data-testid="count-bars">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="16%">
          <XAxis dataKey="label" tick={axis} axisLine={{ stroke: "#dde5de" }} tickLine={false} interval={0} />
          <YAxis hide allowDecimals={false} />
          <Tooltip cursor={{ fill: "#f4f7f4" }} formatter={(v) => [`${v} ${Number(v) === 1 ? unit : `${unit}s`}`, "Count"]} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} minPointSize={3} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
            <LabelList dataKey="count" position="top" style={{ fontSize: 16, fontWeight: 700, fill: "#26332b" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The current date and time in Dhaka, updated every few seconds (starts from the server's time, so no flash). */
export function LiveClock({ start }: { start: string }) {
  const [now, setNow] = useState(() => new Date(start));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);
  return <time dateTime={now.toISOString()} data-testid="live-clock" className="tabular-nums" suppressHydrationWarning>{dhakaClock(now)} <span className="text-ink-soft">Dhaka time</span></time>;
}
