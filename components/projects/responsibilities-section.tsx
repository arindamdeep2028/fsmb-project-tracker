import "server-only";
import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { getMembers, getProjectEngineers, listProjects } from "@/lib/data/projects";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { canManageProject } from "@/lib/auth/capabilities";
import { capsForTree } from "@/lib/auth/task-caps";
import { EmptyState } from "@/components/ui/misc";
import { ProjectChooser } from "@/components/projects/project-chooser";
import { ProjectPlan } from "@/components/tasks/project-plan";

type Visible = Awaited<ReturnType<typeof listProjects>>;

/**
 * Responsibilities (the sidebar bar under "Submit today's report"): choose a project, then work on its
 * Responsibilities sheet in place. The projects offered are the running ones (status Active) the viewer can see
 * (RLS: members theirs, Department Heads their departments', Admin all), the viewer's own first. The sheet is the
 * same one as the project's Responsibilities tab, with the same rules.
 */
export async function ResponsibilitiesSection({ s, visible, wanted }: { s: Session; visible: Visible; wanted?: string }) {
  const mine = new Set(s.memberProjectIds);
  const projects = visible.filter((p) => p.status === "Active" && !p.archived).sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.code.localeCompare(b.code));
  const project = projects.find((p) => p.id === wanted) ?? projects[0];
  if (!project) {
    return <EmptyState title="No running projects">Once you're on a running project, its responsibilities appear here.</EmptyState>;
  }
  const manages = canManageProject(s, project);
  const isMember = mine.has(project.id);
  const [tree, members] = await Promise.all([getProjectTaskTree(project.id), getMembers(project.id, true)]);
  // Managers assign to any current member; engineers to themselves or an engineer member (v2 §8).
  const assignees = manages
    ? members.filter((m) => !m.removed_at).map((m) => ({ user_id: m.user_id, full_name: m.full_name }))
    : await getProjectEngineers(project.id);
  return (
    <section data-testid="responsibilities-section">
      <ProjectChooser projects={projects} current={project.id} label="Project (running projects)" />
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold"><span className="text-ink-soft">{project.code}</span> {project.name}</h3>
        <Link href={`/projects/${project.id}/tasks`} className="text-sm text-steel hover:underline">Open in the project</Link>
      </div>
      {/* keyed by project: switching project starts fresh, so no cell draft of one project reaches another */}
      <ProjectPlan key={project.id} nodes={tree} caps={capsForTree(s, project, tree)} projectId={project.id} meId={s.userId} isAdmin={s.isAdmin}
        assignees={assignees} canCreate={(manages || isMember) && !project.archived} managerView={manages}
        basePath={`/projects/${project.id}/tasks`} title={{ name: project.name, prepared: project.start_date ?? project.created_at }} />
    </section>
  );
}
