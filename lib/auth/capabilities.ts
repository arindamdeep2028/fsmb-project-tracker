import type { Session } from "@/lib/auth/session";
import type { Enums, Tables } from "@/types/database";

/**
 * UI capabilities. They mirror the database rules (RLS + tasks_before_write in migrations 12 and 19)
 * only to decide which controls to show; the database enforces every rule regardless.
 */
type ProjectRef = { id: string; department_id: string };
type TaskRef = Pick<Tables<"tasks">, "project_id" | "assigned_to" | "created_by" | "status" | "contribution_locked">;
export type TaskStatus = Enums<"task_status">;

export function canManageProject(s: Session, p: ProjectRef): boolean {
  return s.isAdmin || s.pmProjectIds.includes(p.id) || s.headedDepartmentIds.includes(p.department_id);
}
export function canCreateProject(s: Session): boolean {
  return s.isAdmin || s.headedDepartmentIds.length > 0;
}
export function canEditProjectStructure(s: Session, p: ProjectRef): boolean {
  // code, department, lead PM, archive: Department Head or Admin (projects trigger)
  return s.isAdmin || s.headedDepartmentIds.includes(p.department_id);
}
/**
 * Project roles a person can hold (project_members trigger): Engineer for engineer / PM accounts, PM for
 * PM / Department Head / Admin accounts. Only an Admin or the project's Department Head (`canAddPm`) adds,
 * changes or removes PM members; a project PM manages engineer members.
 */
export function projectRolesFor(role: Enums<"user_role">, canAddPm: boolean): Enums<"project_member_role">[] {
  return [
    ...(role === "engineer" || role === "pm" ? ["engineer" as const] : []),
    ...(role !== "engineer" && canAddPm ? ["pm" as const] : []),
  ];
}
export function canExportCsv(s: Session): boolean {
  return s.isAdmin || s.headedDepartmentIds.length > 0 || s.pmProjectIds.length > 0;
}
/**
 * Daily report lists: an Admin, Department Head or Project Manager reads newest date first; an Engineer reads
 * oldest first, from Day 1.
 */
export function reportOrder(s: Session): "asc" | "desc" {
  return canExportCsv(s) || s.profile.role !== "engineer" ? "desc" : "asc";
}

const FORWARD: Record<TaskStatus, TaskStatus[]> = {
  "Not started": ["Plan submitted", "In progress", "Blocked", "Completed"],
  "Plan submitted": ["In progress", "Blocked", "Completed"],
  "In progress": ["Blocked", "Completed"],
  Blocked: ["In progress", "Completed"],
  Completed: [],
};
export const ALL_STATUSES: TaskStatus[] = ["Not started", "Plan submitted", "In progress", "Blocked", "Completed"];

export type TaskCaps = {
  manager: boolean;
  /**
   * a current member of the task's project working on their OWN task (assigned to them or created by them): an
   * engineer edits every Responsibilities cell of it but End Date (member_update_task). For a manager: membership.
   */
  member: boolean;
  isAssignee: boolean;
  statuses: TaskStatus[];
  progress: boolean;
  priority: boolean;
  contribution: boolean;
  titleAndAssignee: boolean;
  deadline: boolean;
  lockContribution: boolean;
  archive: boolean;
  remove: boolean;
  comment: boolean;
};

/** Which cells of an existing Responsibilities row a viewer may edit in place (spreadsheet view). */
export type CellCaps = {
  title: boolean; assignee: boolean; remarks: boolean; endDate: boolean; priority: boolean; progress: boolean;
  /** statuses offered in the Status dropdown (Completed goes through Mark Done, which checks open subtasks) */
  statuses: TaskStatus[];
};

/**
 * Which cells of an existing Responsibilities row a viewer edits in place (migration 32):
 *   Admin, project PM, Department Head   every cell
 *   engineer member of the project       every cell but End Date, on their own tasks only (assigned to them or
 *                                        created by them); a colleague's task is read-only (member_update_task)
 *   anyone else                          their existing rights (e.g. the assignee of a project they have left)
 * Every user who may change a status may also move a Completed task back to any other status. Progress is typed
 * only on a task without subtasks that is not Completed (a parent's progress is calculated).
 */
export function cellCaps(c: TaskCaps | undefined, t: { status: TaskStatus; isLeaf: boolean }): CellCaps {
  const done = t.status === "Completed";
  if (!c) return { title: false, assignee: false, remarks: false, endDate: false, priority: false, progress: false, statuses: [] };
  const all = c.manager || c.member;
  return {
    title: all || c.titleAndAssignee,
    assignee: all || c.titleAndAssignee,
    remarks: all || c.titleAndAssignee,
    endDate: c.manager && c.deadline && !done,
    priority: all || c.priority,
    progress: (all || c.progress) && t.isLeaf && !done,
    statuses: c.statuses.filter((s) => s !== "Completed"),
  };
}

/**
 * The statuses a daily report may set (the report applies them as its author, through the role rules of the
 * task triggers): a manager any, the assignee forward only. Reopening is done from the Status dropdown.
 */
export function reportStatuses(s: Session, t: TaskRef, managesProject: boolean): TaskStatus[] {
  if (managesProject) return ALL_STATUSES.filter((x) => x !== t.status);
  return t.assigned_to === s.userId ? FORWARD[t.status] : [];
}

export function taskCaps(s: Session, t: TaskRef, managesProject: boolean, isLeaf: boolean): TaskCaps {
  const me = s.userId;
  const isAssignee = t.assigned_to === me;
  const isCreator = t.created_by === me;
  if (managesProject) {
    return {
      manager: true, member: s.memberProjectIds.includes(t.project_id), isAssignee, statuses: ALL_STATUSES.filter((x) => x !== t.status), progress: isLeaf,
      priority: true, contribution: true, titleAndAssignee: true, deadline: true, lockContribution: true,
      archive: true, remove: s.isAdmin, comment: true,
    };
  }
  const notStarted = t.status === "Not started";
  // an engineer works on their own tasks only (assigned to them or created by them), never on a colleague's
  const ownMember = s.memberProjectIds.includes(t.project_id) && (isAssignee || isCreator);
  return {
    manager: false,
    member: ownMember,
    isAssignee,
    // Status: on their own task an engineer member sets any status, reopening a Completed task included
    // (member_update_task checks it again). Someone no longer a member keeps the forward moves on a task still
    // assigned to them; a colleague's task offers no status change.
    statuses: ownMember ? ALL_STATUSES.filter((x) => x !== t.status) : isAssignee ? FORWARD[t.status] : [],
    progress: isAssignee && isLeaf && t.status !== "Completed",
    priority: isAssignee,
    contribution: (isAssignee || isCreator) && !t.contribution_locked,
    titleAndAssignee: isCreator && notStarted,
    deadline: false,
    lockContribution: false,
    archive: false,
    remove: false,
    comment: isAssignee || isCreator,
  };
}
