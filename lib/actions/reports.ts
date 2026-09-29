"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { ALLOWED_TYPES, BUCKET, MAX_BYTES } from "@/lib/storage";
import { firstIssue, reportInput, type ReportInput } from "@/lib/validation";
import type { Json } from "@/types/database";

const refresh = () => revalidatePath("/", "layout");

/** One report per user, project and day; items update the listed tasks as the author (save_daily_report). */
export async function saveReport(input: ReportInput): Promise<ActionResult<{ id: string }>> {
  const p = reportInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const v = p.data;
  const supabase = await createClient();
  const payload = {
    project_id: v.project_id, update_text: v.update_text, issues: v.issues || null,
    next_task_id: v.next_task_id || null, next_task_text: v.next_task_text || null, remarks: v.remarks || null,
    items: v.items.map((i) => ({ task_id: i.task_id, progress_after: i.progress_after ?? null, status_after: i.status_after ?? null, note: i.note || null })),
  };
  const { data, error } = await supabase.rpc("save_daily_report", { p: payload as unknown as Json });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Report saved", data: { id: data } };
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
