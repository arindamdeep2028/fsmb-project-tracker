import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Member } from "@/types/domain";

export const listProjects = cache(async () => {
  const supabase = await createClient();
  const [projects, managed, engineer] = await Promise.all([
    supabase.from("projects").select("*, department:departments(name), pm:profiles!projects_pm_id_fkey(full_name)")
      .eq("archived", false).order("code"),
    supabase.from("v_pm_projects").select("project_id, completion_pct, planned_pct, at_risk, red_tasks, overdue_tasks"),
    supabase.from("v_engineer_project_progress").select("project_id, project_completion_pct"),
  ]);
  if (projects.error) throw projects.error;
  const completion = new Map<string, { completion: number | null; planned?: number | null; atRisk?: boolean | null; red?: number | null }>();
  (engineer.data ?? []).forEach((r) => r.project_id && completion.set(r.project_id, { completion: r.project_completion_pct }));
  (managed.data ?? []).forEach((r) => r.project_id && completion.set(r.project_id, {
    completion: r.completion_pct, planned: r.planned_pct, atRisk: r.at_risk, red: r.red_tasks,
  }));
  return (projects.data ?? []).map((p) => ({ ...p, metrics: completion.get(p.id) ?? null }));
});

export const getProject = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("projects")
    .select("*, department:departments(id, name), pm:profiles!projects_pm_id_fkey(id, full_name)")
    .eq("id", id).maybeSingle();
  return data;
});

export const getProjectProgress = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_progress", { p_project: id });
  return (data ?? null) as null | { completion_pct: number; planned_pct: number | null; members: number; tasks_total: number; completed_tasks: number; open_tasks: number };
});

export const getMembers = cache(async (projectId: string, includeRemoved = false): Promise<Member[]> => {
  const supabase = await createClient();
  let q = supabase.from("project_members")
    .select("user_id, member_role, removed_at, profile:profiles!project_members_user_id_fkey(full_name, role)")
    .eq("project_id", projectId);
  if (!includeRemoved) q = q.is("removed_at", null);
  const { data } = await q;
  return (data ?? []).map((m) => ({
    user_id: m.user_id, member_role: m.member_role, removed_at: m.removed_at,
    full_name: m.profile?.full_name ?? "—", role: m.profile?.role ?? "engineer",
  })).sort((a, b) => (a.member_role === b.member_role ? a.full_name.localeCompare(b.full_name) : a.member_role === "pm" ? -1 : 1));
});

export async function getProjectEngineers(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_engineers", { p_project: projectId });
  return data ?? [];
}

export async function getDepartments() {
  const supabase = await createClient();
  const { data } = await supabase.from("departments").select("*").order("sort_order").order("name");
  return data ?? [];
}

export async function getAssignableUsers(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("assignable_users", { p_project: projectId });
  return data ?? [];
}

/** People who can be a project PM (role pm, dept_head or admin), for project forms. */
export async function getPmCandidates() {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, role").eq("active", true)
    .in("role", ["pm", "dept_head", "admin"]).order("full_name");
  return data ?? [];
}
