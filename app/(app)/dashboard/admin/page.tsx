import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarCheck, ChartColumn, FolderKanban, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminDashboard, getWorkItemStatuses } from "@/lib/data/dashboards";
import { getOverdueReports } from "@/lib/data/overdue";
import { OverdueReports } from "@/components/reports/overdue-reports";
import { AnnouncementBanner } from "@/components/announcements/banner";
import { CountLink, Table } from "@/components/ui/misc";
import { ProjectHealthTable } from "@/components/dashboards/project-table";
import { StatusDonut } from "@/components/dashboards/engineer-charts";
import { CountBars, LiveClock } from "@/components/dashboards/admin-charts";
import { BUCKET_COLOR, PROJECT_GROUPS, PROJECT_GROUP_COLOR, projectsByStatus, statusBreakdown } from "@/lib/dashboard-status";
import { LinkButton } from "@/components/ui/button";
import { ago } from "@/lib/time";
import { cn, pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin dashboard" };

const card = "rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(38,51,43,0.06)]";

function CardHead({ icon, title, note, aside }: { icon: React.ReactNode; title: string; note?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-steel" aria-hidden>{icon}</span>
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {note ? <span className="text-sm text-ink-soft">({note})</span> : null}
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  );
}

function KpiCard({ label, value, tone, href }: { label: string; value: number; tone: string; href?: string }) {
  const body = (<><div className={cn("text-[34px] font-bold leading-none", tone)}>{value}</div><div className="mt-3 text-[15px] text-ink-soft">{label}</div></>);
  const cls = cn(card, "block px-6 py-5");
  return href ? <Link href={href} data-testid="kpi" className={cn(cls, "transition-colors hover:border-steel")}>{body}</Link> : <div data-testid="kpi" className={cls}>{body}</div>;
}

/**
 * Admin dashboard (Frontend Blueprint §9): admin_dashboard() for every figure it showed before. The two panels are
 * display-only: the status of the work items in the active projects, and each active project in one status group.
 * Admin has complete system access. Every figure opens its records.
 */
export default async function AdminDashboard() {
  await requireAdmin();
  const [d, overdue] = await Promise.all([getAdminDashboard(), getOverdueReports()]);
  const o = d.overview;
  const failing = d.jobs.filter((j) => j.last_error);
  const active = d.projects.filter((p) => p.status === "Active");
  const slices = statusBreakdown(await getWorkItemStatuses(active.map((p) => p.project_id).filter((x): x is string => Boolean(x))));
  const groups = projectsByStatus(active);

  return (
    <div data-testid="admin-dashboard">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin dashboard</h1>
          <p className="mt-0.5 text-[15px] text-ink"><LiveClock start={new Date().toISOString()} /></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/admin/users">Add a user</LinkButton>
          <LinkButton href="/projects/new" variant="primary">New project</LinkButton>
        </div>
      </header>

      <div className="space-y-3">
        <AnnouncementBanner compact />
        {failing.length ? (
          <div className="rail rail-red rounded-lg border border-line bg-panel py-3 pl-5 pr-4">
            <span className="font-medium">A scheduled job failed:</span> {failing.map((j) => j.job).join(", ")}. <Link href="/admin/data" className="text-steel hover:underline">Open Data and jobs</Link>
          </div>
        ) : null}
        <OverdueReports items={overdue} canFill compact />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active projects" value={o?.projects_active ?? 0} tone="text-steel" href="/projects?status=Active" />
        <KpiCard label="Projects at risk" value={o?.projects_at_risk ?? 0} tone={o?.projects_at_risk ? "text-signal-red" : "text-ink"} href={o?.projects_at_risk ? "/projects?risk=1" : undefined} />
        <KpiCard label="Red tasks" value={o?.red_tasks ?? 0} tone={o?.red_tasks ? "text-signal-red" : "text-ink"} href={o?.red_tasks ? "/my-tasks?filter=red&all=1" : undefined} />
        <KpiCard label="Active users" value={o?.users_active ?? 0} tone="text-steel" href="/admin/users?status=active" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className={cn(card, "min-w-0 p-5")} aria-label="Project Completion" data-testid="panel-completion">
          <CardHead icon={<CalendarCheck size={22} />} title="Project Completion" note="All Projects" />
          <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-6">
            <StatusDonut slices={slices} />
            <ul className="space-y-1.5 text-sm">
              {slices.map((x) => (
                <li key={x.bucket} data-testid="completion-row" className="flex items-center gap-2.5 rounded-md bg-paper px-2.5 py-1.5" title={`${x.count} ${x.count === 1 ? "item" : "items"}`}>
                  <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[x.bucket] }} />
                  <span className="flex-1">{x.bucket}</span>
                  <span className="font-semibold tabular-nums">{x.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Share of the work items (tasks and subtasks) in the active projects, by status.</p>
        </section>

        <section className={cn(card, "min-w-0 p-5")} aria-label="Projects by Status" data-testid="panel-project-status">
          <CardHead icon={<ChartColumn size={22} />} title="Projects by Status" />
          <div className="mt-3"><CountBars data={PROJECT_GROUPS.map((g) => ({ label: g, count: groups[g], color: PROJECT_GROUP_COLOR[g] }))} /></div>
          <p className="mt-1 text-xs text-ink-soft">Each active project once: at risk, else with an overdue task, else with a blocked task, else on track.</p>
        </section>
      </div>

      <section className={cn(card, "mt-4 p-5")} aria-label="Projects" data-testid="panel-projects">
        <CardHead icon={<FolderKanban size={22} />} title="Projects" />
        <div className="mt-3"><ProjectHealthTable projects={d.projects} /></div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className={cn(card, "min-w-0 p-5")} aria-label="Departments" data-testid="panel-departments">
          <CardHead icon={<Building2 size={22} />} title="Departments" />
          <div className="mt-3">
            <Table>
              <thead><tr><th>Department</th><th>Active</th><th>Progress</th><th>At risk</th><th>Red tasks</th></tr></thead>
              <tbody>
                {d.departments.map((x) => (
                  <tr key={x.department_id}>
                    <td><Link href={`/dashboard/department?dept=${x.department_id}`} className="font-medium hover:text-steel hover:underline">{x.department_name}</Link></td>
                    <td><CountLink href={`/projects?dept=${x.department_id}&status=Active`} value={x.active_projects} label={`${x.department_name} active projects`} /></td>
                    <td><CountLink href={`/projects?dept=${x.department_id}&status=Active`} value={x.active_projects}>{pct(x.department_progress_pct)}</CountLink></td>
                    <td className={x.projects_at_risk ? "text-signal-red" : undefined}><CountLink href={`/projects?dept=${x.department_id}&risk=1`} value={x.projects_at_risk} label={`${x.department_name} projects at risk`} /></td>
                    <td className={x.red_tasks ? "text-signal-red" : undefined}><CountLink href={`/my-tasks?filter=red&dept=${x.department_id}`} value={x.red_tasks} label={`${x.department_name} red tasks`} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </section>

        <section className={cn(card, "min-w-0 p-5")} aria-label="People and jobs" data-testid="panel-people">
          <CardHead icon={<Users size={22} />} title="People and Jobs" />
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 self-start text-[15px]">
              <dt className="text-ink-soft">Admins</dt><dd className="font-semibold"><CountLink href="/admin/users?role=admin" value={o?.admins} label="Admins" /></dd>
              <dt className="text-ink-soft">Department heads</dt><dd className="font-semibold"><CountLink href="/admin/users?role=dept_head" value={o?.dept_heads} label="Department heads" /></dd>
              <dt className="text-ink-soft">Project managers</dt><dd className="font-semibold"><CountLink href="/admin/users?role=pm" value={o?.pms} label="Project managers" /></dd>
              <dt className="text-ink-soft">Engineers</dt><dd className="font-semibold"><CountLink href="/admin/users?role=engineer" value={o?.engineers} label="Engineers" /></dd>
              <dt className="text-ink-soft">Not on any project</dt><dd className={cn("font-semibold", o?.users_without_project ? "text-signal-amber" : undefined)}><CountLink href="/admin/users?noproject=1" value={o?.users_without_project} label="Not on any project" /></dd>
            </dl>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">Scheduled jobs</h3>
              <ul className="space-y-1 text-sm" data-testid="jobs">
                {d.jobs.map((j) => <li key={j.job} className={j.last_error ? "text-signal-red" : "text-ink-soft"}><Link href="/admin/data" className="font-medium text-ink hover:text-steel hover:underline">{j.job}</Link>: {j.last_run ? `last run ${ago(j.last_run)}` : "not run yet"}{j.last_error ? " · failed" : ""}</li>)}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
