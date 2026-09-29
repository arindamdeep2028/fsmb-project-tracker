import { describe, expect, it } from "vitest";
import { canCreateProject, canExportCsv, canManageProject, taskCaps } from "@/lib/auth/capabilities";
import type { Session } from "@/lib/auth/session";

const base = (over: Partial<Session> = {}): Session => ({
  userId: "u-eng", email: null, isAdmin: false, headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: ["p1"],
  profile: { role: "engineer" } as Session["profile"], ...over,
});
const project = { id: "p1", department_id: "d1" };
const task = (over = {}) => ({ project_id: "p1", assigned_to: "u-eng", created_by: "u-pm", status: "In progress" as const, contribution_locked: false, ...over });

describe("capabilities mirror the database rules (UI only; RLS enforces)", () => {
  it("Admin manages every project, creates projects and exports CSV", () => {
    const s = base({ isAdmin: true });
    expect(canManageProject(s, { id: "other", department_id: "dx" })).toBe(true);
    expect(canCreateProject(s)).toBe(true);
    expect(canExportCsv(s)).toBe(true);
  });
  it("engineers never get CSV export (v2 §14.8)", () => {
    expect(canExportCsv(base())).toBe(false);
  });
  it("Department Head manages projects in headed departments only", () => {
    const s = base({ headedDepartmentIds: ["d1"] });
    expect(canManageProject(s, project)).toBe(true);
    expect(canManageProject(s, { id: "p9", department_id: "d2" })).toBe(false);
  });
  it("assignee moves status forward only and types progress on leaf tasks", () => {
    const c = taskCaps(base(), task(), false, true);
    expect(c.statuses).toEqual(["Blocked", "Completed"]);
    expect(c.progress).toBe(true);
    expect(taskCaps(base(), task(), false, false).progress).toBe(false);
    expect(c.deadline).toBe(false);
  });
  it("creator changes contribution at any status unless locked; title only while Not started (v2)", () => {
    const creator = base({ userId: "u-pm" });
    const started = taskCaps(creator, task({ assigned_to: "u-x" }), false, true);
    expect(started.contribution).toBe(true);
    expect(started.titleAndAssignee).toBe(false);
    expect(taskCaps(creator, task({ assigned_to: "u-x", status: "Not started" }), false, true).titleAndAssignee).toBe(true);
    expect(taskCaps(creator, task({ assigned_to: "u-x", contribution_locked: true }), false, true).contribution).toBe(false);
  });
  it("managers get every field; only Admin gets delete", () => {
    const pm = taskCaps(base({ pmProjectIds: ["p1"] }), task(), true, true);
    expect(pm.deadline && pm.lockContribution && pm.archive).toBe(true);
    expect(pm.remove).toBe(false);
    expect(taskCaps(base({ isAdmin: true }), task(), true, true).remove).toBe(true);
  });
});
