import "server-only";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { dhakaToday } from "@/lib/time";

export async function listMyReports(userId: string, page = 0) {
  const supabase = await createClient();
  const { data } = await supabase.from("daily_reports")
    .select("id, report_date, day_name, update_text, locked, submitted_at, project:projects(code, name)")
    .eq("user_id", userId).order("report_date", { ascending: false }).range(page * 50, page * 50 + 49);
  return data ?? [];
}

export async function projectReportFeed(projectId: string, filters: { user?: string; date?: string } = {}, page = 0) {
  const supabase = await createClient();
  let q = supabase.from("daily_reports")
    .select("id, report_date, day_name, update_text, issues, next_task_text, remarks, submitted_at, locked, user_id, author:profiles!daily_reports_user_id_fkey(full_name), daily_report_items(count), daily_report_attachments(count)")
    .eq("project_id", projectId).order("report_date", { ascending: false }).order("submitted_at", { ascending: false })
    .range(page * 50, page * 50 + 49);
  if (filters.user) q = q.eq("user_id", filters.user);
  if (filters.date) q = q.eq("report_date", filters.date);
  const { data } = await q;
  return data ?? [];
}

/** A report with its items and files; files get 10-minute signed URLs (only if the Storage read policy passes). */
export async function getReport(id: string) {
  const supabase = await createClient();
  const { data: report } = await supabase.from("daily_reports")
    .select("*, author:profiles!daily_reports_user_id_fkey(full_name), project:projects(id, code, name, department_id), next_task:tasks!daily_reports_next_task_id_fkey(code, title)")
    .eq("id", id).maybeSingle();
  if (!report) return null;
  const [items, files] = await Promise.all([
    supabase.from("daily_report_items").select("*").eq("report_id", id).order("task_code"),
    supabase.from("daily_report_attachments").select("*").eq("report_id", id).order("uploaded_at"),
  ]);
  const attachments = files.data ?? [];
  let urls: Record<string, string> = {};
  if (attachments.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(attachments.map((a) => a.storage_path), 600);
    urls = Object.fromEntries((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path ?? "", s.signedUrl as string]));
  }
  return { report, items: items.data ?? [], attachments: attachments.map((a) => ({ ...a, url: urls[a.storage_path] ?? null })) };
}

/** What the report form needs: member projects, my open tasks in the chosen project, and today's report if any. */
export async function getReportFormData(userId: string, projectId?: string) {
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("project_members")
    .select("project:projects(id, code, name, archived)").eq("user_id", userId).is("removed_at", null);
  const projects = (memberships ?? []).map((m) => m.project).filter((p): p is NonNullable<typeof p> => Boolean(p && !p.archived))
    .sort((a, b) => a.code.localeCompare(b.code));
  const pid = projectId && projects.some((p) => p.id === projectId) ? projectId : projects[0]?.id;
  if (!pid) return { projects, projectId: null, tasks: [], existing: null };
  const [tasks, existing] = await Promise.all([
    supabase.from("tasks").select("id, code, title, parent_id, status, progress_pct")
      .eq("project_id", pid).eq("assigned_to", userId).eq("archived", false).neq("status", "Completed").order("code"),
    supabase.from("daily_reports").select("*, daily_report_items(*), daily_report_attachments(*)")
      .eq("user_id", userId).eq("project_id", pid).eq("report_date", dhakaToday()).maybeSingle(),
  ]);
  const { data: leafRows } = await supabase.from("task_rollup").select("task_id, is_leaf").eq("project_id", pid);
  const leaf = new Map((leafRows ?? []).map((r) => [r.task_id, r.is_leaf]));
  return {
    projects, projectId: pid,
    tasks: (tasks.data ?? []).map((t) => ({ ...t, is_leaf: leaf.get(t.id) ?? true })),
    existing: existing.data ?? null,
  };
}
