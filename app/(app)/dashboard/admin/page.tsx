import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminDashboard } from "@/lib/data/dashboards";
import { Kpi, PageHeader, Section, Table } from "@/components/ui/misc";
import { ProjectHealthTable } from "@/components/dashboards/project-table";
import { LinkButton } from "@/components/ui/button";
import { ago } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin dashboard" };

/** Admin dashboard (Frontend Blueprint §9): admin_dashboard(). Admin has complete system access. */
export default async function AdminDashboard() {
  await requireAdmin();
  const d = await getAdminDashboard();
  const o = d.overview;
  const failing = d.jobs.filter((j) => j.last_error);
  return (
    <>
      <PageHeader title="Admin dashboard" lead="The whole system: projects, people, departments and scheduled jobs."
        actions={<><LinkButton href="/admin/users">Add a user</LinkButton><LinkButton href="/projects/new" variant="primary">New project</LinkButton></>} />
      {failing.length ? (
        <div className="rail rail-red mb-6 rounded-lg border border-line bg-panel py-3 pl-5 pr-4">
          <span className="font-medium">A scheduled job failed:</span> {failing.map((j) => j.job).join(", ")}. <Link href="/admin/data" className="text-steel hover:underline">Open Data and jobs</Link>
        </div>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active projects" value={o?.projects_active ?? 0} href="/projects" />
        <Kpi label="Projects at risk" value={o?.projects_at_risk ?? 0} signal={o?.projects_at_risk ? "red" : "neutral"} />
        <Kpi label="Red tasks" value={o?.red_tasks ?? 0} signal={o?.red_tasks ? "red" : "neutral"} />
        <Kpi label="Active users" value={o?.users_active ?? 0} href="/admin/users" />
      </div>
      <div className="space-y-6">
        <Section title="Projects"><ProjectHealthTable projects={d.projects} /></Section>
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Departments">
            <Table>
              <thead><tr><th>Department</th><th>Active</th><th>Progress</th><th>At risk</th><th>Red tasks</th></tr></thead>
              <tbody>
                {d.departments.map((x) => (
                  <tr key={x.department_id}>
                    <td><Link href={`/dashboard/department?dept=${x.department_id}`} className="font-medium hover:text-steel hover:underline">{x.department_name}</Link></td>
                    <td>{x.active_projects}</td><td>{pct(x.department_progress_pct)}</td>
                    <td className={x.projects_at_risk ? "text-signal-red" : undefined}>{x.projects_at_risk}</td>
                    <td className={x.red_tasks ? "text-signal-red" : undefined}>{x.red_tasks}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
          <Section title="People and jobs">
            <dl className="mb-4 grid grid-cols-2 gap-y-1.5 text-[15px]">
              <dt className="text-ink-soft">Admins</dt><dd>{o?.admins}</dd>
              <dt className="text-ink-soft">Department heads</dt><dd>{o?.dept_heads}</dd>
              <dt className="text-ink-soft">Project managers</dt><dd>{o?.pms}</dd>
              <dt className="text-ink-soft">Engineers</dt><dd>{o?.engineers}</dd>
              <dt className="text-ink-soft">Not on any project</dt><dd className={o?.users_without_project ? "text-signal-amber" : undefined}>{o?.users_without_project}</dd>
            </dl>
            <ul className="space-y-1 text-sm">
              {d.jobs.map((j) => <li key={j.job} className={j.last_error ? "text-signal-red" : "text-ink-soft"}>{j.job}: {j.last_run ? `last run ${ago(j.last_run)}` : "not run yet"}{j.last_error ? " · failed" : ""}</li>)}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
