import { isIsoDate, type PerformanceRecords, type PerformanceSummary } from "@/lib/my-performance";
import type { PerformanceRow } from "@/lib/performance";
import type { Enums } from "@/types/database";

/**
 * One person's performance, opened by an Admin from the Performance overview (/performance/<id>). Decided in one
 * place so the page and its tests agree (tests/unit/person-performance.test.ts).
 *
 * Who may look: an Admin only. Anyone else is refused before anything is read — the route (middleware) and the
 * page (requireAdmin) refuse them first, and performance_summary refuses a non-admin in the database as well.
 * The figures are the person's row of performance_summary — the same numbers the overview shows for the same
 * dates; the records behind them are read for that person and the same dates.
 */
type QueryError = { code?: string; message?: string } | null;

export type Person = {
  id: string; full_name: string; login_name: string; role: Enums<"user_role">; active: boolean;
  department_id: string | null; department: string | null;
};

export type PersonPerformanceDeps = {
  today: string;
  /** default length of the window in days (workspace review window) */
  windowDays(): Promise<number | null>;
  /** first day of a window that ends today and is `days` long */
  daysAgo(days: number): string;
  person(id: string): Promise<{ data: Person | null; error: QueryError }>;
  summary(args: { p_from: string; p_to: string; p_department?: string }): Promise<{ data: PerformanceRow[] | null; error: QueryError }>;
  records(userId: string, from: string, to: string): Promise<{ records: PerformanceRecords; error: boolean }>;
};

export type PersonPerformanceView =
  | { status: "denied" }
  | { status: "notFound" }
  | {
    status: "ok"; from: string; to: string; person: Person;
    /** null when the figures could not be shown — see `error` */
    summary: PerformanceSummary | null;
    records: PerformanceRecords; recordsError: boolean;
    /** why no figures are shown, in words for the Admin; null when they loaded */
    error: string | null;
  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_RECORDS: PerformanceRecords = { assigned: [], completed: [], ontime: [], late: [], red: [], daily: [] };

export const PERSON_PERFORMANCE_ERRORS = {
  person: "This person's details couldn't be loaded. Try again in a minute.",
  failed: "The performance figures couldn't be loaded. Try again in a minute; if it keeps happening, check Data and jobs.",
  inactive: "This account is deactivated, so no score is calculated for it.",
};

/** Admin only — an Engineer, PM or Department Head never opens someone else's performance here. */
export const mayViewPersonPerformance = (viewer: { isAdmin: boolean }) => viewer.isAdmin === true;

export async function loadPersonPerformance(
  viewer: { isAdmin: boolean },
  userId: string,
  params: { from?: string; to?: string },
  deps: PersonPerformanceDeps,
): Promise<PersonPerformanceView> {
  if (!mayViewPersonPerformance(viewer)) return { status: "denied" };
  if (!UUID.test(userId)) return { status: "notFound" };

  // Same window rules as the overview: an empty or malformed date falls back to the default window.
  const to = isIsoDate(params.to) ? params.to : deps.today;
  let from = isIsoDate(params.from) ? params.from : deps.daysAgo((await deps.windowDays().catch(() => null)) ?? 90);
  if (from > to) from = to;

  const who = await deps.person(userId).catch((): { data: null; error: QueryError } => ({ data: null, error: { message: "unavailable" } }));
  if (!who.error && !who.data) return { status: "notFound" };
  if (who.error || !who.data) {
    const person: Person = { id: userId, full_name: "Unknown person", login_name: "", role: "engineer", active: false, department_id: null, department: null };
    return { status: "ok", from, to, person, summary: null, records: NO_RECORDS, recordsError: false, error: PERSON_PERFORMANCE_ERRORS.person };
  }
  const person = who.data;

  const [sum, rec] = await Promise.all([
    deps.summary({ p_from: from, p_to: to, ...(person.department_id ? { p_department: person.department_id } : {}) })
      .catch((): { data: null; error: QueryError } => ({ data: null, error: { message: "unavailable" } })),
    deps.records(userId, from, to).catch(() => ({ records: NO_RECORDS, error: true })),
  ]);
  const base = { status: "ok" as const, from, to, person, records: rec.records, recordsError: rec.error };
  if (sum.error || !sum.data) return { ...base, summary: null, error: PERSON_PERFORMANCE_ERRORS.failed };

  const row = sum.data.find((r) => r.user_id === userId);
  // performance_summary lists every active account (zeros included), so a missing row means a deactivated one.
  if (!row) return { ...base, summary: null, error: person.active ? PERSON_PERFORMANCE_ERRORS.failed : PERSON_PERFORMANCE_ERRORS.inactive };
  return {
    ...base, error: null,
    summary: {
      assigned: Number(row.assigned), completed: Number(row.completed), late: Number(row.late),
      on_time_pct: row.on_time_pct == null ? null : Number(row.on_time_pct),
      red_events: Number(row.red_events), daily_updates: Number(row.daily_updates), score: row.score,
    },
  };
}
