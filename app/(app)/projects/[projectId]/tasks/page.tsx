import { projectContext } from "@/lib/auth/project-guard";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { getMembers, getProjectEngineers } from "@/lib/data/projects";
import { capsForTree } from "@/lib/auth/task-caps";
import { TaskTree } from "@/components/tasks/task-tree";

/** Responsibilities: the full task tree with calculated progress, flags and row actions. */
export default async function ProjectTasksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { s, project, manages } = await projectContext(projectId);
  const nodes = await getProjectTaskTree(projectId);
  // Managers assign to any current member; engineers to themselves or an engineer member (v2 §8).
  const assignees = manages
    ? (await getMembers(projectId)).map((m) => ({ user_id: m.user_id, full_name: m.full_name }))
    : await getProjectEngineers(projectId);
  const isMember = s.memberProjectIds.includes(projectId);
  return (
    <TaskTree nodes={nodes} caps={capsForTree(s, project, nodes)} projectId={projectId} meId={s.userId} assignees={assignees}
      canCreate={(manages || isMember) && !project.archived} managerView={manages} basePath={`/projects/${projectId}/tasks`} />
  );
}
