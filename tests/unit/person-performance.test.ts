import { describe, expect, it, vi } from "vitest";
import { loadPersonPerformance, mayViewPersonPerformance, PERSON_PERFORMANCE_ERRORS, type Person, type PersonPerformanceDeps } from "@/lib/person-performance";
import type { PerformanceRow } from "@/lib/performance";
import type { PerformanceRecords, PerformanceTask } from "@/lib/my-performance";
import { routeFor } from "@/lib/auth/routing";

const DEEP = "a0000000-0000-4000-8000-000000000001", IMAM = "a0000000-0000-4000-8000-000000000002", IDLE = "a0000000-0000-4000-8000-000000000003";
const GONE = "a0000000-0000-4000-8000-000000000004", RND = "d0000000-0000-4000-8000-000000000005";
const admin = { isAdmin: true }, engineer = { isAdmin: false }, head = { isAdmin: false };

const person = (id: string, full_name: string, over: Partial<Person> = {}): Person =>
  ({ id, full_name, login_name: full_name.toLowerCase(), role: "engineer", active: true, department_id: RND, department: "R&D", ...over });
const PEOPLE: Record<string, Person> = {
  [DEEP]: person(DEEP, "DEEP"), [IMAM]: person(IMAM, "Imam"), [IDLE]: person(IDLE, "Idle", { department_id: null, department: null }),
  [GONE]: person(GONE, "Gone", { active: false }),
};
const row = (user_id: string, full_name: string, over: Partial<PerformanceRow> = {}): PerformanceRow => ({
  user_id, full_name, department: "R&D", assigned: 0, completed: 0, late: 0, on_time_pct: null, red_events: 0, daily_updates: 0, score: null, ...over,
});
// performance_summary: every ACTIVE account, zeros included; refuses a non-admin with no department (as in SQL).
const ROWS = [
  row(DEEP, "DEEP", { assigned: 5, completed: 4, late: 1, on_time_pct: 75, red_events: 2, daily_updates: 9, score: 70 }),
  row(IMAM, "Imam", { assigned: 2, completed: 2, on_time_pct: 100, daily_updates: 3, score: 100 }),
  row(IDLE, "Idle", { department: "" }),
];
const task = (id: string): PerformanceTask => ({
  id, code: id, title: id, type: "Task" as PerformanceTask["type"], status: "Completed", progress_pct: 100, assigned_on: "2026-09-01T04:00:00Z",
  completed_on: "2026-09-02T04:00:00Z", effective_due_at: "2026-09-03T04:00:00Z", project_id: "p", project_code: "P", project_name: "P",
});
const recordsOf = (id: string): PerformanceRecords => ({ assigned: [task(`${id}-t`)], completed: [], ontime: [], late: [], red: [], daily: [] });

function deps(viewer: { isAdmin: boolean }, over: Partial<PersonPerformanceDeps> = {}): PersonPerformanceDeps {
  return {
    today: "2026-10-06",
    windowDays: vi.fn(async () => 90),
    daysAgo: (n) => new Date(Date.parse("2026-10-06T00:00:00Z") - n * 864e5).toISOString().slice(0, 10),
    person: vi.fn(async (id: string) => ({ data: PEOPLE[id] ?? null, error: null })),
    summary: vi.fn(async (args) => {
      if (!viewer.isAdmin && !args.p_department) return { data: null, error: { code: "42501", message: "Only admins…" } };
      return { data: ROWS.filter((r) => !args.p_department || PEOPLE[r.user_id]?.department_id === args.p_department), error: null };
    }),
    records: vi.fn(async (id: string) => ({ records: recordsOf(id), error: false })),
    ...over,
  };
}

describe("Admin opens one person's performance", () => {
  it("shows the chosen person's own figures and records, not the Admin's", async () => {
    const d = deps(admin);
    const v = await loadPersonPerformance(admin, DEEP, { from: "2026-07-01", to: "2026-09-30" }, d);
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.person.full_name).toBe("DEEP");
    expect(v.summary).toEqual({ assigned: 5, completed: 4, late: 1, on_time_pct: 75, red_events: 2, daily_updates: 9, score: 70 });
    expect(d.records).toHaveBeenCalledWith(DEEP, "2026-07-01", "2026-09-30");
    expect(v.records.assigned.map((t) => t.id)).toEqual([`${DEEP}-t`]);
    expect(v.error).toBeNull();
  });
  it("the chosen dates drive both the figures and the records", async () => {
    const d = deps(admin);
    await loadPersonPerformance(admin, IMAM, { from: "2026-08-01", to: "2026-08-31" }, d);
    expect(d.summary).toHaveBeenCalledWith({ p_from: "2026-08-01", p_to: "2026-08-31", p_department: RND });
    expect(d.records).toHaveBeenCalledWith(IMAM, "2026-08-01", "2026-08-31");
  });
  it("no dates: the workspace review window ending today, as on the overview", async () => {
    const v = await loadPersonPerformance(admin, IMAM, {}, deps(admin));
    expect(v).toMatchObject({ status: "ok", from: "2026-07-08", to: "2026-10-06" });
  });
  it("bad dates fall back; from after to is clamped", async () => {
    expect(await loadPersonPerformance(admin, IMAM, { from: "2026-02-31", to: "nope" }, deps(admin))).toMatchObject({ from: "2026-07-08", to: "2026-10-06" });
    expect(await loadPersonPerformance(admin, IMAM, { from: "2026-09-10", to: "2026-09-01" }, deps(admin))).toMatchObject({ from: "2026-09-01", to: "2026-09-01" });
  });
  it("two people one after the other: no figures or records mixed", async () => {
    const d = deps(admin);
    const a = await loadPersonPerformance(admin, DEEP, {}, d), b = await loadPersonPerformance(admin, IMAM, {}, d);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("expected ok");
    expect(a.summary?.score).toBe(70); expect(b.summary?.score).toBe(100);
    expect(a.records.assigned[0].id).toBe(`${DEEP}-t`); expect(b.records.assigned[0].id).toBe(`${IMAM}-t`);
  });
  it("someone with no activity (and no department) still opens, with zeros and no score", async () => {
    const d = deps(admin, { records: vi.fn(async () => ({ records: { assigned: [], completed: [], ontime: [], late: [], red: [], daily: [] }, error: false })) });
    const v = await loadPersonPerformance(admin, IDLE, {}, d);
    expect(d.summary).toHaveBeenCalledWith({ p_from: "2026-07-08", p_to: "2026-10-06" });   // no department: all, then pick the person
    expect(v).toMatchObject({ status: "ok", error: null, summary: { assigned: 0, completed: 0, late: 0, on_time_pct: null, red_events: 0, daily_updates: 0, score: null } });
  });
  it("an unknown or malformed id is 'not found' — nothing about anyone else is read", async () => {
    const d = deps(admin);
    expect(await loadPersonPerformance(admin, "a0000000-0000-4000-8000-0000000000ff", {}, d)).toEqual({ status: "notFound" });
    expect(await loadPersonPerformance(admin, "not-a-uuid", {}, d)).toEqual({ status: "notFound" });
    expect(d.summary).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
  });
  it("a deactivated account opens with a message instead of figures", async () => {
    const v = await loadPersonPerformance(admin, GONE, {}, deps(admin));
    expect(v).toMatchObject({ status: "ok", summary: null, error: PERSON_PERFORMANCE_ERRORS.inactive });
  });
  it("a failed figures query is an error, never zeros", async () => {
    const v = await loadPersonPerformance(admin, DEEP, {}, deps(admin, { summary: vi.fn(async () => ({ data: null, error: { message: "boom" } })) }));
    expect(v).toMatchObject({ status: "ok", summary: null, error: PERSON_PERFORMANCE_ERRORS.failed });
  });
  it("records that fail to load are flagged (the dialogs say so)", async () => {
    const v = await loadPersonPerformance(admin, DEEP, {}, deps(admin, { records: vi.fn(async () => { throw new Error("down"); }) }));
    expect(v).toMatchObject({ status: "ok", recordsError: true, error: null });
  });
});

describe("Access: only an Admin opens someone else's performance", () => {
  it("an Engineer or Department Head is refused before anything is read", async () => {
    for (const viewer of [engineer, head]) {
      const d = deps(viewer);
      expect(await loadPersonPerformance(viewer, DEEP, {}, d)).toEqual({ status: "denied" });
      expect(d.person).not.toHaveBeenCalled(); expect(d.summary).not.toHaveBeenCalled(); expect(d.records).not.toHaveBeenCalled();
    }
    expect(mayViewPersonPerformance(admin)).toBe(true);
    expect(mayViewPersonPerformance(engineer)).toBe(false);
  });
  it("the route /performance/<id> is Admin-only in the middleware; /performance and /my-performance are as before", () => {
    const base = { signedIn: true, active: true, mustChangePassword: false };
    for (const role of ["engineer", "pm", "dept_head", undefined]) {
      expect(routeFor({ ...base, role, path: `/performance/${DEEP}` })).toEqual({ do: "landing" });
    }
    expect(routeFor({ ...base, role: "admin", path: `/performance/${DEEP}` })).toEqual({ do: "pass" });
    expect(routeFor({ ...base, role: "dept_head", path: "/performance" })).toEqual({ do: "pass" });
    expect(routeFor({ ...base, role: "engineer", path: "/performance" })).toEqual({ do: "landing" });
    expect(routeFor({ ...base, role: "engineer", path: "/my-performance" })).toEqual({ do: "pass" });
  });
});
