import Link from "next/link";
import { projectContext } from "@/lib/auth/project-guard";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { getMembers, getProjectEngineers } from "@/lib/data/projects";
import { capsForTree } from "@/lib/auth/task-caps";
import { filterLabel, isTaskFilter, pruneTree, taskMatches } from "@/lib/drill";
import { ProjectPlan } from "@/components/tasks/project-plan";

/**
 * Responsibilities: the project plan (workbook Task list layout) with calculated progress and row actions.
 * Dashboard figures open it filtered (?filter=red|overdue|blocked|open|done, ?user=…) to the records they count.
 */
export default async function ProjectTasksPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>; searchParams: Promise<{ filter?: string; user?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { s, project, manages } = await projectContext(projectId);
  const tree = await getProjectTaskTree(projectId);
  const members = await getMembers(projectId, true);
  // Managers assign to any current member; engineers to themselves or an engineer member (v2 §8).
  const assignees = manages
    ? members.filter((m) => !m.removed_at).map((m) => ({ user_id: m.user_id, full_name: m.full_name }))
    : await getProjectEngineers(projectId);
  const isMember = s.memberProjectIds.includes(projectId);
  const filter = isTaskFilter(sp.filter) && ["open", "red", "overdue", "blocked", "done"].includes(sp.filter) ? sp.filter : null;
  const user = sp.user && members.some((m) => m.user_id === sp.user) ? sp.user : undefined;
  const now = Date.now();
  const { nodes, count, context } = filter || user
    ? pruneTree(tree, (n) => taskMatches(n, filter ?? "open", {}, { user, now }) || (!filter && n.assigned_to === user))
    : { nodes: tree, count: 0, context: [] as string[] };
  const person = user ? members.find((m) => m.user_id === user)?.full_name : null;
  return (
    <>
      {filter || user ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel/30 bg-steel-wash px-4 py-2 text-sm" data-testid="plan-filter">
          <span>Showing <strong>{filter ? filterLabel[filter] : "All tasks"}</strong>{person ? <> assigned to <strong>{person}</strong></> : null}
            {" · "}<span data-testid="record-count">{count} task{count === 1 ? "" : "s"}</span></span>
          <Link href={`/projects/${projectId}/tasks`} className="text-steel hover:underline">Clear filter</Link>
        </div>
      ) : null}
      <ProjectPlan nodes={nodes} caps={capsForTree(s, project, nodes)} projectId={projectId} meId={s.userId} assignees={assignees}
        canCreate={(manages || isMember) && !project.archived} managerView={manages} basePath={`/projects/${projectId}/tasks`}
        title={{ name: project.name, prepared: project.start_date ?? project.created_at }} context={context} />
    </>
  );
}
