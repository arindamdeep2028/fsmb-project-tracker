import Link from "next/link";
import { Badge, Meter, Table } from "@/components/ui/misc";
import { fmtDate } from "@/lib/time";
import { pct } from "@/lib/utils";
import type { ProjectMetrics } from "@/types/domain";

/** Project health table shared by the PM, Department and Admin dashboards. */
export function ProjectHealthTable({ projects }: { projects: ProjectMetrics[] }) {
  if (!projects.length) return <p className="text-sm text-ink-soft">No projects.</p>;
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
            <td><div className="flex items-center gap-2"><Meter value={p.completion_pct} planned={p.planned_pct} className="w-28" label={`${p.code} completion`} /><span>{pct(p.completion_pct)}</span></div>
              {p.planned_pct != null ? <div className="text-xs text-ink-soft">plan {pct(p.planned_pct)}</div> : null}</td>
            <td className={p.red_tasks ? "font-semibold text-signal-red" : undefined}>{p.red_tasks}</td>
            <td className={p.overdue_tasks ? "font-semibold text-signal-red" : undefined}>{p.overdue_tasks}</td>
            <td className={p.blocked_tasks ? "text-signal-amber" : undefined}>{p.blocked_tasks}</td>
            <td>{p.open_tasks}</td>
            <td className="whitespace-nowrap">{fmtDate(p.target_end)}</td>
            <td>{p.reports_expected_today ? `${p.reports_submitted_today} of ${p.reports_expected_today}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
