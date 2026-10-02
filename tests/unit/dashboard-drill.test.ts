import { describe, expect, it } from "vitest";
import { href, inWindow, isTaskFilter, pruneTree, taskMatches } from "@/lib/drill";
import type { TaskNode } from "@/types/domain";

const NOW = Date.parse("2026-10-02T06:00:00Z");
const t = (over: Partial<TaskNode> = {}): TaskNode => ({
  id: "t1", status: "In progress", is_red: false, effective_due_at: "2026-10-05T12:00:00Z", completed_on: null,
  assigned_on: "2026-09-20T05:00:00Z", assigned_to: "u1", children: [], ...over,
} as TaskNode);

describe("dashboard filters use the database's definitions", () => {
  it("red / overdue / blocked / open count open tasks only (app.project_metrics)", () => {
    expect(taskMatches(t({ is_red: true }), "red", {}, { now: NOW })).toBe(true);
    expect(taskMatches(t({ is_red: true, status: "Completed" }), "red", {}, { now: NOW })).toBe(false);
    expect(taskMatches(t({ effective_due_at: "2026-10-01T12:00:00Z" }), "overdue", {}, { now: NOW })).toBe(true);
    expect(taskMatches(t({ effective_due_at: "2026-10-01T12:00:00Z", status: "Completed" }), "overdue", {}, { now: NOW })).toBe(false);
    expect(taskMatches(t({ status: "Blocked" }), "blocked", {})).toBe(true);
    expect(taskMatches(t({ status: "Completed" }), "open", {})).toBe(false);
  });
  it("completed / on time / late use the Dhaka completion date inside the window", () => {
    const done = { status: "Completed" as const, completed_on: "2026-09-30T18:30:00Z" };          // 1 Oct in Dhaka
    const w = { from: "2026-10-01", to: "2026-10-02" };
    expect(taskMatches(t(done), "done", w)).toBe(true);
    expect(taskMatches(t(done), "done", { from: "2026-09-01", to: "2026-09-30" })).toBe(false);
    expect(taskMatches(t({ ...done, effective_due_at: "2026-10-03T00:00:00Z" }), "ontime", w)).toBe(true);
    expect(taskMatches(t({ ...done, effective_due_at: "2026-09-29T00:00:00Z" }), "late", w)).toBe(true);
    expect(taskMatches(t({ ...done, effective_due_at: "2026-09-29T00:00:00Z" }), "ontime", w)).toBe(false);
  });
  it("rolling review window (my_dashboard) compares timestamps", () => {
    expect(inWindow("2026-09-25T00:00:00Z", { since: NOW - 30 * 864e5 })).toBe(true);
    expect(inWindow("2026-08-01T00:00:00Z", { since: NOW - 30 * 864e5 })).toBe(false);
  });
  it("assigned in window, person filter, extension / red-mark marks", () => {
    expect(taskMatches(t(), "assigned", { from: "2026-09-20", to: "2026-09-30" })).toBe(true);
    expect(taskMatches(t(), "assigned", { from: "2026-09-21", to: "2026-09-30" })).toBe(false);
    expect(taskMatches(t(), "open", {}, { user: "u2" })).toBe(false);
    expect(taskMatches(t(), "extended", {}, { marks: new Set(["t1"]) })).toBe(true);
    expect(taskMatches(t(), "redmark", {}, { marks: new Set(["t2"]) })).toBe(false);
  });
});

describe("filtered trees", () => {
  it("count every matching task and keep a parent only as context for a matching subtask", () => {
    const tree = [
      t({ id: "a", is_red: false, children: [t({ id: "a1", is_red: true }), t({ id: "a2" })] }),
      t({ id: "b", is_red: true }),
      t({ id: "c" }),
    ];
    const { nodes, count } = pruneTree(tree, (n) => taskMatches(n, "red", {}));
    expect(count).toBe(2);
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(nodes[0].children.map((n) => n.id)).toEqual(["a1"]);
  });
  it("builds clean URLs and validates filters", () => {
    expect(href("/my-tasks", { filter: "red", dept: "d1", user: undefined, all: false })).toBe("/my-tasks?filter=red&dept=d1");
    expect(isTaskFilter("redmark")).toBe(true);
    expect(isTaskFilter("drop table")).toBe(false);
  });
});
