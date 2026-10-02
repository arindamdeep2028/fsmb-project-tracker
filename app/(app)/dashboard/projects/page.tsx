import type { Metadata } from "next";
import Link from "next/link";
import { requireProjectManagerView } from "@/lib/auth/session";
import { getMyProjectsDashboard } from "@/lib/data/dashboards";
import { CountLink, EmptyState, Kpi, PageHeader, Section, Table } from "@/components/ui/misc";
import { ProjectHealthTable } from "@/components/dashboards/project-table";
import { CompletionBars } from "@/components/data/charts";
import { ago, dhakaHour, dhakaToday, fmtDay } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "My Projects" };

/** PM dashboard (Frontend Blueprint §7): one RPC, my_projects_dashboard(). */
export default async function PmDashboard() {
  await requireProjectManagerView();
  const d = await getMyProjectsDashboard();
  const red = d.projects.reduce((a, p) => a + (p.red_tasks ?? 0), 0);
  const overdue = d.projects.reduce((a, p) => a + (p.overdue_tasks ?? 0), 0);
  const late = dhakaHour() >= 17;
  // every figure opens its records; project ids by code for rows that carry only the code
  const today = dhakaToday();
  const idByCode = new Map(d.projects.map((p) => [p.code ?? "", p.project_id ?? ""]));
  const projectOfTask = (code: string) => idByCode.get(code.replace(/-T\d+.*$/, ""));
  const reportsToday = (pid: string | null | undefined, user: string) => `/projects/${pid}/daily-reports?user=${user}&from=${today}&to=${today}`;
  if (!d.projects.length) return (<><PageHeader title="My Projects" /><EmptyState title="No projects to manage yet">You'll see projects here once you're a PM on one.</EmptyState></>);
  return (
    <>
      <PageHeader title="My Projects" lead="Where work is slipping across the projects you manage." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Projects" value={d.projects.length} href="/projects?managed=1" />
        <Kpi label="Red tasks" value={red} signal={red ? "red" : "neutral"} href={red ? "/my-tasks?filter=red&managed=1" : undefined} />
        <Kpi label="Overdue tasks" value={overdue} signal={overdue ? "red" : "neutral"} href={overdue ? "/my-tasks?filter=overdue&managed=1" : undefined} />
        <Kpi label="Reports missing today" value={d.missing_reports.length} signal={d.missing_reports.length && late ? "amber" : "neutral"} href={d.missing_reports.length ? "#missing-reports" : undefined} />
      </div>
      <div className="space-y-6">
        <Section title="Project health"><ProjectHealthTable projects={d.projects} /></Section>
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Completion against plan">
            <CompletionBars data={d.projects.map((p) => ({ name: p.code ?? "", completion: p.completion_pct ?? 0, planned: p.planned_pct }))} />
          </Section>
          <Section title="Blocked tasks">
            {d.blocked_tasks.length ? (
              <ul className="divide-y divide-line-soft">
                {d.blocked_tasks.map((t) => (
                  <li key={t.task_id} className="rail rail-amber py-2.5 pl-4">
                    {projectOfTask(t.code) ? <Link href={`/projects/${projectOfTask(t.code)}/tasks/${t.task_id}`} className="hover:text-steel hover:underline"><span className="font-medium">{t.code}</span> {t.title}</Link>
                      : <><span className="font-medium">{t.code}</span> {t.title}</>}
                    {t.blocker_note ? <p className="text-sm text-ink-soft">{t.blocker_note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-soft">Nothing is blocked.</p>}
          </Section>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Team load">
            <Table>
              <thead><tr><th>Person</th><th>Project</th><th>Open</th><th>Red</th><th>Share</th><th>Delivered</th><th>Reported</th></tr></thead>
              <tbody>
                {d.team_load.map((m) => (
                  <tr key={`${m.project_id}-${m.user_id}`}>
                    <td className="font-medium"><Link href={`/projects/${m.project_id}/tasks?user=${m.user_id}`} className="hover:text-steel hover:underline">{m.full_name}</Link></td>
                    <td><Link href={`/projects/${m.project_id}`} className="hover:text-steel hover:underline">{m.project_code}</Link></td>
                    <td><CountLink href={`/projects/${m.project_id}/tasks?filter=open&user=${m.user_id}`} value={m.open_tasks} label={`${m.full_name} ${m.project_code} open tasks`} /></td>
                    <td className={m.red_tasks ? "font-semibold text-signal-red" : undefined}><CountLink href={`/projects/${m.project_id}/tasks?filter=red&user=${m.user_id}`} value={m.red_tasks} label={`${m.full_name} ${m.project_code} red tasks`} /></td>
                    <td>{pct(m.share_pct, 1)}</td><td>{pct(m.delivered_pct, 1)}</td>
                    <td>{m.reported_today ? <Link href={reportsToday(m.project_id, m.user_id ?? "")} className="underline decoration-dotted underline-offset-4 hover:text-steel">Yes</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
          <div id="missing-reports" className="scroll-mt-6"><Section title="Missing reports today" aside={<span className="text-sm text-ink-soft">{late ? "After 17:00" : "Due by end of day"}</span>}>
            {d.missing_reports.length ? (
              <ul className="space-y-1.5">{d.missing_reports.map((m) => <li key={`${m.project_code}-${m.user_id}`} className={late ? "text-signal-amber" : undefined}>
                <Link href={reportsToday(idByCode.get(m.project_code), m.user_id)} className="hover:text-steel hover:underline"><span className="font-medium">{m.full_name}</span> · {m.project_code}</Link></li>)}</ul>
            ) : <p className="text-sm text-ink-soft">Everyone expected has reported, or today is a non-working day.</p>}
          </Section></div>
        </div>
        <Section title="Latest team updates">
          {d.team_updates.length ? (
            <ul className="divide-y divide-line-soft">
              {d.team_updates.map((u) => (
                <li key={u.report_id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/daily-reports/${u.report_id}`} className="font-medium hover:text-steel hover:underline">{u.full_name} · {u.project_code}</Link>
                    <span className="text-sm text-ink-soft">{fmtDay(u.report_date)} · {ago(u.submitted_at)}</span>
                  </div>
                  <p className="line-clamp-2 text-[15px]">{u.update_text}</p>
                  {u.issues ? <p className="text-sm text-signal-amber">Issues: {u.issues}</p> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-soft">No reports yet.</p>}
        </Section>
      </div>
    </>
  );
}
