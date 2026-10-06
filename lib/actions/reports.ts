"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { ALLOWED_TYPES, BUCKET, MAX_BYTES } from "@/lib/storage";
import { dailyRowInput, firstIssue, reportInput, type DailyRowInput, type ReportInput } from "@/lib/validation";
import { dhakaToday } from "@/lib/time";
import { getSession } from "@/lib/auth/session";
import { projectStart } from "@/lib/data/reports";
import type { Json } from "@/types/database";

const refresh = () => revalidatePath("/", "layout");

/**
 * One report per user, project and day; items update the listed tasks as the author (save_daily_report).
 * Task entries the report already has stay unless they are named in remove_task_ids. The project is checked
 * here against the caller's live memberships, and again by RLS and the report trigger.
 */
export async function saveReport(input: ReportInput): Promise<ActionResult<{ id: string }>> {
  const p = reportInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const v = p.data;
  const s = await getSession();
  if (!s || !s.profile.active) return { ok: false, message: "Sign in again to save." };
  if (!s.isAdmin && !s.memberProjectIds.includes(v.project_id)) return { ok: false, message: "You can only report on projects where you are a member." };
  const supabase = await createClient();
  const payload = {
    project_id: v.project_id, update_text: v.update_text, issues: v.issues || null,
    next_task_id: v.next_task_id || null, next_task_text: v.next_task_text || null, remarks: v.remarks || null,
    items: v.items.map((i) => ({ task_id: i.task_id, progress_after: i.progress_after ?? null, status_after: i.status_after ?? null, note: i.note || null })),
    remove_task_ids: v.remove_task_ids,
  };
  const { data, error } = await supabase.rpc("save_daily_report", { p: payload as unknown as Json });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Report saved", data: { id: data } };
}

/**
 * Adds or edits one row of the Daily Reports sheet from the Daily reports tab (one row per person, project and day).
 * Your own row for today goes through save_daily_report, exactly like the update form. A row for another person
 * or an earlier date (an overdue report) is for an Admin only: checked here, and again by RLS and the report
 * triggers, so every other user stays limited to their own row for today. A new row is inserted, never upserted:
 * if that person already has a report for that project and date it is left as it is. The Admin row is written by
 * save_daily_row in one transaction, so a refused task entry leaves nothing half-saved; existing task entries
 * stay unless named in remove_task_ids.
 */
export async function saveDailyRow(input: DailyRowInput): Promise<ActionResult<{ id: string }>> {
  const p = dailyRowInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const v = p.data;
  const s = await getSession();
  if (!s || !s.profile.active) return { ok: false, message: "Sign in again to save." };
  const today = dhakaToday();
  const item = v.task_id ? { task_id: v.task_id, status_after: v.status, progress_after: v.progress, note: null } : null;

  if (v.report_date > today) return { ok: false, message: "A daily report can't be dated after today." };
  if (v.user_id === s.userId && v.report_date === today) {
    return saveReport({
      project_id: v.project_id, update_text: v.update_text, issues: v.issues, next_task_id: null,
      next_task_text: v.next_task_text, remarks: v.remarks, items: item ? [item] : [], remove_task_ids: v.remove_task_ids,
    });
  }
  if (!s.isAdmin) return { ok: false, message: "Only an Admin can add or change a daily report for an earlier date or for another person." };

  const supabase = await createClient();
  if (!v.report_id) {
    const [{ data: project }, { data: member }] = await Promise.all([
      supabase.from("projects").select("id, start_date, created_at").eq("id", v.project_id).maybeSingle(),
      supabase.from("project_members").select("user_id").eq("project_id", v.project_id).eq("user_id", v.user_id).is("removed_at", null).maybeSingle(),
    ]);
    if (!project) return { ok: false, message: "Not found, or you no longer have access to it." };
    if (!member) return { ok: false, message: "Choose a current member of this project." };
    if (v.report_date < projectStart(project)) return { ok: false, message: "That date is before the project's Day 1." };
  }
  const payload = {
    report_id: v.report_id ?? null, user_id: v.user_id, project_id: v.project_id, report_date: v.report_date,
    update_text: v.update_text, issues: v.issues || null, next_task_text: v.next_task_text || null, remarks: v.remarks || null,
    item: item ? { task_id: item.task_id, status_after: item.status_after, progress_after: item.progress_after } : null,
    remove_task_ids: v.remove_task_ids,
  };
  const { data: id, error } = await supabase.rpc("save_daily_row", { p: payload as unknown as Json });
  if (error) {
    return error.code === "23505"
      ? { ok: false, message: "A daily report is already saved for this person, project and date. It was not changed; open that row to edit it." }
      : fail(error);
  }
  const report = { id };
  refresh();
  return { ok: true, message: "Daily update saved", data: { id: report.id } };
}

export async function recordAttachment(input: { report_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number }): Promise<ActionResult> {
  if (!(ALLOWED_TYPES as readonly string[]).includes(input.mime_type)) return { ok: false, message: "That file type isn't allowed" };
  if (input.size_bytes > MAX_BYTES) return { ok: false, message: "Files are limited to 10 MB" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("daily_report_attachments").insert({ ...input, uploaded_by: auth.user!.id });
  if (error) return fail(error);
  refresh();
  return { ok: true };
}

/** Author while the report is open; PM, Department Head or Admin of the project at any time. */
export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row } = await supabase.from("daily_report_attachments").select("storage_path").eq("id", attachmentId).maybeSingle();
  if (!row) return { ok: false, message: "Not found, or you no longer have access to it." };
  const { error: sErr } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (sErr) return { ok: false, message: "You don't have permission to do that." };
  const { error } = await supabase.from("daily_report_attachments").delete().eq("id", attachmentId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "File removed" };
}

/** Admin: lock or unlock a report. */
export async function setReportLock(reportId: string, locked: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("daily_reports").update({ locked }).eq("id", reportId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: locked ? "Report locked" : "Report unlocked" };
}

/** Admin: delete a report, its items, attachment rows and stored files. */
export async function deleteReport(reportId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: files } = await supabase.from("daily_report_attachments").select("storage_path").eq("report_id", reportId);
  if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => f.storage_path));
  const { error, count } = await supabase.from("daily_reports").delete({ count: "exact" }).eq("id", reportId);
  if (error) return fail(error);
  if (!count) return { ok: false, message: "You don't have permission to do that." };
  refresh();
  return { ok: true, message: "Report deleted" };
}
