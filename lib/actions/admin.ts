"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { callEdge } from "@/lib/edge";
import { type ActionResult, fail } from "@/lib/errors";
import { firstIssue, inviteInput, setPasswordInput, settingsInput, type InviteInput, type SetPasswordInput } from "@/lib/validation";
import type { Enums, TablesUpdate } from "@/types/database";

const refresh = () => revalidatePath("/", "layout");

/**
 * Creates the account through the auth-admin Edge Function (role and department go in app metadata; the
 * on_auth_user_created trigger builds the profile). The admin's password goes only to Supabase Auth; it is
 * never returned, logged or stored. The user must choose their own password at first sign-in.
 */
export async function inviteUser(input: InviteInput): Promise<ActionResult<{ loginName: string }>> {
  const p = inviteInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const { confirm_password: _confirm, ...account } = p.data;
  const r = await callEdge<{ login_name?: string }>("auth-admin", { action: "invite", ...account, must_change_password: true });
  if (!r.ok) return { ok: false, message: r.message };
  refresh();
  const loginName = r.data.login_name ?? account.login_name;
  return { ok: true, message: `User created successfully. ${account.full_name} signs in with ${account.email}.`, data: { loginName } };
}

/**
 * Admin: set ANOTHER user's password. It goes only to Supabase Auth, through the auth-admin Edge Function
 * (service-role Admin Auth API, server side) — never client-side updateUser(), which would change the admin's
 * own password. The admin's password and session are untouched; the password is never returned, logged or stored.
 */
export async function setUserPassword(input: SetPasswordInput): Promise<ActionResult> {
  const p = setPasswordInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Sign in again to continue." };
  if (auth.user.id === p.data.user_id) return { ok: false, message: "Change your own password in Settings." };
  const r = await callEdge("auth-admin", { action: "set_password", user_id: p.data.user_id, password: p.data.password });
  return r.ok ? { ok: true, message: "Password changed. Share it with them privately." } : { ok: false, message: r.message };
}

export async function sendResetLink(userId: string): Promise<ActionResult> {
  const r = await callEdge("auth-admin", { action: "reset_link", user_id: userId, redirect_to: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password` });
  return r.ok ? { ok: true, message: "Reset link sent" } : { ok: false, message: r.message };
}

export async function updateUser(userId: string, patch: {
  full_name?: string; login_name?: string; role?: Enums<"user_role">; department_id?: string | null; active?: boolean; must_change_password?: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(patch as TablesUpdate<"profiles">).eq("id", userId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "User saved" };
}

export async function saveDepartment(input: { id?: string; name: string; sort_order: number; active: boolean }): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Add a department name" };
  const supabase = await createClient();
  const { error } = input.id
    ? await supabase.from("departments").update({ name, sort_order: input.sort_order, active: input.active }).eq("id", input.id)
    : await supabase.from("departments").insert({ name, sort_order: input.sort_order, active: input.active });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Department saved" };
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("departments").delete().eq("id", id);
  if (error) return error.code === "23503" ? { ok: false, message: "Projects still belong to this department. Deactivate it instead." } : fail(error);
  refresh();
  return { ok: true, message: "Department deleted" };
}

export async function setDepartmentHead(departmentId: string, userId: string, add: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = add
    ? await supabase.from("department_heads").insert({ department_id: departmentId, user_id: userId })
    : await supabase.from("department_heads").delete().eq("department_id", departmentId).eq("user_id", userId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: add ? "Head assigned" : "Head removed" };
}

export async function updateSettings(input: unknown): Promise<ActionResult> {
  const p = settingsInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const { score_weight_on_time, ...rest } = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("workspace_settings").update({
    ...rest, score_weight_on_time, score_weight_clean: Math.round((1 - score_weight_on_time) * 100) / 100,
  }).eq("id", 1);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Rules saved. Open task deadlines were recalculated." };
}

export async function runJob(job: "red-mark-scan" | "deadline-scan" | "lock-and-purge"): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_run_job", { p_job: job });
  if (error) return fail(error);
  refresh();
  const d = (data ?? {}) as { error?: string | null };
  return d.error ? { ok: false, message: `The job ran with an error: ${d.error}` } : { ok: true, message: "Job finished" };
}
