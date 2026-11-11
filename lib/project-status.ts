import type { Enums } from "@/types/database";

/**
 * Project categories and lifecycle (migration 24). The database keeps the original status values so every view,
 * dashboard and performance figure reads them unchanged; the app shows them as Running / Halted / Completed.
 * The allowed changes mirror app.projects_status_guard(); the database enforces them regardless.
 */
export type ProjectStatus = Enums<"project_status">;
export type ProjectCategory = Enums<"project_category">;

export const PROJECT_CATEGORIES: ProjectCategory[] = ["Software", "Embedded", "Optical", "Mechanical"];

export function parseCategory(v: string | null | undefined): ProjectCategory | undefined {
  return PROJECT_CATEGORIES.find((c) => c.toLowerCase() === (v ?? "").toLowerCase());
}

/** Status filter keys used in the Projects page URL (?status=running). */
export type LifecycleKey = "running" | "halted" | "completed";
export const LIFECYCLE: { key: LifecycleKey; label: string; status: ProjectStatus }[] = [
  { key: "running", label: "Running", status: "Active" },
  { key: "halted", label: "Halted", status: "On hold" },
  { key: "completed", label: "Completed", status: "Completed" },
];

/** Accepts the filter keys and, for dashboard links made before migration 24, the stored values (?status=Active). */
export function parseLifecycle(v: string | null | undefined): LifecycleKey | undefined {
  const s = (v ?? "").toLowerCase();
  return LIFECYCLE.find((l) => l.key === s || l.status.toLowerCase() === s)?.key;
}

export function lifecycleOf(status: ProjectStatus): LifecycleKey | undefined {
  return LIFECYCLE.find((l) => l.status === status)?.key;
}

export function projectStatusLabel(status: ProjectStatus): string {
  return LIFECYCLE.find((l) => l.status === status)?.label ?? status;
}

/** Running: green · Halted: orange · Completed (and the retired Cancelled): neutral grey. */
export function projectStatusTone(status: ProjectStatus): "running" | "halted" | "closed" {
  return status === "Active" ? "running" : status === "On hold" ? "halted" : "closed";
}

/** Statuses a project may move to from `from`. */
export function nextStatuses(from: ProjectStatus): ProjectStatus[] {
  switch (from) {
    case "Active": return ["On hold", "Completed"];
    case "On hold": return ["Active", "Completed"];
    case "Completed": return ["Active"];
    default: return [];
  }
}

/** Menu wording for a status change. */
export function transitionLabel(_from: ProjectStatus, to: ProjectStatus): string {
  return `Set as ${projectStatusLabel(to)}`;
}
