import type { Enums } from "@/types/database";

export type Signal = "red" | "amber" | "green" | "neutral" | "done";

/** The signal rail: one colour language for deadline state across the app. */
export function deadlineSignal(status: string | null | undefined, isRed?: boolean | null): Signal {
  if (isRed) return "red";
  switch (status) {
    case "overdue":
    case "plan_overdue":
    case "completed_late":
      return "red";
    case "due_soon":
    case "due_today":
      return "amber";
    case "completed_on_time":
      return "done";
    case "on_track":
      return "green";
    default:
      return "neutral";
  }
}

export const deadlineStatusLabel: Record<string, string> = {
  overdue: "Overdue",
  plan_overdue: "Plan overdue",
  due_soon: "Due soon",
  due_today: "Due today",
  on_track: "On track",
  completed_on_time: "Done on time",
  completed_late: "Done late",
};

export const breachLabel: Record<Enums<"breach_reason">, string> = {
  plan_missing: "Plan not submitted within 3 office hours",
  exec_overdue: "Execution deadline passed",
  daily_update_missing: "No daily update today",
  completed_late: "Completed after the deadline",
};

export const roleLabel: Record<Enums<"user_role">, string> = {
  admin: "Admin",
  dept_head: "Department Head",
  pm: "Project Manager",
  engineer: "Engineer",
};

export const notificationLabel: Record<Enums<"notification_type">, string> = {
  task_assigned: "Task assigned",
  deadline_approaching: "Deadline approaching",
  task_overdue: "Overdue",
  pm_comment: "Manager comment",
  status_changed: "Status changed",
};

export const PRIORITIES: Enums<"task_priority">[] = ["Important", "High", "Normal", "Low"];
export const PROJECT_STATUSES: Enums<"project_status">[] = ["Active", "On hold", "Completed", "Cancelled"];

export function scoreBand(score: number | null | undefined): { label: string; signal: Signal } {
  if (score == null) return { label: "No score yet", signal: "neutral" };
  if (score >= 80) return { label: "Strong", signal: "green" };
  if (score >= 60) return { label: "Acceptable", signal: "amber" };
  return { label: "Needs discussion", signal: "red" };
}
