import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { flattenMatches, inWindow, taskMatches, type TaskFilter, type Window } from "@/lib/drill";
import type { TaskNode } from "@/types/domain";

export type RecordScope = { dept?: string; project?: string; managed?: boolean };

/**
 * Task ids with an extension granted / a red-mark event in the window (and, for red marks, about the person).
 * Read as the user: RLS decides which extensions and log entries they may see. Also returns the event count.
 */
async function marks(f: TaskFilter, projectIds: string[], w: Window, user?: string): Promise<{ ids: Set<string>; events: number }> {
  if ((f !== "extended" && f !== "redmark") || !projectIds.length) return { ids: new Set(), events: 0 };
  const supabase = await createClient();
  if (f === "extended") {
    const { data } = await supabase.from("task_extensions").select("task_id, granted_at, task:tasks!inner(project_id)")
      .in("task.project_id", projectIds);
    const rows = (data ?? []).filter((e) => inWindow(e.granted_at, w));
    return { ids: new Set(rows.map((e) => e.task_id)), events: rows.length };
  }
  let q = supabase.from("activity_log").select("task_id, log_date").eq("action", "Red mark").in("project_id", projectIds);
  if (w.from) q = q.gte("log_date", w.from);
  if (w.to) q = q.lte("log_date", w.to);
  if (user) q = q.eq("subject_user_id", user);
  const { data } = await q;
  const rows = data ?? [];
  return { ids: new Set(rows.map((e) => e.task_id).filter((x): x is string => Boolean(x))), events: rows.length };
}

/**
 * The records behind a dashboard figure: tasks of the projects the viewer can see (RLS), narrowed by scope,
 * person, filter and window — grouped by project for the task tree. Nothing outside the viewer's access appears.
 */
export async function taskRecords(f: TaskFilter, scope: RecordScope, w: Window, user?: string) {
  const supabase = await createClient();
  let pq = supabase.from("projects").select("id, code, name, department_id").eq("archived", false).order("code");
  if (scope.dept) pq = pq.eq("department_id", scope.dept);
  if (scope.project) pq = pq.eq("id", scope.project);
  if (scope.managed) {
    const { data: managed } = await supabase.from("v_pm_projects").select("project_id");
    pq = pq.in("id", (managed ?? []).map((m) => m.project_id).filter((x): x is string => Boolean(x)).concat("00000000-0000-0000-0000-000000000000"));
  }
  const { data: projects } = await pq;
  const list = projects ?? [];
  const m = await marks(f, list.map((p) => p.id), w, user);
  const now = Date.now();
  const groups = await Promise.all(list.map(async (p) => {
    const tree = await getProjectTaskTree(p.id);
    const nodes = flattenMatches(tree, (n: TaskNode) => taskMatches(n, f, w, { user, marks: m.ids, now }));
    return { project: p, nodes, count: nodes.length };
  }));
  const shown = groups.filter((g) => g.count > 0);
  return { groups: shown, total: shown.reduce((a, g) => a + g.count, 0), events: m.events };
}
