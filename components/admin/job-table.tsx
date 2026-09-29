"use client";
import { runJob } from "@/lib/actions/admin";
import { setProjectArchived, deleteProject } from "@/lib/actions/projects";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Badge, Table } from "@/components/ui/misc";
import { fmt } from "@/lib/time";

import type { Tables } from "@/types/database";

type Run = Tables<"scan_runs">;
function summary(r: Run): string {
  const parts = [
    r.flagged_tasks != null ? `${r.flagged_tasks} flagged` : null,
    r.new_red_marks != null ? `${r.new_red_marks} new red marks` : null,
    r.notifications_created != null ? `${r.notifications_created} notifications` : null,
    r.emails_sent != null ? `${r.emails_sent} emails` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : r.finished_at ? "Finished" : "Running";
}
const JOBS = [
  { job: "red-mark-scan" as const, label: "Red-mark scan", when: "Daily 09:05 Dhaka, working days" },
  { job: "deadline-scan" as const, label: "Deadline reminders", when: "Every 15 min, 08:00–19:45 Dhaka, working days" },
  { job: "lock-and-purge" as const, label: "Lock reports and purge old notifications", when: "Daily 23:55 Dhaka" },
];

export function JobTable({ runs }: { runs: Run[] }) {
  const { pending, run } = useAction();
  return (
    <div className="space-y-6">
      <Table>
        <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th /></tr></thead>
        <tbody>
          {JOBS.map((j) => {
            const last = runs.find((r) => r.job === j.job);
            return (
              <tr key={j.job}>
                <td className="font-medium">{j.label}</td><td className="text-ink-soft">{j.when}</td>
                <td>{last ? <>{fmt(last.started_at)} {last.error ? <Badge signal="red">Failed</Badge> : <Badge signal="green">OK</Badge>}</> : "Not run yet"}</td>
                <td className="text-right"><Button size="sm" variant="secondary" pending={pending} onClick={() => run(() => runJob(j.job))}>Run now</Button></td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div>
        <h3 className="mb-2 text-sm font-medium">Recent runs</h3>
        <Table>
          <thead><tr><th>Started</th><th>Job</th><th>Trigger</th><th>Result</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}><td className="whitespace-nowrap">{fmt(r.started_at)}</td><td>{r.job}</td><td>{r.trigger}</td>
                <td className={r.error ? "text-signal-red" : "text-ink-soft"}>{r.error ?? summary(r)}</td></tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export function DemoProjects({ projects }: { projects: { id: string; code: string; name: string; archived: boolean }[] }) {
  const { pending, run } = useAction();
  if (!projects.length) return <p className="text-sm text-ink-soft">No sample projects.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {projects.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span><span className="font-medium">{p.code}</span> {p.name} {p.archived ? <Badge signal="done">Archived</Badge> : null}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" pending={pending} onClick={() => run(() => setProjectArchived(p.id, !p.archived))}>{p.archived ? "Restore" : "Archive"}</Button>
            <Button size="sm" variant="danger" pending={pending} onClick={() => confirm(`Delete sample project ${p.code}? Only possible while it has no daily reports.`) && run(() => deleteProject(p.id))}>Delete</Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
