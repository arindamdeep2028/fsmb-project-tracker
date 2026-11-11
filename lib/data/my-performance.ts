import "server-only";
import { createClient } from "@/lib/supabase/server";
import { classifyRecords, dhakaDayStart, isIsoDate, nextDay, type PerformanceLog, type PerformanceRecords, type PerformanceTask } from "@/lib/my-performance";

const PAGE = 1000;   // PostgREST returns at most this many rows per request

/** Reads every page of a query (ordered, so pages don't overlap). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ rows: T[]; error: boolean }> {
  const rows: T[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await page(i, i + PAGE - 1);
    if (error) return { rows, error: true };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: false };
  }
}

const EMPTY: PerformanceRecords = { assigned: [], completed: [], ontime: [], late: [], red: [], daily: [] };

/**
 * The records behind my own performance figures for a window — read as the signed-in user, so row-level
 * security decides what comes back (always only my own tasks and log entries; a task in a project I no longer
 * belong to is counted by the score but not shown). Nothing is written.
 */
export async function myPerformanceRecords(userId: string, from: string, to: string): Promise<{ records: PerformanceRecords; error: boolean }> {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return { records: EMPTY, error: false };
  const supabase = await createClient();
  const start = dhakaDayStart(from), end = dhakaDayStart(nextDay(to));

  const [tasks, logs] = await Promise.all([
    all((a, b) => supabase.from("tasks")
      .select("id, code, title, type, status, progress_pct, assigned_on, completed_on, effective_due_at, project_id, project:projects(code, name)")
      .eq("assigned_to", userId).eq("archived", false)
      .or(`and(assigned_on.gte."${start}",assigned_on.lt."${end}"),and(completed_on.gte."${start}",completed_on.lt."${end}")`)
      .order("assigned_on", { ascending: false }).order("id").range(a, b)),
    all((a, b) => supabase.from("activity_log")
      .select("id, ts, log_date, action, project_id, project_code, task_id, task_code, details, reason_code")
      .eq("subject_user_id", userId).in("action", ["Red mark", "Daily update"])
      .gte("log_date", from).lte("log_date", to)
      .order("ts", { ascending: false }).order("id").range(a, b)),
  ]);

  const taskRows: PerformanceTask[] = tasks.rows.map((t) => ({
    id: t.id, code: t.code, title: t.title, type: t.type, status: t.status, progress_pct: Number(t.progress_pct),
    assigned_on: t.assigned_on, completed_on: t.completed_on, effective_due_at: t.effective_due_at,
    project_id: t.project_id, project_code: t.project?.code ?? null, project_name: t.project?.name ?? null,
  }));

  // Task titles for the log entries: tasks already read, then the rest (only those the viewer may see).
  const titles = new Map(taskRows.map((t) => [t.id, t.title]));
  const missing = [...new Set(logs.rows.map((l) => l.task_id).filter((id): id is string => Boolean(id) && !titles.has(id!)))];
  let titleError = false;
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error } = await supabase.from("tasks").select("id, title").in("id", missing.slice(i, i + 100));
    if (error) titleError = true;
    for (const t of data ?? []) titles.set(t.id, t.title);
  }

  const logRows: PerformanceLog[] = logs.rows.map((l) => ({
    id: l.id, ts: l.ts, log_date: l.log_date ?? "", action: l.action as PerformanceLog["action"],
    project_id: l.project_id, project_code: l.project_code, task_id: l.task_id, task_code: l.task_code,
    task_title: l.task_id ? titles.get(l.task_id) ?? null : null, details: l.details, reason_code: l.reason_code,
  }));

  return { records: classifyRecords(taskRows, logRows, { from, to }), error: tasks.error || logs.error || titleError };
}
