import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/time";
import type { AdminDashboard, DepartmentDashboard, MyDashboard, MyProjectsDashboard } from "@/types/domain";

export const getMyDashboard = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_dashboard");
  if (error) throw error;
  return data as unknown as MyDashboard;
});

export const getMyProjectsDashboard = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_projects_dashboard");
  if (error) throw error;
  return data as unknown as MyProjectsDashboard;
});

export async function getDepartmentDashboard(dept?: string, from?: string, to?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("department_dashboard", {
    ...(dept ? { p_department: dept } : {}), ...(from ? { p_from: from } : {}), ...(to ? { p_to: to } : {}),
  });
  if (error) return { error };
  return { data: data as unknown as DepartmentDashboard };
}

export const getAdminDashboard = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dashboard");
  if (error) throw error;
  return data as unknown as AdminDashboard;
});

/**
 * Engineer dashboard panels (read-only, the viewer's own access): the status of every work item in the given
 * projects — subtasks and tasks without subtasks, so a task is never counted twice with its own subtasks — and
 * the Dhaka dates on which the person's tasks there were completed since `from`.
 */
export async function getEngineerStatusData(userId: string, projectIds: string[], from: string) {
  if (!projectIds.length) return { itemStatuses: [] as string[], completedDates: [] as string[] };
  const supabase = await createClient();
  const [tasks, rollup, done] = await Promise.all([
    supabase.from("tasks").select("id, status").in("project_id", projectIds).eq("archived", false),
    supabase.from("task_rollup").select("task_id, is_leaf").in("project_id", projectIds),
    supabase.from("tasks").select("completed_on").in("project_id", projectIds).eq("archived", false)
      .eq("assigned_to", userId).eq("status", "Completed").gte("completed_on", `${from}T00:00:00+06:00`),
  ]);
  const leaf = new Map((rollup.data ?? []).map((r) => [r.task_id, r.is_leaf]));
  return {
    itemStatuses: (tasks.data ?? []).filter((t) => leaf.get(t.id) ?? true).map((t) => t.status as string),
    completedDates: (done.data ?? []).map((t) => (t.completed_on ? fmt(t.completed_on, "yyyy-MM-dd") : "")).filter(Boolean),
  };
}

/**
 * Admin dashboard donut (read-only, the viewer's own access): the stored status of every work item in the given
 * projects — subtasks and tasks without subtasks, so a task is never counted twice with its own subtasks.
 */
export async function getWorkItemStatuses(projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  const supabase = await createClient();
  const [tasks, rollup] = await Promise.all([
    supabase.from("tasks").select("id, status").in("project_id", projectIds).eq("archived", false),
    supabase.from("task_rollup").select("task_id, is_leaf").in("project_id", projectIds),
  ]);
  const leaf = new Map((rollup.data ?? []).map((r) => [r.task_id, r.is_leaf]));
  return (tasks.data ?? []).filter((t) => leaf.get(t.id) ?? true).map((t) => t.status as string);
}
