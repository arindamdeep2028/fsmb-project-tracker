import "server-only";
import type { Session } from "@/lib/auth/session";
import { canManageProject, taskCaps, type TaskCaps } from "@/lib/auth/capabilities";
import type { TaskNode } from "@/types/domain";

/** Capabilities for every node of a tree (parents and subtasks). */
export function capsForTree(s: Session, project: { id: string; department_id: string }, roots: TaskNode[]): Record<string, TaskCaps> {
  const manages = canManageProject(s, project);
  const out: Record<string, TaskCaps> = {};
  const walk = (n: TaskNode) => { out[n.id] = taskCaps(s, n, manages, n.is_leaf); n.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}
