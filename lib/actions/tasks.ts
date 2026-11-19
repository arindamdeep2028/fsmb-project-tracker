"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { fromLocalInput } from "@/lib/time";
import { cellPatch, firstIssue, taskCreate, taskPatch, taskStatus, type CellPatch, type TaskCreate, type TaskPatch } from "@/lib/validation";
import type { TablesInsert, TablesUpdate } from "@/types/database";

const refresh = () => revalidatePath("/", "layout");

export async function createTask(input: TaskCreate): Promise<ActionResult<{ id: string; code: string }>> {
  const p = taskCreate.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const v = p.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // code, created_by, assigned_on and deadlines are filled by tasks_before_write; code null = "generate".
  const row = {
    project_id: v.project_id, parent_id: v.parent_id ?? null, title: v.title, description: v.description,
    priority: v.priority, assigned_to: v.assigned_to, contribution_pct: v.contribution_pct ?? null,
    assigned_by: auth.user!.id, created_by: auth.user!.id, code: null,
    ...(v.planned_due_local ? { planned_due_at: fromLocalInput(v.planned_due_local) } : {}),
    ...(v.contribution_locked !== undefined ? { contribution_locked: v.contribution_locked } : {}),
  } as unknown as TablesInsert<"tasks">;
  const { data, error } = await supabase.from("tasks").insert(row).select("id, code").single();
  if (error) return fail(error);
  refresh();
  return { ok: true, message: `Created ${data.code}`, data };
}

export async function updateTask(taskId: string, input: TaskPatch): Promise<ActionResult> {
  const p = taskPatch.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const { planned_due_local, ...rest } = p.data;
  const patch: TablesUpdate<"tasks"> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  if (planned_due_local !== undefined) patch.planned_due_at = planned_due_local ? fromLocalInput(planned_due_local) : null;
  if (Object.keys(patch).length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Saved" };
}

/**
 * A status change from a Status dropdown (or Mark Done). Managers set any status on any task of their projects; an
 * engineer member any status on their OWN tasks (assigned to them or created by them), reopening a Completed task
 * included: member_update_task (migration 32) checks that and the task triggers apply the rest (completion time,
 * 100% on Completed, activity log, notifications); completing a task with open subtasks stays a manager's call.
 * Someone no longer a member of the project keeps the plain table update and its rules (forward moves on a task
 * still assigned to them).
 */
async function changeStatus(taskId: string, status: string) {
  const supabase = await createClient();
  const r = await supabase.rpc("member_update_task", { p_task: taskId, p: { status } });
  if (r.error?.message?.startsWith("Only members of this project")) {
    return supabase.from("tasks").update({ status: status as TablesUpdate<"tasks">["status"] }).eq("id", taskId);
  }
  return r;
}

/**
 * A cell of an existing Responsibilities row: name, Remarks, Assign To, Priority or Progress. Admin, PM and
 * Department Head may change every cell; an engineer member every cell but End Date, on any task of the project.
 * member_update_task (migration 32) checks that again and the task triggers log the change.
 */
export async function saveCell(taskId: string, input: CellPatch): Promise<ActionResult> {
  const p = cellPatch.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  // only the cells sent; a cleared Remarks (null) goes as "" and is stored as empty
  const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v ?? ""]));
  if (Object.keys(patch).length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.rpc("member_update_task", { p_task: taskId, p: patch });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Saved" };
}

export async function setStatus(taskId: string, status: string): Promise<ActionResult> {
  const s = taskStatus.safeParse(status);
  if (!s.success) return { ok: false, message: "Unknown status" };
  if (s.data === "Completed") return completeTask(taskId);
  const { error } = await changeStatus(taskId, s.data);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: `Status: ${s.data}` };
}

export async function setProgress(taskId: string, value: number): Promise<ActionResult> {
  if (!(value >= 0 && value <= 100)) return { ok: false, message: "Progress is 0 to 100" };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ progress_pct: value }).eq("id", taskId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: `Progress ${value}%` };
}

/** Submit the execution plan: Not started → Plan submitted; later statuses just stamp the plan time. */
export async function submitPlan(taskId: string, currentStatus: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = currentStatus === "Not started"
    ? await supabase.from("tasks").update({ status: "Plan submitted" }).eq("id", taskId)
    : await supabase.from("tasks").update({ plan_submitted_at: new Date().toISOString() }).eq("id", taskId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Plan submitted" };
}

export async function completeTask(taskId: string): Promise<ActionResult<{ parentId: string | null }>> {
  const { error } = await changeStatus(taskId, "Completed");
  if (error) return fail(error);
  const supabase = await createClient();
  const { data } = await supabase.from("tasks").select("code, parent_id").eq("id", taskId).maybeSingle();
  refresh();
  return { ok: true, message: `${data?.code ?? "Task"} completed`, data: { parentId: data?.parent_id ?? null } };
}

export async function setDeadline(taskId: string, local: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = local
    ? await supabase.rpc("set_task_deadline", { p_task: taskId, p_due: fromLocalInput(local) })
    : await supabase.from("tasks").update({ planned_due_at: null }).eq("id", taskId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: local ? "Deadline set" : "Deadline cleared" };
}

/**
 * The End Date / Deadline cell (Responsibilities and Tasklist): the task's deadline becomes the office closing
 * time of that Dhaka day. Project PM, Department Head or Admin only; set_task_end_date checks it again and the
 * task triggers write the change to the activity log.
 */
export async function setEndDate(taskId: string, day: string): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Choose a date" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_end_date", { p_task: taskId, p_day: day });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "End date saved" };
}

export async function grantExtension(taskId: string, local: string, reason: string): Promise<ActionResult> {
  if (!local) return { ok: false, message: "Choose the new deadline" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_extension", { p_task: taskId, p_new_deadline: fromLocalInput(local), p_reason: reason || undefined });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Extension granted" };
}

export async function setArchived(taskId: string, archived: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ archived }).eq("id", taskId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: archived ? "Archived" : "Restored" };
}

/** Admin only (migration 19); refused with 23503 when the task has daily-report history. */
export async function deleteTask(taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("tasks").delete({ count: "exact" }).eq("id", taskId);
  if (error) return fail(error);
  if (!count) return { ok: false, message: "You don't have permission to do that." };
  refresh();
  return { ok: true, message: "Task deleted" };
}

export async function addComment(taskId: string, body: string, parentCommentId?: string): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { ok: false, message: "Write a comment first" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("task_comments").insert({
    task_id: taskId, body: text.slice(0, 4000), author_id: auth.user!.id, parent_comment_id: parentCommentId ?? null,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Comment posted" };
}

export async function editComment(commentId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").update({ body: body.trim().slice(0, 4000) }).eq("id", commentId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Comment updated" };
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Comment deleted" };
}
