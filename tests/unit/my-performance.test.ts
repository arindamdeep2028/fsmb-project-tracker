import { describe, expect, it } from "vitest";
import { classifyRecords, dhakaDayStart, expectedCount, isIsoDate, isLate, nextDay, scoreBreakdown, type PerformanceLog, type PerformanceSummary, type PerformanceTask } from "@/lib/my-performance";

const task = (over: Partial<PerformanceTask> = {}): PerformanceTask => ({
  id: "t1", code: "T-1", title: "Task", type: "Task", status: "In progress", progress_pct: 40,
  assigned_on: "2026-10-05T04:00:00Z", completed_on: null, effective_due_at: "2026-10-10T12:00:00Z",
  project_id: "p1", project_code: "P1", project_name: "Project one", ...over,
});
const log = (over: Partial<PerformanceLog> = {}): PerformanceLog => ({
  id: 1, ts: "2026-10-06T05:00:00Z", log_date: "2026-10-06", action: "Daily update", project_id: "p1", project_code: "P1",
  task_id: "t1", task_code: "T-1", task_title: "Task", details: "Daily report 06-Oct", reason_code: null, ...over,
});
const W = { from: "2026-10-01", to: "2026-10-31" };
const done = (over: Partial<PerformanceTask> = {}) => task({ status: "Completed", progress_pct: 100, completed_on: "2026-10-09T10:00:00Z", ...over });

describe("My Performance records use app.performance_rows' definitions", () => {
  it("assigned: assigned on a Dhaka date inside the window (any status)", () => {
    const r = classifyRecords([
      task({ id: "a" }),
      task({ id: "b", assigned_on: "2026-09-30T18:30:00Z" }),           // 1 Oct 00:30 in Dhaka → inside
      task({ id: "c", assigned_on: "2026-09-30T17:59:00Z" }),           // 30 Sep 23:59 in Dhaka → outside
      done({ id: "d", assigned_on: "2026-09-01T04:00:00Z" }),           // completed in window, assigned before
    ], [], W);
    expect(r.assigned.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("completed: status Completed and completed on a Dhaka date inside the window", () => {
    const r = classifyRecords([
      done({ id: "a" }),
      done({ id: "b", completed_on: "2026-10-31T18:00:00Z" }),          // 1 Nov in Dhaka → outside
      task({ id: "c" }),                                                 // not completed
      done({ id: "d", assigned_on: "2026-08-01T04:00:00Z" }),           // assigned before the window still counts
    ], [], W);
    expect(r.completed.map((t) => t.id).sort()).toEqual(["a", "d"]);
  });
  it("late: completed_on > effective_due_at; a task with no deadline is never late (SQL null comparison)", () => {
    expect(isLate(done({ completed_on: "2026-10-11T00:00:00Z" }))).toBe(true);
    expect(isLate(done({ completed_on: "2026-10-10T12:00:00Z" }))).toBe(false);       // exactly on the deadline
    expect(isLate(done({ effective_due_at: null }))).toBe(false);
    const r = classifyRecords([
      done({ id: "late", completed_on: "2026-10-11T00:00:00Z" }), done({ id: "ok" }), done({ id: "nodue", effective_due_at: null }),
    ], [], W);
    expect(r.late.map((t) => t.id)).toEqual(["late"]);
    expect(r.ontime.map((t) => t.id).sort()).toEqual(["nodue", "ok"]);                  // on time = completed − late
    expect(r.ontime.length + r.late.length).toBe(r.completed.length);
  });
  it("red marks and daily updates: the log action, log_date inside the window, newest first", () => {
    const r = classifyRecords([], [
      log({ id: 1, action: "Red mark", reason_code: "exec_overdue", ts: "2026-10-02T03:00:00Z", log_date: "2026-10-02" }),
      log({ id: 2, action: "Red mark", reason_code: "daily_update_missing", ts: "2026-10-20T03:00:00Z", log_date: "2026-10-20" }),
      log({ id: 3, action: "Red mark", reason_code: "plan_missing", ts: "2026-09-30T03:00:00Z", log_date: "2026-09-30" }),
      log({ id: 4 }), log({ id: 5, log_date: "2026-11-01", ts: "2026-10-31T19:00:00Z" }),
    ], W);
    expect(r.red.map((l) => l.id)).toEqual([2, 1]);
    expect(r.daily.map((l) => l.id)).toEqual([4]);
  });
  it("records are newest first", () => {
    const r = classifyRecords([task({ id: "old", assigned_on: "2026-10-02T04:00:00Z" }), task({ id: "new", assigned_on: "2026-10-20T04:00:00Z" })], [], W);
    expect(r.assigned.map((t) => t.id)).toEqual(["new", "old"]);
  });
  it("an empty window gives empty lists (empty states)", () => {
    const r = classifyRecords([task()], [log()], { from: "2026-01-01", to: "2026-01-31" });
    expect(Object.values(r).every((l) => l.length === 0)).toBe(true);
  });
});

describe("window and counts", () => {
  it("the window's Dhaka day boundaries as UTC", () => {
    expect(dhakaDayStart("2026-10-01")).toBe("2026-09-30T18:00:00.000Z");
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
  it("only real dates from the URL are used in queries", () => {
    expect(isIsoDate("2026-10-01")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-01),or(id.neq.0")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
  it("expected counts match the figures; on time = completed − late", () => {
    const s: PerformanceSummary = { assigned: 8, completed: 6, late: 1, on_time_pct: 83.3, red_events: 2, daily_updates: 14, score: 81 };
    expect(expectedCount("ontime", s)).toBe(5);
    expect(expectedCount("assigned", s)).toBe(8);
    expect(expectedCount("daily", s)).toBe(14);
  });
});

describe("score breakdown (display only) reproduces the database's score", () => {
  const sqlScore = (s: PerformanceSummary, w: { onTime: number; clean: number }) =>
    s.completed === 0 ? null
      : Math.round(100 * (w.onTime * (1 - s.late / s.completed) + w.clean * (1 - Math.min(1, s.red_events / Math.max(1, s.assigned)))));
  const W2 = { onTime: 0.7, clean: 0.3 };
  it.each([
    { assigned: 8, completed: 6, late: 1, red_events: 2 },
    { assigned: 3, completed: 3, late: 0, red_events: 0 },
    { assigned: 0, completed: 2, late: 2, red_events: 5 },
  ])("%o", (f) => {
    const s = { ...f, on_time_pct: null, daily_updates: 0, score: null } as PerformanceSummary;
    const b = scoreBreakdown(s, W2)!;
    expect(Math.round(b.onTimePoints + b.cleanPoints)).toBe(sqlScore(s, W2));
  });
  it("no completed tasks → no score, no breakdown", () => {
    expect(scoreBreakdown({ assigned: 4, completed: 0, late: 0, on_time_pct: null, red_events: 1, daily_updates: 0, score: null }, W2)).toBeNull();
  });
});
