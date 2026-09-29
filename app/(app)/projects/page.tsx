import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/data/projects";
import { canCreateProject } from "@/lib/auth/capabilities";
import { Badge, EmptyState, Meter, PageHeader, Table } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { fmtDate } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

/** Projects the viewer can see (RLS): members see theirs, heads their departments', Admin all. */
export default async function ProjectsPage() {
  const s = await requireSession();
  const projects = await listProjects();
  return (
    <>
      <PageHeader title="Projects" actions={canCreateProject(s) ? <LinkButton href="/projects/new" variant="primary">New project</LinkButton> : undefined} />
      {projects.length === 0 ? <EmptyState title="No projects yet">{canCreateProject(s) ? "Create the first project to start assigning work." : "Your PM adds you to projects."}</EmptyState> : (
        <Table className="rounded-lg border border-line bg-panel">
          <thead><tr><th>Project</th><th>Department</th><th>Lead PM</th><th className="w-48">Completion</th><th>Status</th><th>Target end</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`} className="font-medium hover:text-steel hover:underline">{p.code}</Link> <span className="text-ink-soft">{p.name}</span>
                  {p.metrics?.atRisk ? <Badge signal="red" className="ml-2">At risk</Badge> : null}</td>
                <td>{p.department?.name}</td>
                <td>{p.pm?.full_name ?? "—"}</td>
                <td><div className="flex items-center gap-2"><Meter value={p.metrics?.completion} planned={p.metrics?.planned} className="w-28" /><span>{pct(p.metrics?.completion)}</span></div></td>
                <td>{p.status}</td>
                <td className="whitespace-nowrap">{fmtDate(p.target_end)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
