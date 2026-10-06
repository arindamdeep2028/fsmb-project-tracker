import { addDays, format, parseISO } from "date-fns";
import { dateRange, isOffDay, projectDayNumber } from "@/lib/sheet";

/**
 * Overdue daily reports: a required report for a past working day that was never saved.
 *
 * A report is required from a person for a project on a date when (the same rule the dashboards use for
 * "report expected today", applied to each past day):
 *   - the date is a working day (workspace_settings.workdays) before today, on or after the project's Day 1
 *     and the day the person joined the project,
 *   - the project is active and the person is a current, active member of it,
 *   - the person had a task or subtask in the project that was assigned by that date and still open at its end.
 * It is overdue when no daily report is saved for that person, project and date. Nothing is stored: the list
 * is derived from saved data on every read, so a saved report removes its entry and no entry repeats.
 * All dates are Dhaka calendar dates ("yyyy-MM-dd").
 */
export const OVERDUE_LOOKBACK_DAYS = 30;

export type OverdueItem = {
  key: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  userId: string;
  fullName: string;
  date: string;
  dayNo: number | null;
};

export type OverdueInput = {
  today: string;
  workdays?: number[];
  lookbackDays?: number;
  projects: { id: string; code: string; name: string; start: string }[];
  members: { project_id: string; user_id: string; full_name: string; added: string }[];
  /** `completed`: the date the task was completed, null while it is open */
  tasks: { project_id: string; assigned_to: string; assigned: string; completed: string | null }[];
  reports: { project_id: string; user_id: string; report_date: string }[];
};

export const overdueKey = (projectId: string, userId: string, date: string) => `${projectId}|${userId}|${date}`;

/** First date the overdue list looks at. */
export function overdueWindowStart(today: string, lookbackDays = OVERDUE_LOOKBACK_DAYS): string {
  return format(addDays(parseISO(today), -lookbackDays), "yyyy-MM-dd");
}

/** Newest date first, then project code and person. */
export function overdueReports(input: OverdueInput): OverdueItem[] {
  const yesterday = format(addDays(parseISO(input.today), -1), "yyyy-MM-dd");
  const windowStart = overdueWindowStart(input.today, input.lookbackDays);
  const saved = new Set(input.reports.map((r) => overdueKey(r.project_id, r.user_id, r.report_date)));
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const tasksOf = new Map<string, OverdueInput["tasks"]>();
  for (const t of input.tasks) {
    const k = `${t.project_id}|${t.assigned_to}`;
    tasksOf.set(k, [...(tasksOf.get(k) ?? []), t]);
  }
  const seen = new Set<string>();
  const out: OverdueItem[] = [];
  for (const m of input.members) {
    const p = projects.get(m.project_id);
    const tasks = tasksOf.get(`${m.project_id}|${m.user_id}`);
    if (!p || !tasks) continue;
    const from = [windowStart, p.start, m.added].sort().at(-1)!;
    for (const date of dateRange(from, yesterday)) {
      if (isOffDay(date, input.workdays)) continue;
      if (!tasks.some((t) => t.assigned <= date && (t.completed === null || t.completed > date))) continue;
      const key = overdueKey(p.id, m.user_id, date);
      if (saved.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, projectId: p.id, projectCode: p.code, projectName: p.name, userId: m.user_id, fullName: m.full_name, date, dayNo: projectDayNumber(p.start, date) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.projectCode.localeCompare(b.projectCode) || a.fullName.localeCompare(b.fullName));
}
