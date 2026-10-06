import { describe, expect, it, vi } from "vitest";
import { chooseDepartment, loadPerformance, PERFORMANCE_ERRORS, type PerformanceDeps, type PerformanceRow } from "@/lib/performance";

const RND = "d0000000-0000-4000-8000-000000000005", MECH = "d0000000-0000-4000-8000-000000000002", SOFT = "d0000000-0000-4000-8000-000000000003";
const DEPARTMENTS = [{ id: MECH, name: "Mechanical" }, { id: RND, name: "R&D" }, { id: SOFT, name: "Software" }];
const head = { isAdmin: false, headedDepartmentIds: [RND] };
const admin = { isAdmin: true, headedDepartmentIds: [] };
const person = (full_name: string, over: Partial<PerformanceRow> = {}): PerformanceRow => ({
  user_id: `u-${full_name}`, full_name, department: "R&D", assigned: 0, completed: 0, late: 0, on_time_pct: null, red_events: 0, daily_updates: 0, score: null, ...over,
});

/** The database stand-in: like performance_summary, it refuses a non-admin without a department they head. */
function deps(viewer: { isAdmin: boolean; headedDepartmentIds: string[] }, rows: Record<string, PerformanceRow[]>, over: Partial<PerformanceDeps> = {}): PerformanceDeps {
  return {
    today: "2026-10-06",
    windowDays: vi.fn(async () => 90),
    daysAgo: (n) => new Date(Date.parse("2026-10-06T00:00:00Z") - n * 864e5).toISOString().slice(0, 10),   // 90 days → 2026-07-08
    departments: vi.fn(async () => ({ data: DEPARTMENTS, error: null })),
    summary: vi.fn(async (args) => {
      if (!viewer.isAdmin && !(args.p_department && viewer.headedDepartmentIds.includes(args.p_department))) {
        return { data: null, error: { code: "42501", message: "Only admins, or department heads for their own department, can view performance" } };
      }
      return { data: args.p_department ? rows[args.p_department] ?? [] : Object.values(rows).flat(), error: null };
    }),
    ...over,
  };
}

describe("Department Head: which department the Performance page shows", () => {
  it("REGRESSION: with no department chosen it shows the first department they head, not an empty page", async () => {
    const d = deps(head, { [RND]: [person("Imam", { assigned: 3, completed: 2, late: 1, on_time_pct: 50, score: 60 })] });
    const v = await loadPerformance(head, {}, d);
    expect(d.summary).toHaveBeenCalledWith({ p_from: "2026-07-08", p_to: "2026-10-06", p_department: RND });
    expect(v).toMatchObject({ departmentId: RND, error: null, departments: [{ id: RND, name: "R&D" }] });
    expect(v.rows?.map((r) => r.full_name)).toEqual(["Imam"]);
  });
  it("an empty selection from the form (?dept=) is the same as none", async () => {
    const d = deps(head, { [RND]: [person("Imam")] });
    expect((await loadPerformance(head, { dept: "" }, d)).departmentId).toBe(RND);
    expect(d.summary).toHaveBeenCalledWith(expect.objectContaining({ p_department: RND }));
  });
  it("a department with activity shows its people", async () => {
    const rows = [person("Imam", { assigned: 4, completed: 4, on_time_pct: 100, daily_updates: 9, score: 100 }), person("Shorif", { assigned: 2, completed: 1, late: 1, on_time_pct: 0, score: 40 })];
    const v = await loadPerformance(head, { dept: RND, from: "2026-07-01", to: "2026-09-30" }, deps(head, { [RND]: rows }));
    expect(v).toMatchObject({ from: "2026-07-01", to: "2026-09-30", departmentId: RND, error: null });
    expect(v.rows).toEqual(rows);
  });
  it("a valid department with no activity is an empty result, not an error", async () => {
    const quiet = await loadPerformance(head, { dept: RND }, deps(head, { [RND]: [person("Imam"), person("Shorif")] }));
    expect(quiet.error).toBeNull();
    expect(quiet.rows?.every((r) => r.assigned === 0 && r.completed === 0 && r.score === null)).toBe(true);
    const nobody = await loadPerformance(head, { dept: RND }, deps(head, { [RND]: [] }));
    expect(nobody).toMatchObject({ rows: [], error: null, departmentId: RND });
  });
  it("another department's id is ignored: only their own department is asked for and offered", async () => {
    const d = deps(head, { [RND]: [person("Imam")], [MECH]: [person("Araf", { department: "Mechanical" })] });
    const v = await loadPerformance(head, { dept: MECH }, d);
    expect(d.summary).toHaveBeenCalledTimes(1);
    expect(d.summary).toHaveBeenCalledWith(expect.objectContaining({ p_department: RND }));
    expect(v.departmentId).toBe(RND);
    expect(v.departments).toEqual([{ id: RND, name: "R&D" }]);
    expect(v.rows?.some((r) => r.full_name === "Araf")).toBe(false);
  });
  it("a head of several departments gets the first by default and may switch to another of theirs", async () => {
    const both = { isAdmin: false, headedDepartmentIds: [SOFT, RND] };
    const d = deps(both, { [RND]: [person("Imam")], [SOFT]: [person("Rafi", { department: "Software" })] });
    expect((await loadPerformance(both, {}, d)).departmentId).toBe(RND);          // first in the department list's order
    expect((await loadPerformance(both, { dept: SOFT }, d)).rows?.[0].full_name).toBe("Rafi");
    expect((await loadPerformance(both, { dept: MECH }, d)).departmentId).toBe(RND);
  });
  it("a head with no department sees why, and the scores are not requested", async () => {
    const nobody = { isAdmin: false, headedDepartmentIds: [] };
    const d = deps(nobody, {});
    const v = await loadPerformance(nobody, {}, d);
    expect(v).toMatchObject({ rows: null, error: PERFORMANCE_ERRORS.noDepartment });
    expect(d.summary).not.toHaveBeenCalled();
  });
});

describe("a failed query is an error, never 'No activity in this window'", () => {
  it("REGRESSION: an RPC error gives no rows and a clear message", async () => {
    const d = deps(head, {}, { summary: vi.fn(async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })) });
    const v = await loadPerformance(head, {}, d);
    expect(v.rows).toBeNull();
    expect(v.error).toBe(PERFORMANCE_ERRORS.failed);
    expect(v.error).not.toMatch(/statement|timeout|57014/);   // no database detail in the message
    expect(v).toMatchObject({ departmentId: RND, departments: [{ id: RND, name: "R&D" }] });   // the page keeps its header and picker
  });
  it("a refusal by the database is reported as a permission problem", async () => {
    const d = deps(head, {}, { summary: vi.fn(async () => ({ data: null, error: { code: "42501", message: "Only admins, or department heads for their own department, can view performance" } })) });
    expect(await loadPerformance(head, {}, d)).toMatchObject({ rows: null, error: PERFORMANCE_ERRORS.denied });
  });
  it("a thrown network error, or a response with neither rows nor error, is also a failure", async () => {
    expect(await loadPerformance(head, {}, deps(head, {}, { summary: vi.fn(async () => { throw new Error("fetch failed"); }) }))).toMatchObject({ rows: null, error: PERFORMANCE_ERRORS.failed });
    expect(await loadPerformance(head, {}, deps(head, {}, { summary: vi.fn(async () => ({ data: null, error: null })) }))).toMatchObject({ rows: null, error: PERFORMANCE_ERRORS.failed });
  });
  it("a failed department list stops before any scores are requested", async () => {
    const d = deps(head, { [RND]: [person("Imam")] }, { departments: vi.fn(async () => ({ data: null, error: { message: "connection reset" } })) });
    const v = await loadPerformance(head, {}, d);
    expect(v).toMatchObject({ rows: null, error: PERFORMANCE_ERRORS.departments });
    expect(d.summary).not.toHaveBeenCalled();
  });
  it("a failed settings read only falls back to the default window", async () => {
    const d = deps(head, { [RND]: [person("Imam")] }, { windowDays: vi.fn(async () => { throw new Error("down"); }) });
    expect(await loadPerformance(head, {}, d)).toMatchObject({ from: "2026-07-08", error: null });
  });
});

describe("Admin and the date window", () => {
  it("Admin sees all departments by default, or one", async () => {
    const d = deps(admin, { [RND]: [person("Imam")], [MECH]: [person("Araf", { department: "Mechanical" })] });
    const all = await loadPerformance(admin, {}, d);
    expect(d.summary).toHaveBeenCalledWith({ p_from: "2026-07-08", p_to: "2026-10-06" });
    expect(all).toMatchObject({ departmentId: null, error: null });
    expect(all.rows).toHaveLength(2);
    expect(all.departments).toHaveLength(3);
    expect((await loadPerformance(admin, { dept: MECH }, d)).rows?.map((r) => r.full_name)).toEqual(["Araf"]);
    expect((await loadPerformance(admin, { dept: "not-a-department" }, d)).departmentId).toBeNull();
  });
  it("a cleared or malformed date falls back to the default window instead of failing", async () => {
    const d = deps(head, { [RND]: [person("Imam")] });
    expect(await loadPerformance(head, { from: "", to: "" }, d)).toMatchObject({ from: "2026-07-08", to: "2026-10-06", error: null });
    expect(await loadPerformance(head, { from: "yesterday", to: "2026-13-45" }, d)).toMatchObject({ from: "2026-07-08", to: "2026-10-06" });
    expect(await loadPerformance(head, { from: "2026-09-30", to: "2026-09-01" }, d)).toMatchObject({ from: "2026-09-01", to: "2026-09-01" });
  });
  it("chooseDepartment accepts only an id from the allowed list", () => {
    expect(chooseDepartment({ isAdmin: false }, [{ id: RND, name: "R&D" }], undefined)).toBe(RND);
    expect(chooseDepartment({ isAdmin: false }, [{ id: RND, name: "R&D" }], MECH)).toBe(RND);
    expect(chooseDepartment({ isAdmin: false }, [], RND)).toBeNull();
    expect(chooseDepartment({ isAdmin: true }, DEPARTMENTS, undefined)).toBeNull();
    expect(chooseDepartment({ isAdmin: true }, DEPARTMENTS, SOFT)).toBe(SOFT);
  });
});
