import "server-only";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { dhakaToday, fmt } from "@/lib/time";
import { dateRange, isOffDay, letterOf, projectDayNumber, taskLabel, type DailyRow, type ReportOrder, type TaskFile } from "@/lib/sheet";

/** Short-lived signed links (10 min) for stored files, keyed by path, read with the caller's own access. */
async function signedUrls(supabase: Awaited<ReturnType<typeof createClient>>, paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((s) => s.signedUrl).map((s) => [s.path ?? "", s.signedUrl as string]));
}

/**
 * A task's screenshots and photos from the daily updates that list it (task-row attachments, migration 25),
 * by report id, read with the viewer's own access (only reports they can see) and signed for 10 minutes.
 */
export async function taskRowFiles(taskId: string): Promise<Record<string, TaskFile[]>> {
  const supabase = await createClient();
  const { data } = await supabase.from("daily_report_attachments").select("id, report_id, file_name, mime_type, storage_path, uploaded_at")
    .eq("task_id", taskId).order("uploaded_at");
  const urls = await signedUrls(supabase, (data ?? []).map((a) => a.storage_path));
  const out: Record<string, TaskFile[]> = {};
  for (const a of data ?? []) (out[a.report_id] ??= []).push({ id: a.id, name: a.file_name, mime: a.mime_type, url: urls[a.storage_path] ?? null });
  return out;
}

/** My saved reports, in the viewer's order (lib/auth/capabilities reportOrder). */
export async function listMyReports(userId: string, order: ReportOrder = "desc", page = 0) {
  const supabase = await createClient();
  const { data } = await supabase.from("daily_reports")
    .select("id, report_date, day_name, update_text, locked, submitted_at, project:projects(code, name, start_date, created_at)")
    .eq("user_id", userId).order("report_date", { ascending: order === "asc" }).order("submitted_at", { ascending: order === "asc" })
    .range(page * 200, page * 200 + 199);
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
    .select("*, author:profiles!daily_reports_user_id_fkey(full_name), project:projects(id, code, name, department_id, start_date, created_at), next_task:tasks!daily_reports_next_task_id_fkey(code, title)")
    .eq("id", id).maybeSingle();
  if (!report) return null;
  const [items, files] = await Promise.all([
    supabase.from("daily_report_items").select("*, parent:tasks!daily_report_items_parent_task_id_fkey(code, title)").eq("report_id", id).order("created_at"),
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

/**
 * What the daily update form needs: member projects, the project's start (for "Day N"), my open tasks and
 * subtasks in the chosen project (each with its parent for the Main Task label) and today's update if any.
 * A task today's update already lists is included even once it is Completed, so its entry stays in the form.
 */
export async function getReportFormData(userId: string, projectId?: string) {
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("project_members")
    .select("project:projects(id, code, name, archived, department_id, start_date, created_at)").eq("user_id", userId).is("removed_at", null);
  const projects = (memberships ?? []).map((m) => m.project).filter((p): p is NonNullable<typeof p> => Boolean(p && !p.archived))
    .sort((a, b) => a.code.localeCompare(b.code));
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  if (!project) return { projects, project: null, tasks: [], existing: null };
  const [tasks, existing, leafRows] = await Promise.all([
    supabase.from("tasks").select("id, project_id, code, title, parent_id, status, progress_pct, assigned_to, created_by, contribution_locked")
      .eq("project_id", project.id).eq("assigned_to", userId).eq("archived", false).order("code"),
    supabase.from("daily_reports").select("*, daily_report_items(*), daily_report_attachments(*)")
      .eq("user_id", userId).eq("project_id", project.id).eq("report_date", dhakaToday()).maybeSingle(),
    supabase.from("task_rollup").select("task_id, is_leaf").eq("project_id", project.id),
  ]);
  const leaf = new Map((leafRows.data ?? []).map((r) => [r.task_id, r.is_leaf]));
  const listed = new Set((existing.data?.daily_report_items ?? []).map((i) => i.task_id));
  const mine = (tasks.data ?? []).filter((t) => t.status !== "Completed" || listed.has(t.id));
  const parentIds = [...new Set(mine.map((t) => t.parent_id).filter((x): x is string => Boolean(x)))];
  const { data: parents } = parentIds.length
    ? await supabase.from("tasks").select("id, code, title").in("id", parentIds)
    : { data: [] as { id: string; code: string; title: string }[] };
  const parent = new Map((parents ?? []).map((p) => [p.id, p]));
  return {
    projects, project,
    tasks: mine.map((t) => ({ ...t, is_leaf: leaf.get(t.id) ?? true, parent: t.parent_id ? parent.get(t.parent_id) ?? null : null })),
    existing: existing.data ?? null,
  };
}

/** Day 1 of a project's Daily Follow Up: its start date, or the Dhaka date it was created. */
export function projectStart(p: { start_date: string | null; created_at: string }): string {
  return p.start_date ?? fmt(p.created_at, "yyyy-MM-dd");
}

/**
 * The project's Daily Follow Up for a date range: one row per person and date, plus an empty row for a date
 * nobody (or not the chosen person) reported on. RLS decides which reports the viewer reads. `order`: oldest
 * date first (default) or newest first.
 */
export async function projectDailyLog(
  project: { id: string; start_date: string | null; created_at: string },
  opts: { from: string; to: string; user?: { id: string; name: string } | null; workdays?: number[]; order?: ReportOrder },
): Promise<DailyRow[]> {
  const start = projectStart(project);
  const from = opts.from < start ? start : opts.from;           // the sheet starts at Day 1
  if (from > opts.to) return [];
  const supabase = await createClient();
  let q = supabase.from("daily_reports")
    .select("id, user_id, report_date, update_text, issues, next_task_text, remarks, locked, author:profiles!daily_reports_user_id_fkey(full_name), next_task:tasks!daily_reports_next_task_id_fkey(code, title), daily_report_items(task_id, task_code, task_title, status_after, progress_after, created_at, parent:tasks!daily_report_items_parent_task_id_fkey(code, title)), daily_report_attachments!daily_report_attachments_report_id_fkey(id, task_id, file_name, mime_type, storage_path, uploaded_at)")
    .eq("project_id", project.id).gte("report_date", from).lte("report_date", opts.to).order("submitted_at");
  if (opts.user) q = q.eq("user_id", opts.user.id);
  const { data } = await q;
  // task-row files get a signed link for their thumbnail (read with the viewer's own access, like the gallery)
  const taskFiles = (data ?? []).flatMap((r) => (r.daily_report_attachments ?? []).filter((a) => a.task_id));
  const urls = await signedUrls(supabase, taskFiles.map((a) => a.storage_path));
  const filesOf = (r: NonNullable<typeof data>[number], taskId: string): TaskFile[] => (r.daily_report_attachments ?? [])
    .filter((a) => a.task_id === taskId).sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .map((a) => ({ id: a.id, name: a.file_name, mime: a.mime_type, url: urls[a.storage_path] ?? null }));
  const byDate = new Map<string, NonNullable<typeof data>>();
  (data ?? []).forEach((r) => byDate.set(r.report_date, [...(byDate.get(r.report_date) ?? []), r]));
  const dates = dateRange(from, opts.to);
  if (opts.order === "desc") dates.reverse();
  return dates.flatMap((date): DailyRow[] => {
    const base = { date, dayNo: projectDayNumber(start, date), offDay: isOffDay(date, opts.workdays) };
    const reports = byDate.get(date) ?? [];
    if (!reports.length) {
      return [{ ...base, key: date, reportId: null, userId: null, locked: false, edit: null, mainTask: [], dailySubTask: "", assignedTo: opts.user?.name ?? "", issues: "", nextTask: "", remarks: "" }];
    }
    return reports.map((r) => {
      const items = [...(r.daily_report_items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return {
      ...base, key: r.id, reportId: r.id, userId: r.user_id, locked: r.locked,
      edit: { taskId: items[0]?.task_id ?? null, status: items[0]?.status_after ?? null, progress: items[0]?.progress_after ?? null, nextTask: r.next_task_text ?? "" },
      mainTask: items.map((i) => ({
        ...(i.parent
          ? { label: taskLabel(i.parent.code, i.parent.title), sub: `${letterOf(i.task_code)}. ${i.task_title}`, status: i.status_after }
          : { label: taskLabel(i.task_code, i.task_title), sub: null, status: i.status_after }),
        taskId: i.task_id, files: filesOf(r, i.task_id),
      })),
      fileCount: (r.daily_report_attachments ?? []).length,
      dailySubTask: r.update_text,
      assignedTo: r.author?.full_name ?? "",
      issues: r.issues ?? "",
      nextTask: r.next_task ? taskLabel(r.next_task.code, r.next_task.title) : r.next_task_text ?? "",
      remarks: r.remarks ?? "",
      };
    });
  });
}
