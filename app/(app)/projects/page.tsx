import type { Metadata } from "next";
import Link from "next/link";
import { Aperture, Cog, CodeXml, Cpu, Plus, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getDepartments, getStatusHistory, listProjects } from "@/lib/data/projects";
import { canCreateProject, canManageProject } from "@/lib/auth/capabilities";
import { LIFECYCLE, PROJECT_CATEGORIES, lifecycleOf, parseCategory, parseLifecycle, type ProjectCategory } from "@/lib/project-status";
import { PageHeader } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { ProjectList, type ProjectRow, type StatusPill } from "@/components/projects/project-list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

const ICON: Record<ProjectCategory, LucideIcon> = { Software: CodeXml, Embedded: Cpu, Optical: Aperture, Mechanical: Cog };

type SP = { category?: string; status?: string; risk?: string; dept?: string; managed?: string };

/**
 * Projects the viewer can see (RLS): members see theirs, heads their departments', Admin all.
 * One tab per category (?category=), lifecycle filter (?status=running|halted|completed).
 * Dashboard figures open it filtered: ?status=Active, ?risk=1 (at risk), ?dept=<id>, ?managed=1 (projects I manage).
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const all = await listProjects();
  const lifecycle = parseLifecycle(sp.status);
  const dashFilter = Boolean(sp.risk || sp.dept || sp.managed);
  // Dashboard filters (risk, department, managed) apply across categories; the tab counts show where the matches are.
  const base = all.filter((p) => (!sp.risk || p.metrics?.atRisk === true)
    && (!sp.dept || p.department_id === sp.dept) && (!sp.managed || p.metrics?.managed === true));
  const matches = (c: ProjectCategory) => base.filter((p) => p.category === c && (!lifecycle || lifecycleOf(p.status) === lifecycle));
  // No tab chosen: Software, unless a dashboard link points at projects that are all in another category.
  const category = parseCategory(sp.category)
    ?? ((dashFilter || lifecycle) ? PROJECT_CATEGORIES.find((c) => matches(c).length > 0) : undefined)
    ?? "Software";
  const inCategory = base.filter((p) => p.category === category);
  const rows = inCategory.filter((p) => !lifecycle || lifecycleOf(p.status) === lifecycle);
  const history = await getStatusHistory(rows.map((p) => p.id));
  const deptName = sp.dept ? (await getDepartments()).find((d) => d.id === sp.dept)?.name : null;

  const href = (o: { category?: ProjectCategory; status?: string | null }) => {
    const u = new URLSearchParams();
    u.set("category", (o.category ?? category).toLowerCase());
    const st = o.status === undefined ? lifecycle : o.status;
    if (st) u.set("status", st);
    if (sp.risk) u.set("risk", sp.risk);
    if (sp.dept) u.set("dept", sp.dept);
    if (sp.managed) u.set("managed", sp.managed);
    return `/projects?${u.toString()}`;
  };
  const pills: StatusPill[] = [
    { key: "all", label: "All", count: inCategory.length, href: href({ status: null }), active: !lifecycle },
    ...LIFECYCLE.map((l) => ({
      key: l.key, label: l.label, count: inCategory.filter((p) => p.status === l.status).length,
      href: href({ status: l.key }), active: lifecycle === l.key,
      dot: (l.key === "running" ? "running" : l.key === "halted" ? "halted" : "closed") as StatusPill["dot"],
    })),
  ];
  const projectRows: ProjectRow[] = rows.map((p) => ({
    id: p.id, code: p.code, name: p.name, department: p.department?.name ?? null, pm: p.pm?.full_name ?? null,
    completion: p.metrics?.completion ?? null, planned: p.metrics?.planned ?? null, atRisk: p.metrics?.atRisk === true,
    status: p.status, targetEnd: p.target_end,
    canManage: canManageProject(s, p),
  }));
  const creates = canCreateProject(s);

  return (
    <>
      <PageHeader title="Projects" actions={creates
        ? <LinkButton href={`/projects/new?category=${category.toLowerCase()}`} variant="primary" data-testid="new-project"><Plus size={18} aria-hidden />New project</LinkButton>
        : undefined} />
      {dashFilter ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel/30 bg-steel-wash px-4 py-2 text-sm" data-testid="projects-filter">
          <span>Showing <strong>{[sp.risk ? "projects at risk" : null, sp.managed ? "projects you manage" : null].filter(Boolean).join(", ") || "projects"}</strong>
            {deptName ? <> in <strong>{deptName}</strong></> : null}{" · "}<span data-testid="record-count">{rows.length} project{rows.length === 1 ? "" : "s"}</span></span>
          <Link href={`/projects?category=${category.toLowerCase()}`} className="text-steel hover:underline">Clear filter</Link>
        </div>
      ) : null}
      <nav aria-label="Project categories" className="mb-4 flex gap-3 overflow-x-auto border-b border-line pb-4">
        {PROJECT_CATEGORIES.map((c) => {
          const Icon = ICON[c];
          const active = c === category;
          return (
            <Link key={c} href={href({ category: c, status: null })} aria-current={active ? "page" : undefined} data-testid={`category-${c}`}
              className={cn("inline-flex h-12 min-w-40 shrink-0 items-center justify-center gap-2.5 rounded-md border px-5 text-[15px] font-medium transition-colors",
                active ? "border-steel bg-steel text-white" : "border-line bg-panel text-ink hover:border-steel hover:text-steel")}>
              <Icon size={20} aria-hidden />{c} ({base.filter((p) => p.category === c).length})
            </Link>
          );
        })}
      </nav>
      <ProjectList rows={projectRows} pills={pills} history={history}
        emptyText={lifecycle || dashFilter ? `No matching ${category} projects.`
          : creates ? `Create the first ${category} project with New project.` : "Your PM adds you to projects."} />
    </>
  );
}
