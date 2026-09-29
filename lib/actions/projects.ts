"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { firstIssue, projectInput, type ProjectInput } from "@/lib/validation";
import type { Enums, TablesInsert, TablesUpdate } from "@/types/database";

const refresh = () => revalidatePath("/", "layout");

export async function createProject(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  const p = projectInput.safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").insert(p.data as TablesInsert<"projects">).select("id").single();
  if (error) return fail(error);
  refresh();
  return { ok: true, message: `Project ${p.data.code} created`, data };
}

/** PMs may change details only; code, department, lead PM and archive need a Department Head or Admin (trigger). */
export async function updateProject(projectId: string, input: Partial<ProjectInput>): Promise<ActionResult> {
  const p = projectInput.partial().safeParse(input);
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined)) as TablesUpdate<"projects">;
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Project saved" };
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ archived }).eq("id", projectId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: archived ? "Project archived" : "Project restored" };
}

/** Admin only; refused with 23503 while the project has daily reports (archive instead). */
export async function deleteProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("projects").delete({ count: "exact" }).eq("id", projectId);
  if (error) return fail(error);
  if (!count) return { ok: false, message: "You don't have permission to do that." };
  refresh();
  return { ok: true, message: "Project deleted" };
}

export async function addMember(projectId: string, userId: string, role: Enums<"project_member_role">): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("project_members")
    .upsert({ project_id: projectId, user_id: userId, member_role: role, removed_at: null }, { onConflict: "project_id,user_id" });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Member added" };
}

export async function removeMember(projectId: string, userId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("project_members").update({ removed_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("user_id", userId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Member removed" };
}

export async function changeMemberRole(projectId: string, userId: string, role: Enums<"project_member_role">): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("project_members").update({ member_role: role }).eq("project_id", projectId).eq("user_id", userId);
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Project role changed" };
}
