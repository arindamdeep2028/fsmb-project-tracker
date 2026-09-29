import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaskNode } from "@/types/domain";

/** Responsibilities tree: tasks + calculated progress/weights (task_rollup) + flags (task_flags), joined by id. */
export async function getProjectTaskTree(projectId: string, opts: { onlyUser?: string } = {}): Promise<TaskNode[]> {
  const supabase = await createClient();
  let tq = supabase.from("tasks").select("*, assignee:profiles!tasks_assigned_to_fkey(full_name)")
    .eq("project_id", projectId).eq("archived", false).order("code");
  if (opts.onlyUser) tq = tq.eq("assigned_to", opts.onlyUser);
  const [tasks, rollup, flags] = await Promise.all([
    tq,
    supabase.from("task_rollup").select("*").eq("project_id", projectId),
    supabase.from("task_flags").select("task_id, is_red, reasons, deadline_status").eq("project_id", projectId),
  ]);
  if (tasks.error) throw tasks.error;
  const r = new Map((rollup.data ?? []).map((x) => [x.task_id, x]));
  const f = new Map((flags.data ?? []).map((x) => [x.task_id, x]));
  const nodes: TaskNode[] = (tasks.data ?? []).map(({ assignee, ...t }) => ({
    ...t,
    assignee_name: assignee?.full_name ?? null,
    is_leaf: r.get(t.id)?.is_leaf ?? true,
    calculated_progress: r.get(t.id)?.calculated_progress ?? t.progress_pct,
    effective_weight: r.get(t.id)?.effective_weight ?? null,
    is_red: Boolean(f.get(t.id)?.is_red) && t.status !== "Completed",
    reasons: (f.get(t.id)?.reasons ?? []) as TaskNode["reasons"],
    deadline_status: f.get(t.id)?.deadline_status ?? null,
    children: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: TaskNode[] = [];
  for (const n of nodes) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (parent) parent.children.push(n); else roots.push(n);
  }
  return roots;
}

export async function getTaskDetail(taskId: string) {
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks")
    .select("*, assignee:profiles!tasks_assigned_to_fkey(full_name), creator:profiles!tasks_created_by_fkey(full_name), project:projects(id, code, name, department_id)")
    .eq("id", taskId).maybeSingle();
  if (!task) return null;
  const [subtasks, flags, rollup, extensions, history, comments, items] = await Promise.all([
    supabase.from("tasks").select("id, code, title, status, progress_pct, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("parent_id", taskId).eq("archived", false).order("code"),
    supabase.from("task_flags").select("*").eq("task_id", taskId).maybeSingle(),
    supabase.from("task_rollup").select("*").eq("task_id", taskId).maybeSingle(),
    supabase.from("task_extensions").select("*, granter:profiles!task_extensions_granted_by_fkey(full_name)").eq("task_id", taskId).order("granted_at", { ascending: false }),
    supabase.from("task_contributions").select("*, who:profiles!task_contributions_user_id_fkey(full_name)").eq("task_id", taskId).order("recorded_at", { ascending: false }).limit(50),
    supabase.from("task_comments").select("*, author:profiles!task_comments_author_id_fkey(full_name)").eq("task_id", taskId).order("created_at"),
    supabase.from("daily_report_items").select("id, progress_after, status_after, note, report:daily_reports!daily_report_items_report_id_fkey(id, report_date, user_id)")
      .eq("task_id", taskId).order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    task, subtasks: subtasks.data ?? [], flags: flags.data, rollup: rollup.data, extensions: extensions.data ?? [],
    history: history.data ?? [], comments: comments.data ?? [], items: items.data ?? [],
  };
}
