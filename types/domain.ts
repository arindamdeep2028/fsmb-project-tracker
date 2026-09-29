import type { Enums, Fn, Tables, Views } from "@/types/database";

/** Shapes of the JSON returned by the dashboard RPCs (rows of the views they aggregate). */
export type EngineerTask = Views<"v_engineer_tasks">;
export type EngineerProject = Views<"v_engineer_project_progress">;
export type ProjectMetrics = Views<"v_pm_projects">;
export type TeamUpdate = Views<"v_pm_team_updates">;
export type TeamLoad = Views<"v_pm_team_load">;
export type DepartmentSummary = Views<"v_department_summary"> & {
  completed_in_window?: number; on_time_pct?: number | null; extensions_in_window?: number; red_mark_events?: number;
};
export type AdminOverview = Views<"v_admin_overview">;
export type PerformanceRow = Fn<"performance_summary">["Returns"][number];
export type ProjectPerformanceRow = Fn<"project_performance">["Returns"][number];

export type MyDashboard = {
  assigned_tasks: EngineerTask[];
  pending_tasks: EngineerTask[];
  deadlines: { task_id: string; code: string; title: string; project_code: string; effective_due_at: string; plan_due_at: string | null; deadline_status: string }[];
  projects: EngineerProject[];
  overall_completion_pct: number | null;
  red_now: number;
  on_time: number;
  late: number;
  report_expected_today: boolean;
  progress_trend_30d: { day: string; delivered_points: number }[];
};
export type MyProjectsDashboard = {
  projects: ProjectMetrics[];
  blocked_tasks: { task_id: string; code: string; title: string; assigned_to: string; blocker_note: string | null }[];
  team_updates: TeamUpdate[];
  team_load: TeamLoad[];
  missing_reports: { project_code: string; user_id: string; full_name: string }[];
};
export type DepartmentDashboard = {
  department: DepartmentSummary | null;
  projects: ProjectMetrics[];
  people: PerformanceRow[];
  window: { from: string; to: string; department_id: string };
};
export type AdminDashboard = {
  overview: AdminOverview | null;
  departments: DepartmentSummary[];
  projects: ProjectMetrics[];
  jobs: { job: string; last_run: string | null; last_error: string | null }[];
};

export type TaskRow = Tables<"tasks">;
export type TaskNode = TaskRow & {
  assignee_name: string | null;
  is_leaf: boolean;
  calculated_progress: number | null;
  effective_weight: number | null;
  is_red: boolean;
  reasons: Enums<"breach_reason">[];
  deadline_status: string | null;
  children: TaskNode[];
};
export type Member = {
  user_id: string; member_role: Enums<"project_member_role">; full_name: string; role: Enums<"user_role">; removed_at: string | null;
};
