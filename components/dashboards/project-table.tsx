import Link from "next/link";
import { Badge, CountLink, Meter, Table } from "@/components/ui/misc";
import { dhakaToday, fmtDate } from "@/lib/time";
import { pct } from "@/lib/utils";
import type { ProjectMetrics } from "@/types/domain";

/**
 * Project health table shared by the PM, Department and Admin dashboards. Every figure opens its records:
 * counts → the project's Responsibilities filtered the same way; reports → today's Daily Follow Up.
 */
export function ProjectHealthTable({ projects }: { projects: ProjectMetrics[] }) {
  if (!projects.length) return <p className="text-sm text-ink-soft">No projects.</p>;
  const today = dhakaToday();
  const tasks = (p: ProjectMetrics, filter: string) => `/projects/${p.project_id}/tasks?filter=${filter}`;
  return (
    <Table>
      <thead><tr><th>Project</th><th className="w-48">Completion vs plan</th><th>Red</th><th>Overdue</th><th>Blocked</th><th>Open</th><th>Target</th><th>Reports today</th></tr></thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.project_id} className={p.at_risk ? "bg-signal-red/[0.03]" : undefined}>
            <td>
              <Link href={`/projects/${p.project_id}`} className="font-medium hover:text-steel hover:underline">{p.code}</Link> <span className="text-ink-soft">{p.name}</span>
              <div className="mt-0.5 flex gap-1.5">
                {p.at_risk ? <Badge signal="red">At risk</Badge> : null}
                {p.behind_schedule ? <Badge signal="amber">Behind plan</Badge> : null}
                {p.status !== "Active" ? <Badge>{p.status}</Badge> : null}
              </div>
            </td>
            <td><Link href={`/projects/${p.project_id}`} className="flex items-center gap-2 hover:text-steel" aria-label={`${p.code} completion`}><Meter value={p.completion_pct} planned={p.planned_pct} className="w-28" label={`${p.code} completion`} /><span className="underline decoration-dotted underline-offset-4">{pct(p.completion_pct)}</span></Link>
              {p.planned_pct != null ? <div className="text-xs text-ink-soft">plan {pct(p.planned_pct)}</div> : null}</td>
            <td className={p.red_tasks ? "font-semibold text-signal-red" : undefined}><CountLink href={tasks(p, "red")} value={p.red_tasks} label={`${p.code} red tasks`} /></td>
            <td className={p.overdue_tasks ? "font-semibold text-signal-red" : undefined}><CountLink href={tasks(p, "overdue")} value={p.overdue_tasks} label={`${p.code} overdue tasks`} /></td>
            <td className={p.blocked_tasks ? "text-signal-amber" : undefined}><CountLink href={tasks(p, "blocked")} value={p.blocked_tasks} label={`${p.code} blocked tasks`} /></td>
            <td><CountLink href={tasks(p, "open")} value={p.open_tasks} label={`${p.code} open tasks`} /></td>
            <td className="whitespace-nowrap">{fmtDate(p.target_end)}</td>
            <td>{p.reports_expected_today
              ? <Link href={`/projects/${p.project_id}/daily-reports?from=${today}&to=${today}`} aria-label={`${p.code} reports today`} className="underline decoration-dotted underline-offset-4 hover:text-steel hover:decoration-solid">{p.reports_submitted_today} of {p.reports_expected_today}</Link>
              : "—"}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
