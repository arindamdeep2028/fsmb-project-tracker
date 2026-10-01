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

export function taskCaps(s: Session, t: TaskRef, managesProject: boolean, isLeaf: boolean): TaskCaps {
  const me = s.userId;
  const isAssignee = t.assigned_to === me;
  const isCreator = t.created_by === me;
  if (managesProject) {
    return {
      manager: true, isAssignee, statuses: ALL_STATUSES.filter((x) => x !== t.status), progress: isLeaf,
      priority: true, contribution: true, titleAndAssignee: true, deadline: true, lockContribution: true,
      archive: true, remove: s.isAdmin, comment: true,
    };
  }
  const notStarted = t.status === "Not started";
  return {
    manager: false,
    isAssignee,
    statuses: isAssignee ? FORWARD[t.status] : [],
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
