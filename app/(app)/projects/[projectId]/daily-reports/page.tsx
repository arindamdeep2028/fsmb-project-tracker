import { projectContext } from "@/lib/auth/project-guard";
import { projectDailyLog, projectStart } from "@/lib/data/reports";
import { getMembers } from "@/lib/data/projects";
import { getSettings } from "@/lib/data/admin";
import { createClient } from "@/lib/supabase/server";
import { reportOrder, taskCaps } from "@/lib/auth/capabilities";
import { DailyLogEditor, type RowTask } from "@/components/reports/daily-log-editor";
import { DailyLogCsv } from "@/components/reports/daily-log-csv";
import { letterOf, taskLabel } from "@/lib/sheet";
import { daysAgo, dhakaToday } from "@/lib/time";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The project's Daily Reports sheet (workbook layout), the same page for every role. Every member reads every
 * member's updates (RLS) and adds or edits their own row for today in place ("Add Daily Update"); earlier days are
 * read-only. Only an Admin may write any member's row for an earlier day: ?user=&fill=<date> (from an overdue
 * notification) opens that row ready to fill in. Admin, Department Head and Project Manager read newest first;
 * an Engineer reads oldest first, from Day 1. CSV for managers.
 */
export default async function ProjectReportsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>; searchParams: Promise<{ user?: string; from?: string; to?: string; fill?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { s, project, manages } = await projectContext(projectId);
  const today = dhakaToday();
  let to = sp.to && ISO.test(sp.to) ? sp.to : today;
  const order = reportOrder(s);
  const start = projectStart(project);
  let from = sp.from && ISO.test(sp.from) ? sp.from : order === "asc" && start <= today ? start : daysAgo(13);
  if (from > to) [from, to] = [to, from];
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 92) from = new Date(Date.parse(to) - 92 * 864e5).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [members, settings, tasks, leafRows] = await Promise.all([
    getMembers(projectId, true), getSettings(),
    supabase.from("tasks").select("id, project_id, code, title, parent_id, status, progress_pct, assigned_to, created_by, contribution_locked")
      .eq("project_id", projectId).eq("archived", false).order("code"),
    supabase.from("task_rollup").select("task_id, is_leaf").eq("project_id", projectId),
  ]);
  const who = members.find((m) => m.user_id === sp.user);
  const rows = await projectDailyLog(project, { from, to, user: who ? { id: who.user_id, name: who.full_name } : null, workdays: settings?.workdays, order });

  const isMember = s.memberProjectIds.includes(projectId);
  const current = members.filter((m) => !m.removed_at);
  // Assigned To: an Admin writes any current member's row; everyone else only their own.
  const people = s.isAdmin ? current.map((m) => ({ id: m.user_id, name: m.full_name })) : [{ id: s.userId, name: s.profile.full_name }];
  const all = tasks.data ?? [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const leaf = new Map((leafRows.data ?? []).map((r) => [r.task_id, r.is_leaf]));
  const rowTasks: RowTask[] = all
    .filter((t) => t.status !== "Completed" && people.some((p) => p.id === t.assigned_to))
    .map((t) => {
      const parent = t.parent_id ? byId.get(t.parent_id) : undefined;
      const isLeaf = leaf.get(t.id) ?? true;
      return {
        id: t.id, assigned_to: t.assigned_to, status: t.status, is_leaf: isLeaf, progress_pct: t.progress_pct,
        label: parent ? taskLabel(parent.code, parent.title) : taskLabel(t.code, t.title),
        sub: parent ? `${letterOf(t.code)}. ${t.title}` : null,
        choices: taskCaps(s, t, manages, isLeaf).statuses,
      };
    });
  const query = new URLSearchParams({ ...(who ? { user: who.user_id } : {}), from, to }).toString();
  // an overdue report to fill in: Admin only, a past day of the project, a current member
  const fill = s.isAdmin && sp.fill && ISO.test(sp.fill) && sp.fill < today && sp.fill >= start && who && people.some((p) => p.id === who.user_id)
    ? { date: sp.fill, userId: who.user_id } : null;

  return (
    <DailyLogEditor key={fill ? `${fill.userId}-${fill.date}` : "log"} order={order} fill={fill}
      projectId={projectId} rows={rows} today={today} start={start} meId={s.userId} isAdmin={s.isAdmin}
      canAdd={(isMember || s.isAdmin) && !project.archived && people.length > 0} people={people} tasks={rowTasks} from={from} query={query}
      filters={
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Assigned To
            <select name="user" defaultValue={who?.user_id ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
              <option value="">Everyone</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="text-sm">From<input type="date" name="from" defaultValue={from} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={to} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
          <button className="h-9 rounded-md border border-line bg-panel px-3 text-sm font-medium hover:border-steel">Apply</button>
        </form>
      }
      actions={manages ? <DailyLogCsv rows={rows} name={`${project.code}-daily-follow-up-${from}-to-${to}`} /> : null} />
  );
}
