"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BUCKET_COLOR, type StatusBucket, type StatusSlice } from "@/lib/dashboard-status";
import { fmt } from "@/lib/time";

const axis = { fontSize: 12, fill: "#647568" };

/** Donut of the status split, with the completed share in the middle. */
export function StatusDonut({ slices }: { slices: StatusSlice[] }) {
  const total = slices.reduce((a, s) => a + s.count, 0);
  const done = slices.find((s) => s.bucket === "Completed")?.pct ?? 0;
  const data = total ? slices.filter((s) => s.count) : [{ bucket: "None", count: 1, pct: 0 }];
  return (
    <div className="relative h-36 w-36 shrink-0" data-testid="completion-donut">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="bucket" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="#ffffff" strokeWidth={2} isAnimationActive={false}>
            {data.map((s) => <Cell key={s.bucket} fill={BUCKET_COLOR[s.bucket as StatusBucket] ?? "#ebf0ec"} />)}
          </Pie>
          {total ? <Tooltip formatter={(v, n) => [`${v} ${Number(v) === 1 ? "item" : "items"}`, String(n)]} /> : null}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-bold leading-none tracking-tight" data-testid="donut-center">{total ? `${done}%` : "—"}</div>
          <div className="mt-1 text-sm font-medium text-ink-soft">Completed</div>
        </div>
      </div>
    </div>
  );
}

/** Four status bars with their counts on top. */
export function StatusBars({ counts }: { counts: Record<StatusBucket, number> }) {
  const data = (Object.keys(counts) as StatusBucket[]).map((bucket) => ({ bucket, count: counts[bucket] }));
  return (
    <div className="h-44 w-full" data-testid="task-status-bars">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="14%">
          <XAxis dataKey="bucket" tick={{ ...axis, fill: "#26332b" }} axisLine={{ stroke: "#dde5de" }} tickLine={false} interval={0} />
          <YAxis hide allowDecimals={false} />
          <Tooltip cursor={{ fill: "#f4f7f4" }} formatter={(v) => [`${v} ${Number(v) === 1 ? "task" : "tasks"}`, "Tasks"]} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} minPointSize={3} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.bucket} fill={BUCKET_COLOR[d.bucket]} />)}
            <LabelList dataKey="count" position="top" style={{ fontSize: 16, fontWeight: 700, fill: "#26332b" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Points delivered per day over the last 30 days (my_dashboard's progress_trend_30d), as a filled line. */
export function DeliveredTrend({ data }: { data: { day: string; delivered_points: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-ink-soft">No progress recorded in the last 30 days.</p>;
  return (
    <div className="h-44 w-full" data-testid="delivered-trend">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="deliveredFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34483c" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#34483c" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#ebf0ec" vertical={false} />
          <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: "#dde5de" }} tickFormatter={(d: string) => fmt(`${d}T12:00:00+06:00`, "MMM d")} minTickGap={18} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip labelFormatter={(d) => fmt(`${d}T12:00:00+06:00`, "dd MMM")} formatter={(v) => [`${v} pts`, "Delivered"]} />
          <Area type="monotone" dataKey="delivered_points" stroke="#34483c" strokeWidth={2} fill="url(#deliveredFill)"
            dot={{ r: 3, fill: "#ffffff", stroke: "#34483c", strokeWidth: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
