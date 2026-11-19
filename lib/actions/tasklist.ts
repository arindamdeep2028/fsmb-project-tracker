"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { getSession } from "@/lib/auth/session";
import type { TablesUpdate } from "@/types/database";
import {
  firstIssue, tasklistAddRows, tasklistAssignee, tasklistComment, tasklistRowAssignee, tasklistRowPatch, tasklistTaskCategory, tasklistTaskPatch,
  type TasklistRowPatch, type TasklistTaskPatch,
} from "@/lib/validation";

/**
 * Tasklist cells (migrations 27 and 28). Who may change what is decided by the database: every current member of
 * the project and its managers (PM, Department Head, Admin), while the project is not archived, add and remove
 * extra assigned people (RLS on task_assignees; current members only, the owner never twice), write the Comments
 * cell (RLS on task_list_comments), change a task's name, status and priority (tasklist_update_task), and add and
 * fill in Tasklist rows (tasklist_rows, tasklist_row_assignees).
 */
const refresh = (projectId?: string) => revalidatePath(projectId ? `/projects/${projectId}/tasklist` : "/", projectId ? "page" : "layout");

/**
 * When a change was saved (server clock, after the database answered): the Tasklist shows it until it receives page
 * data loaded after this moment, so a refresh that started before the save cannot put the old value back.
 */
const savedAt = () => new Date().toISOString();

async function signedIn() {
  const s = await getSession();
  return s && s.profile.active ? s : null;
}

export async function addTaskAssignee(input: { task_id: string; user_id: string; project_id?: string }): Promise<ActionResult> {
  const p = tasklistAssignee.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error } = await supabase.from("task_assignees").insert({ task_id: p.data.task_id, user_id: p.data.user_id });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "This person is already assigned to the task." };
    return fail(error);
  }
  refresh(input.project_id);
  return { ok: true, message: "Person added", data: { at: savedAt() } };
}

export async function removeTaskAssignee(input: { task_id: string; user_id: string; project_id?: string }): Promise<ActionResult> {
  const p = tasklistAssignee.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("task_assignees").delete({ count: "exact" }).eq("task_id", p.data.task_id).eq("user_id", p.data.user_id);
  if (error) return fail(error);
  if (!count) return { ok: false, message: "You don't have permission to do that." };
  refresh(input.project_id);
  return { ok: true, message: "Person removed", data: { at: savedAt() } };
}

export async function saveTasklistComment(input: { task_id: string; body: string; project_id?: string }): Promise<ActionResult> {
  const p = tasklistComment.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const body = p.data.body.trim();
  // update the comment if the task has one, else add it (only `body` may be updated: no upsert, which also writes task_id)
  const upd = await supabase.from("task_list_comments").update({ body }).eq("task_id", p.data.task_id).select("task_id");
  if (upd.error) return fail(upd.error);
  if (!upd.data?.length) {
    const ins = await supabase.from("task_list_comments").insert({ task_id: p.data.task_id, body }).select("task_id");
    if (ins.error) return ins.error.code === "23505" ? { ok: false, message: "You don't have permission to do that." } : fail(ins.error);
    if (!ins.data?.length) return { ok: false, message: "You don't have permission to do that." };
  }
  refresh(input.project_id);
  return { ok: true, message: "Comment saved", data: { at: savedAt() } };
}

/* ---------------------------------------------------------------- migration 28: every member edits the Tasklist */

/** The database's own sentence for a rule an engineer meets on the Tasklist; other refusals get the usual message. */
function tasklistFail(error: { code?: string; message?: string }) {
  if (error.code === "42501" && /^Only a manager can complete/.test(error.message ?? "")) return { ok: false as const, message: error.message! };
  return fail(error);
}

/** Add 1–50 blank rows at the end of the Tasklist (under a phase, or General tasks). Any member of the project. */
export async function addTasklistRows(input: { project_id: string; count: number | string; phase_id: string | null; category?: "General" | "Urgent" }): Promise<ActionResult<{ ids: string[]; at: string }>> {
  const p = tasklistAddRows.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tasklist_add_rows", { p_project: p.data.project_id, p_count: p.data.count, p_phase: p.data.phase_id, p_category: p.data.category });
  if (error) return tasklistFail(error);
  refresh(p.data.project_id);
  const n = p.data.count;
  return { ok: true, message: `${n} ${n === 1 ? "row" : "rows"} added`, data: { ids: (data ?? []) as string[], at: savedAt() } };
}

/** Name, status or priority of an existing task, from the Tasklist. Any member of the project (tasklist_update_task). */
export async function updateTasklistTask(input: { task_id: string; project_id?: string; patch: TasklistTaskPatch }): Promise<ActionResult> {
  const p = tasklistTaskPatch.safeParse(input.patch);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!/^[0-9a-f-]{36}$/i.test(input.task_id)) return { ok: false, message: "Not found" };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined));
  const supabase = await createClient();
  const { error } = await supabase.rpc("tasklist_update_task", { p_task: input.task_id, p: patch });
  if (error) return tasklistFail(error);
  refresh(input.project_id);
  return { ok: true, message: "Saved", data: { at: savedAt() } };
}

/**
 * The Deadline of an existing task, from the Tasklist: any member of the project (tasklist_set_deadline, migration
 * 32). The same stored deadline as End Date in Responsibilities: the office closing time of that Dhaka day.
 */
export async function setTasklistDeadline(input: { task_id: string; day: string; project_id?: string }): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { ok: false, message: "Choose a date" };
  if (!/^[0-9a-f-]{36}$/i.test(input.task_id)) return { ok: false, message: "Not found" };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("tasklist_set_deadline", { p_task: input.task_id, p_day: input.day });
  if (error) return tasklistFail(error);
  refresh(input.project_id);
  return { ok: true, message: "Deadline saved", data: { at: savedAt() } };
}

/** A Tasklist row's cells (name, status, priority, comment, phase). Any member of the project (RLS on tasklist_rows). */
export async function updateTasklistRow(input: { row_id: string; project_id?: string; patch: TasklistRowPatch }): Promise<ActionResult> {
  const p = tasklistRowPatch.safeParse(input.patch);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!/^[0-9a-f-]{36}$/i.test(input.row_id)) return { ok: false, message: "Not found" };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined));
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasklist_rows").update(patch as TablesUpdate<"tasklist_rows">).eq("id", input.row_id).select("id");
  if (error) return tasklistFail(error);
  if (!data?.length) {
    // nothing written: either nothing changed (the database skips that) or the user may not change the row
    const { data: row } = await supabase.from("tasklist_rows").select("*").eq("id", input.row_id).maybeSingle();
    const same = row && Object.entries(patch).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
    if (!same) return { ok: false, message: "You don't have permission to do that." };
  }
  refresh(input.project_id);
  return { ok: true, message: "Saved", data: { at: savedAt() } };
}

/** Remove a row that was never filled in (no name, comment, people or edits); the database refuses any other. */
export async function removeTasklistRow(input: { row_id: string; project_id?: string }): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(input.row_id)) return { ok: false, message: "Not found" };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("tasklist_rows").delete({ count: "exact" }).eq("id", input.row_id);
  if (error) return tasklistFail(error);
  if (!count) return { ok: false, message: "Only a row that was never filled in can be removed." };
  refresh(input.project_id);
  return { ok: true, message: "Row removed", data: { at: savedAt() } };
}

export async function addTasklistRowAssignee(input: { row_id: string; user_id: string; project_id?: string }): Promise<ActionResult> {
  const p = tasklistRowAssignee.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error } = await supabase.from("tasklist_row_assignees").insert({ row_id: p.data.row_id, user_id: p.data.user_id });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "This person is already on the row." };
    return tasklistFail(error);
  }
  refresh(input.project_id);
  return { ok: true, message: "Person added", data: { at: savedAt() } };
}

export async function removeTasklistRowAssignee(input: { row_id: string; user_id: string; project_id?: string }): Promise<ActionResult> {
  const p = tasklistRowAssignee.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("tasklist_row_assignees").delete({ count: "exact" }).eq("row_id", p.data.row_id).eq("user_id", p.data.user_id);
  if (error) return tasklistFail(error);
  if (!count) return { ok: false, message: "You don't have permission to do that." };
  refresh(input.project_id);
  return { ok: true, message: "Person removed", data: { at: savedAt() } };
}

/** General Task / Urgent Task of an existing task (task_list_categories; no row = General). Any member of the project. */
export async function saveTasklistCategory(input: { task_id: string; category: "General" | "Urgent"; project_id?: string }): Promise<ActionResult> {
  const p = tasklistTaskCategory.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  if (!(await signedIn())) return { ok: false, message: "Sign in again to save." };
  const supabase = await createClient();
  // update if the task has a category row, else add one (only `category` may be updated: no upsert)
  const upd = await supabase.from("task_list_categories").update({ category: p.data.category }).eq("task_id", p.data.task_id).select("task_id");
  if (upd.error) return tasklistFail(upd.error);
  if (!upd.data?.length) {
    const ins = await supabase.from("task_list_categories").insert({ task_id: p.data.task_id, category: p.data.category }).select("task_id");
    if (ins.error) return ins.error.code === "23505" ? { ok: false, message: "You don't have permission to do that." } : tasklistFail(ins.error);
    if (!ins.data?.length) return { ok: false, message: "You don't have permission to do that." };
  }
  refresh(input.project_id);
  return { ok: true, message: "Category saved", data: { at: savedAt() } };
}
