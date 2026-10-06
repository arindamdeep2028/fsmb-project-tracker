import "server-only";
import { addDays, format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { projectStart } from "@/lib/data/reports";
import { overdueReports, overdueWindowStart, type OverdueItem } from "@/lib/overdue";
import { dhakaToday, fmt } from "@/lib/time";

/** Reads every row of a query, 1000 at a time (the API's page size). */
async function all<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await run(page * 1000, page * 1000 + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Overdue daily reports (see lib/overdue.ts) in the projects the viewer can read (RLS), narrowed to a set of
 * projects, a department or one person. Each dashboard passes its own scope: Admin none, Department Head a
 * department, My Projects the projects managed, My Dashboard the viewer.
 */
export async function getOverdueReports(scope: { projectIds?: string[]; departmentId?: string; userId?: string } = {}): Promise<OverdueItem[]> {
  if (scope.projectIds && !scope.projectIds.length) return [];
  const supabase = await createClient();
  const today = dhakaToday();
  const windowStart = overdueWindowStart(today);
  let pq = supabase.from("projects").select("id, code, name, start_date, created_at").eq("archived", false).eq("status", "Active");
  if (scope.departmentId) pq = pq.eq("department_id", scope.departmentId);
  const [{ data: projectRows }, settings] = await Promise.all([pq, getSettings()]);
  const wanted = scope.projectIds ? new Set(scope.projectIds) : null;
  const projects = (projectRows ?? []).filter((p) => !wanted || wanted.has(p.id));
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const narrow = ids.length <= 100;   // a longer id list goes over the URL limit; RLS and the project map still limit the rows
  // a task completed before the window opened can't make a report due inside it (one day of slack for the timezone)
  const doneSince = format(addDays(parseISO(windowStart), -1), "yyyy-MM-dd");

  const [members, tasks, reports] = await Promise.all([
    all((a, b) => {
      let q = supabase.from("project_members").select("project_id, user_id, added_at, profile:profiles!project_members_user_id_fkey(full_name, active)")
        .is("removed_at", null).order("project_id").order("user_id").range(a, b);
      if (narrow) q = q.in("project_id", ids);
      if (scope.userId) q = q.eq("user_id", scope.userId);
      return q;
    }),
    all((a, b) => {
      let q = supabase.from("tasks").select("project_id, assigned_to, assigned_on, completed_on")
        .eq("archived", false).or(`completed_on.is.null,completed_on.gte.${doneSince}`).order("id").range(a, b);
      if (narrow) q = q.in("project_id", ids);
      if (scope.userId) q = q.eq("assigned_to", scope.userId);
      return q;
    }),
    all((a, b) => {
      let q = supabase.from("daily_reports").select("project_id, user_id, report_date")
        .gte("report_date", windowStart).lt("report_date", today).order("id").range(a, b);
      if (narrow) q = q.in("project_id", ids);
      if (scope.userId) q = q.eq("user_id", scope.userId);
      return q;
    }),
  ]);

  return overdueReports({
    today, workdays: settings?.workdays,
    projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, start: projectStart(p) })),
    members: members.filter((m) => m.profile?.active).map((m) => ({ project_id: m.project_id, user_id: m.user_id, full_name: m.profile?.full_name ?? "—", added: fmt(m.added_at, "yyyy-MM-dd") })),
    tasks: tasks.map((t) => ({ project_id: t.project_id, assigned_to: t.assigned_to, assigned: fmt(t.assigned_on, "yyyy-MM-dd"), completed: t.completed_on ? fmt(t.completed_on, "yyyy-MM-dd") : null })),
    reports,
  });
}
