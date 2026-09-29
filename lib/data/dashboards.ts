import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
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
