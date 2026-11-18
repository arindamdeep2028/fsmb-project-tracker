import type { Metadata } from "next";
import { projectContext } from "@/lib/auth/project-guard";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { getMembers } from "@/lib/data/projects";
import { createClient } from "@/lib/supabase/server";
import { phaseChoices, tasklistRows, type Category, type SheetRow, type TasklistTask } from "@/lib/tasklist";
import { Tasklist } from "@/components/tasks/tasklist";
import type { TaskNode } from "@/types/domain";

export const metadata: Metadata = { title: "Tasklist" };

/**
 * Tasklist: the project's real tasks in the team's sheet layout (phases, Task, Assigned Person, Status, Comments,
 * Priority), plus rows added on the Tasklist itself. Everyone who can see the project reads it (RLS). Every current
 * member of the project and its managers edit it while the project is not archived: task names, status, priority,
 * people and comments, and the added rows (migration 28). The database checks each change again.
 */
export default async function TasklistPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId: id } = await params;
  const { s, project, manages } = await projectContext(id);
  // taken before any data is read: the Tasklist drops a load that started before its latest save
  const loadedAt = new Date().toISOString();
  const supabase = await createClient();
  const [tree, members, sheet] = await Promise.all([
    getProjectTaskTree(id), getMembers(id, true),
    supabase.from("tasklist_rows").select("id, phase_task_id, position, title, status, priority, comment, category").eq("project_id", id).order("position"),
  ]);
  const flat: TaskNode[] = tree.flatMap((t) => [t, ...t.children]);
  const ids = flat.map((t) => t.id);
  const rowIds = (sheet.data ?? []).map((r) => r.id);
  const [extra, notes, cats, rowPeople] = await Promise.all([
    ids.length ? supabase.from("task_assignees").select("task_id, user_id, person:profiles!task_assignees_user_id_fkey(full_name)").in("task_id", ids).order("added_at") : null,
    ids.length ? supabase.from("task_list_comments").select("task_id, body").in("task_id", ids) : null,
    ids.length ? supabase.from("task_list_categories").select("task_id, category").in("task_id", ids) : null,
    rowIds.length ? supabase.from("tasklist_row_assignees").select("row_id, user_id, person:profiles!tasklist_row_assignees_user_id_fkey(full_name)").in("row_id", rowIds).order("added_at") : null,
  ]);

  const current = members.filter((m) => !m.removed_at);
  const nameOf = new Map(members.map((m) => [m.user_id, m.full_name]));
  const person = (userId: string, joined?: string | null) => ({ id: userId, name: joined || nameOf.get(userId) || "Former member" });
  const assignees: Record<string, { id: string; name: string }[]> = {};
  for (const a of extra?.data ?? []) (assignees[a.task_id] ??= []).push(person(a.user_id, a.person?.full_name));
  for (const a of rowPeople?.data ?? []) (assignees[a.row_id] ??= []).push(person(a.user_id, a.person?.full_name));
  const comments = Object.fromEntries((notes?.data ?? []).map((n) => [n.task_id, n.body]));
  // General Task / Urgent Task of each existing task (no row = General Task)
  const categories: Record<string, Category> = Object.fromEntries((cats?.data ?? []).map((c) => [c.task_id, c.category === "Urgent" ? "Urgent" : "General"]));

  const isMember = current.some((m) => m.user_id === s.userId);
  const canEdit = !project.archived && (manages || isMember);
  const toRow = (t: TaskNode): TasklistTask => ({
    id: t.id, code: t.code, title: t.title, parent_id: t.parent_id, status: t.status, priority: t.priority,
    assigned_to: t.assigned_to, assignee_name: t.assignee_name, created_by: t.created_by, contribution_locked: t.contribution_locked,
    is_leaf: t.is_leaf, children: t.children.map(toRow),
  });
  const roots = tree.map(toRow);
  const rows: SheetRow[] = (sheet.data ?? []).map((r) => ({
    id: r.id, phaseId: r.phase_task_id, position: r.position, title: r.title, status: r.status, priority: r.priority, comment: r.comment,
    category: r.category === "Urgent" ? "Urgent" : "General",
  }));
  return (
    <Tasklist projectId={id} projectName={`${project.code} ${project.name}`}
      data={{ loadedAt, rows: tasklistRows(roots, rows), phases: phaseChoices(roots), assignees, comments, categories }}
      people={current.map((m) => ({ id: m.user_id, name: m.full_name }))}
      canEdit={canEdit} archived={project.archived} canExport={manages} />
  );
}
