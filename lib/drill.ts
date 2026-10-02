import { formatInTimeZone } from "date-fns-tz";
import { TZ } from "@/lib/time";
import type { TaskNode } from "@/types/domain";

/**
 * Dashboard click-through: the task filters a dashboard figure can open, with the same definitions the
 * database uses for the figure (app.project_metrics, department_dashboard, performance_rows, my_dashboard).
 * Pure functions, shared by the task pages and their tests.
 */
export const TASK_FILTERS = ["open", "red", "overdue", "blocked", "done", "ontime", "late", "assigned", "extended", "redmark"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];
export const isTaskFilter = (v: unknown): v is TaskFilter => TASK_FILTERS.includes(v as TaskFilter);

export const filterLabel: Record<TaskFilter, string> = {
  open: "Open tasks", red: "Red tasks now", overdue: "Overdue tasks", blocked: "Blocked tasks", done: "Completed tasks",
  ontime: "Completed on time", late: "Completed late", assigned: "Tasks assigned", extended: "Tasks with extensions granted",
  redmark: "Tasks with red-mark events",
};

/** A window: Dhaka dates (inclusive) or "since" (timestamp, for my_dashboard's rolling review window). */
export type Window = { from?: string; to?: string; since?: number };
const dhakaDate = (ts: string) => formatInTimeZone(new Date(ts), TZ, "yyyy-MM-dd");
export function inWindow(ts: string | null | undefined, w: Window): boolean {
  if (!ts) return false;
  if (w.since != null) return new Date(ts).getTime() > w.since;
  const d = dhakaDate(ts);
  return (!w.from || d >= w.from) && (!w.to || d <= w.to);
}

/** Does one task match? `marks` = ids of tasks with a matching extension / red-mark event (already windowed). */
export function taskMatches(n: Pick<TaskNode, "id" | "status" | "is_red" | "effective_due_at" | "completed_on" | "assigned_on" | "assigned_to">,
  f: TaskFilter, w: Window, opts: { user?: string; marks?: Set<string>; now?: number } = {}): boolean {
  if (opts.user && f !== "redmark" && n.assigned_to !== opts.user) return false;
  const now = opts.now ?? Date.now();
  const open = n.status !== "Completed";
  const done = n.status === "Completed" && inWindow(n.completed_on, w);
  switch (f) {
    case "open": return open;
    case "red": return open && n.is_red;
    case "overdue": return open && Boolean(n.effective_due_at) && now > new Date(n.effective_due_at!).getTime();
    case "blocked": return n.status === "Blocked";
    case "done": return n.status === "Completed" && (w.from || w.to || w.since != null ? inWindow(n.completed_on, w) : true);
    case "ontime": return done && new Date(n.completed_on!).getTime() <= new Date(n.effective_due_at!).getTime();
    case "late": return done && new Date(n.completed_on!).getTime() > new Date(n.effective_due_at!).getTime();
    case "assigned": return w.from || w.to ? inWindow(n.assigned_on, w) : true;
    case "extended":
    case "redmark": return Boolean(opts.marks?.has(n.id));
  }
}

/**
 * Keeps matching tasks; a parent that doesn't match stays as context when one of its subtasks matches.
 * Returns the pruned tree and the number of matching tasks (parents and subtasks), i.e. the figure's records.
 */
export function pruneTree(roots: TaskNode[], match: (n: TaskNode) => boolean): { nodes: TaskNode[]; count: number; context: string[] } {
  let count = 0;
  const nodes: TaskNode[] = [];
  const context: string[] = [];
  for (const r of roots) {
    const kids = r.children.filter(match);
    const self = match(r);
    count += kids.length + (self ? 1 : 0);
    if (self || kids.length) nodes.push({ ...r, children: kids });
    if (!self && kids.length) context.push(r.id);
  }
  return { nodes, count, context };
}

/** Only the matching tasks, one row each (subtasks too), for record lists across projects. */
export function flattenMatches(roots: TaskNode[], match: (n: TaskNode) => boolean): TaskNode[] {
  return roots.flatMap((r) => [r, ...r.children]).filter(match).map((n) => ({ ...n, children: [] }));
}

/** Builds a URL with only the defined parameters. */
export function href(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
