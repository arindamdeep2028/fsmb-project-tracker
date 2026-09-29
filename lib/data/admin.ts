import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export async function listUsers() {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*, department:departments(name)").order("full_name");
  return data ?? [];
}

export async function listDepartmentsWithHeads() {
  const supabase = await createClient();
  const [departments, heads, people] = await Promise.all([
    supabase.from("departments").select("*").order("sort_order").order("name"),
    supabase.from("department_heads").select("department_id, user_id, head:profiles!department_heads_user_id_fkey(full_name)"),
    supabase.from("profiles").select("id, full_name, role").eq("active", true).in("role", ["dept_head", "admin"]).order("full_name"),
  ]);
  return { departments: departments.data ?? [], heads: heads.data ?? [], candidates: people.data ?? [] };
}

export async function getSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("workspace_settings").select("*").eq("id", 1).single();
  return data;
}

export async function listJobRuns(limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase.from("scan_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return data ?? [];
}

export type LogFilters = { project?: string; person?: string; action?: Enums<"log_action">; from?: string; to?: string; page?: number };

/** Activity log; RLS limits rows (Admin all, managers their projects' rows, everyone their own). */
export async function listActivity(f: LogFilters = {}, only?: { projectId?: string; userId?: string }) {
  const supabase = await createClient();
  const page = f.page ?? 0;
  let q = supabase.from("activity_log").select("*").order("ts", { ascending: false }).range(page * 50, page * 50 + 49);
  if (only?.projectId) q = q.eq("project_id", only.projectId);
  if (only?.userId) q = q.or(`subject_user_id.eq.${only.userId},actor_user_id.eq.${only.userId}`);
  if (f.person) q = q.eq("subject_user_id", f.person);
  if (f.action) q = q.eq("action", f.action);
  if (f.from) q = q.gte("log_date", f.from);
  if (f.to) q = q.lte("log_date", f.to);
  if (f.project) q = q.eq("project_code", f.project);
  const { data } = await q;
  return data ?? [];
}

export async function listDemoProjects() {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, code, name, archived").eq("is_demo", true).order("code");
  return data ?? [];
}
