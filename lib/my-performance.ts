import { inWindow } from "@/lib/drill";
import type { Enums } from "@/types/database";

/**
 * My Performance click-through: the records behind each figure on the page, with exactly the definitions
 * app.performance_rows uses for the figure (my_performance). Pure functions, shared by the page and its tests.
 *
 *   assigned       tasks assigned to me, not archived, assigned (Dhaka date) inside the window
 *   completed      … status Completed, completed (Dhaka date) inside the window
 *   late           … completed, and completed_on > effective_due_at (no deadline → never late, as in SQL)
 *   ontime         completed − late (the share behind "On time")
 *   red            activity_log 'Red mark' about me, log_date inside the window
 *   daily          activity_log 'Daily update' about me, log_date inside the window
 */
export const PERFORMANCE_METRICS = ["score", "completed", "ontime", "red", "assigned", "late", "daily"] as const;
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];

export type PerformanceTask = {
  id: string; code: string; title: string; type: Enums<"task_type">; status: Enums<"task_status">; progress_pct: number;
  assigned_on: string; completed_on: string | null; effective_due_at: string | null;
  project_id: string; project_code: string | null; project_name: string | null;
};
export type PerformanceLog = {
  id: number; ts: string; log_date: string; action: "Red mark" | "Daily update";
  project_id: string | null; project_code: string | null; task_id: string | null; task_code: string | null; task_title: string | null;
  details: string | null; reason_code: Enums<"breach_reason"> | null;
};
/** The figures my_performance returned (the page shows these; the records explain them). */
export type PerformanceSummary = {
  assigned: number; completed: number; late: number; on_time_pct: number | null; red_events: number; daily_updates: number; score: number | null;
};

export type PerformanceRecords = {
  assigned: PerformanceTask[]; completed: PerformanceTask[]; ontime: PerformanceTask[]; late: PerformanceTask[];
  red: PerformanceLog[]; daily: PerformanceLog[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date "yyyy-MM-dd" (the window comes from the URL). */
export function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
/** Start of a Dhaka day as a UTC ISO timestamp (Asia/Dhaka is UTC+6, no daylight saving). */
export const dhakaDayStart = (d: string) => new Date(`${d}T00:00:00+06:00`).toISOString();
/** The day after `d` ("yyyy-MM-dd"). */
export const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** Completed after its deadline: SQL `completed_on > effective_due_at` (null deadline → not late). */
export function isLate(t: Pick<PerformanceTask, "status" | "completed_on" | "effective_due_at">): boolean {
  return t.status === "Completed" && Boolean(t.completed_on) && Boolean(t.effective_due_at)
    && new Date(t.completed_on!).getTime() > new Date(t.effective_due_at!).getTime();
}

const byDesc = <T,>(key: (x: T) => string | null) => (a: T, b: T) => (key(b) ?? "").localeCompare(key(a) ?? "");

/** Splits the fetched rows into the records behind each figure, newest first. */
export function classifyRecords(tasks: PerformanceTask[], logs: PerformanceLog[], w: { from: string; to: string }): PerformanceRecords {
  const assigned = tasks.filter((t) => inWindow(t.assigned_on, w)).sort(byDesc((t) => t.assigned_on));
  const completed = tasks.filter((t) => t.status === "Completed" && inWindow(t.completed_on, w)).sort(byDesc((t) => t.completed_on));
  const inRange = (l: PerformanceLog) => l.log_date >= w.from && l.log_date <= w.to;
  return {
    assigned,
    completed,
    late: completed.filter(isLate),
    ontime: completed.filter((t) => !isLate(t)),
    red: logs.filter((l) => l.action === "Red mark" && inRange(l)).sort(byDesc((l) => l.ts)),
    daily: logs.filter((l) => l.action === "Daily update" && inRange(l)).sort(byDesc((l) => l.ts)),
  };
}

/** How many records the figure counts (from my_performance), to compare with how many the viewer may open. */
export function expectedCount(m: Exclude<PerformanceMetric, "score">, s: PerformanceSummary): number {
  switch (m) {
    case "assigned": return s.assigned;
    case "completed": return s.completed;
    case "late": return s.late;
    case "ontime": return Math.max(0, s.completed - s.late);
    case "red": return s.red_events;
    case "daily": return s.daily_updates;
  }
}

/**
 * The score's two parts, from the same figures and weights the database used — for display only; the score
 * itself always comes from my_performance. null when there is no score (nothing completed in the window).
 */
export function scoreBreakdown(s: PerformanceSummary, weights: { onTime: number; clean: number }) {
  if (!s.completed) return null;
  const onTimeRate = 1 - s.late / s.completed;
  const cleanRate = 1 - Math.min(1, s.red_events / Math.max(1, s.assigned));
  return {
    onTimeRate, cleanRate,
    onTimePoints: 100 * weights.onTime * onTimeRate,
    cleanPoints: 100 * weights.clean * cleanRate,
  };
}
