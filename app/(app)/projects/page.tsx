import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getDepartments, listProjects } from "@/lib/data/projects";
import { canCreateProject } from "@/lib/auth/capabilities";
import { Badge, EmptyState, Meter, PageHeader, Table } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { fmtDate } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

const STATUSES = ["Active", "On hold", "Completed", "Cancelled"];

/**
 * Projects the viewer can see (RLS): members see theirs, heads their departments', Admin all.
 * Dashboard figures open it filtered: ?status=Active, ?risk=1 (at risk), ?dept=<id>, ?managed=1 (projects I manage).
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string; risk?: string; dept?: string; managed?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const all = await listProjects();
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const filtered = Boolean(status || sp.risk || sp.dept || sp.managed);
  const projects = all.filter((p) => (!status || p.status === status) && (!sp.risk || p.metrics?.atRisk === true)
    && (!sp.dept || p.department_id === sp.dept) && (!sp.managed || p.metrics?.managed === true));
  const deptName = sp.dept ? (await getDepartments()).find((d) => d.id === sp.dept)?.name : null;
  return (
    <>
      <PageHeader title="Projects" actions={canCreateProject(s) ? <LinkButton href="/projects/new" variant="primary">New project</LinkButton> : undefined} />
      {filtered ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel/30 bg-steel-wash px-4 py-2 text-sm" data-testid="projects-filter">
          <span>Showing <strong>{[sp.risk ? "projects at risk" : null, status ? `${status} projects` : null, sp.managed ? "projects you manage" : null].filter(Boolean).join(", ") || "projects"}</strong>
            {deptName ? <> in <strong>{deptName}</strong></> : null}{" · "}<span data-testid="record-count">{projects.length} project{projects.length === 1 ? "" : "s"}</span></span>
          <Link href="/projects" className="text-steel hover:underline">Clear filter</Link>
        </div>
      ) : null}
      {projects.length === 0 && filtered ? <EmptyState title="No matching projects" /> : projects.length === 0 ? <EmptyState title="No projects yet">{canCreateProject(s) ? "Create the first project to start assigning work." : "Your PM adds you to projects."}</EmptyState> : (
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
