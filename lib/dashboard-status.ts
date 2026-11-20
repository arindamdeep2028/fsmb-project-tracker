/**
 * Engineer dashboard: how tasks split by their stored status (display only — nothing here changes how progress or
 * project completion is calculated). The five task statuses are shown in four groups: "Plan submitted" counts as
 * Not Started (the work itself has not started yet).
 */
export const BUCKETS = ["Completed", "In Progress", "Not Started", "Blocked"] as const;
export type StatusBucket = (typeof BUCKETS)[number];

/** Status colours from the app's Forest Green tokens (steel, sage, line grey, signal red). */
export const BUCKET_COLOR: Record<StatusBucket, string> = {
  Completed: "#34483c", "In Progress": "#91a98d", "Not Started": "#c3ccc5", Blocked: "#c4302b",
};

export function bucketOf(status: string): StatusBucket {
  if (status === "Completed") return "Completed";
  if (status === "In progress") return "In Progress";
  if (status === "Blocked") return "Blocked";
  return "Not Started";
}

export type StatusSlice = { bucket: StatusBucket; count: number; pct: number };

/** Counts per group and whole-number percentages that add up to 100 (largest remainder); all 0 when there is nothing. */
export function statusBreakdown(statuses: string[]): StatusSlice[] {
  const counts = BUCKETS.map((b) => statuses.filter((s) => bucketOf(s) === b).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return BUCKETS.map((bucket) => ({ bucket, count: 0, pct: 0 }));
  const raw = counts.map((c) => (c * 100) / total);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((a, b) => a + b, 0);
  [...raw.keys()].sort((a, b) => raw[b] - Math.floor(raw[b]) - (raw[a] - Math.floor(raw[a])) || a - b).forEach((i) => { if (left > 0 && counts[i]) { pct[i]++; left--; } });
  return BUCKETS.map((bucket, i) => ({ bucket, count: counts[i], pct: pct[i] }));
}

/** Monday of the week of a Dhaka date ("yyyy-MM-dd"). */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;          // Monday 0 … Sunday 6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Task Status (this week) for the person: Completed = their tasks completed since Monday (Dhaka dates); the other
 * groups = their open tasks as they stand now (the same tasks the "Open tasks" figure counts).
 */
export function weekTaskStatus(open: { status: string }[], completedDates: string[], from: string): Record<StatusBucket, number> {
  const out: Record<StatusBucket, number> = { Completed: 0, "In Progress": 0, "Not Started": 0, Blocked: 0 };
  for (const t of open) if (t.status !== "Completed") out[bucketOf(t.status)]++;
  out.Completed = completedDates.filter((d) => d >= from).length;
  return out;
}
