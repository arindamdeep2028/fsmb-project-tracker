/**
 * The Performance page's data, decided in one place so the page and its tests agree (tests/unit/performance.test.ts).
 *
 * Whose scores: an Admin reads every department, or one of them. A Department Head reads one department they
 * head — the one asked for if it is theirs, otherwise the first they head; never "all" and never someone
 * else's (performance_summary refuses both in the database as well, so a wrong id cannot leak rows).
 * A query that fails is reported as a failure. Only a query that succeeds with no rows is "no activity".
 */
type QueryError = { code?: string; message?: string } | null;
export type Department = { id: string; name: string };
export type PerformanceRow = {
  user_id: string; full_name: string; department: string; assigned: number; completed: number; late: number;
  on_time_pct: number | null; red_events: number; daily_updates: number; score: number | null;
};

export type PerformanceDeps = {
  today: string;
  /** default length of the window in days (workspace review window) */
  windowDays(): Promise<number | null>;
  /** first day of a window that ends today and is `days` long */
  daysAgo(days: number): string;
  departments(): Promise<{ data: Department[] | null; error: QueryError }>;
  summary(args: { p_from: string; p_to: string; p_department?: string }): Promise<{ data: PerformanceRow[] | null; error: QueryError }>;
};

export type PerformanceView = {
  from: string;
  to: string;
  /** the departments this viewer may choose */
  departments: Department[];
  /** the department shown; null = all departments (Admin only) */
  departmentId: string | null;
  /** null when the scores could not be loaded — see `error` */
  rows: PerformanceRow[] | null;
  /** why nothing is shown, in words for the user; null when the scores loaded */
  error: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (v: string | undefined): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

export const PERFORMANCE_ERRORS = {
  departments: "The department list couldn't be loaded, so no scores are shown. Try again in a minute.",
  noDepartment: "You don't head a department yet, so there are no scores to show. Ask your admin to check your department.",
  denied: "You don't have permission to see this department's performance.",
  failed: "The performance scores couldn't be loaded. Try again in a minute; if it keeps happening, tell your admin.",
};

/** Which department to show. `allowed`: the departments this viewer may choose (already limited for a Head). */
export function chooseDepartment(viewer: { isAdmin: boolean }, allowed: Department[], requested: string | undefined): string | null {
  const wanted = requested && UUID.test(requested) ? allowed.find((d) => d.id === requested)?.id : undefined;
  if (wanted) return wanted;
  return viewer.isAdmin ? null : allowed[0]?.id ?? null;
}

export async function loadPerformance(
  viewer: { isAdmin: boolean; headedDepartmentIds: string[] },
  params: { from?: string; to?: string; dept?: string },
  deps: PerformanceDeps,
): Promise<PerformanceView> {
  // an empty or malformed date (a cleared date field sends "") falls back to the default window
  const to = validDate(params.to) ? params.to : deps.today;
  let from = validDate(params.from) ? params.from : deps.daysAgo((await deps.windowDays().catch(() => null)) ?? 90);
  if (from > to) from = to;

  const base = { from, to, departments: [] as Department[], departmentId: null as string | null, rows: null as PerformanceRow[] | null };
  const all = await deps.departments().catch((): { data: null; error: QueryError } => ({ data: null, error: { message: "unavailable" } }));
  if (all.error || !all.data) return { ...base, error: PERFORMANCE_ERRORS.departments };
  const departments = all.data.filter((d) => viewer.isAdmin || viewer.headedDepartmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name }));
  const departmentId = chooseDepartment(viewer, departments, params.dept);
  if (!viewer.isAdmin && !departmentId) return { ...base, departments, error: PERFORMANCE_ERRORS.noDepartment };

  const res = await deps.summary({ p_from: from, p_to: to, ...(departmentId ? { p_department: departmentId } : {}) })
    .catch((): { data: null; error: QueryError } => ({ data: null, error: { message: "unavailable" } }));
  if (res.error || !res.data) {
    return { ...base, departments, departmentId, error: res.error?.code === "42501" ? PERFORMANCE_ERRORS.denied : PERFORMANCE_ERRORS.failed };
  }
  return { from, to, departments, departmentId, rows: res.data, error: null };
}
