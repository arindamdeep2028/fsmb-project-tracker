import { describe, expect, it } from "vitest";
import { formatHours, parseHours, totalHours } from "@/lib/hours";
import {
  CATEGORIES, GENERAL_PHASE, TASKLIST_STATUSES, categoryLabel, personTone, phaseChoices, tasklistRows, tasklistStatus,
  type SheetRow, type TasklistTask,
} from "@/lib/tasklist";
import { excelWidth, linesFor, rowHeight, toneFor } from "@/lib/xlsx";
import {
  dailyRowInput, remarkInput, reportInput, tasklistAddRows, tasklistRowPatch, tasklistTaskCategory, tasklistTaskPatch, workHours,
} from "@/lib/validation";

describe("working hours", () => {
  it("accepts decimal hours such as 1.5 and 2.25, and an empty field", () => {
    expect(parseHours("1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseHours("2.25")).toEqual({ ok: true, value: 2.25 });
    expect(parseHours(" 8 ")).toEqual({ ok: true, value: 8 });
    expect(parseHours("1,5")).toEqual({ ok: true, value: 1.5 });
    expect(parseHours(".5")).toEqual({ ok: true, value: 0.5 });
    expect(parseHours("")).toEqual({ ok: true, value: null });
    expect(parseHours(null)).toEqual({ ok: true, value: null });
  });
  it("refuses zero, negatives, more than 24, more than two decimals and text", () => {
    for (const bad of ["0", "-1", "24.5", "25", "1.255", "abc", "1.2.3"]) expect(parseHours(bad).ok, bad).toBe(false);
    expect(parseHours("24").ok).toBe(true);
  });
  it("adds up the hours of a report, or gives null when none were recorded", () => {
    expect(totalHours([1.5, null, 2.25])).toBe(3.75);
    expect(totalHours([null, undefined])).toBeNull();
    expect(totalHours(["3.5", 1])).toBe(4.5);
  });
  it("shows hours like the sheet: 4.5 hrs, 3.0 hrs, 2.25 hrs, and a dash for none", () => {
    expect(formatHours(4.5)).toBe("4.5 hrs");
    expect(formatHours(3)).toBe("3.0 hrs");
    expect(formatHours(2.25)).toBe("2.25 hrs");
    expect(formatHours(null)).toBe("-");
  });
  it("validates hours on the server the same way (schema)", () => {
    expect(workHours.safeParse(2.25).success).toBe(true);
    expect(workHours.safeParse(0).success).toBe(false);
    expect(workHours.safeParse(24.01).success).toBe(false);
    expect(workHours.safeParse(1.234).success).toBe(false);
    const row = { project_id: "aaaaaaaa-0000-0000-0000-000000000001", user_id: "aaaaaaaa-0000-0000-0000-000000000002", report_date: "2026-11-17", task_id: null, update_text: "x", status: null, progress: null, issues: "", next_task_text: "" };
    expect(dailyRowInput.safeParse({ ...row, work_hours: 1.5 }).success).toBe(true);
    expect(dailyRowInput.safeParse({ ...row, work_hours: 30 }).success).toBe(false);
    expect(reportInput.safeParse({ project_id: row.project_id, update_text: "x", items: [{ task_id: row.user_id, work_hours: 2.5 }] }).success).toBe(true);
  });
});

describe("remark input", () => {
  const base = { project_id: "aaaaaaaa-0000-0000-0000-000000000001", report_date: "2026-11-17", recipient_id: "aaaaaaaa-0000-0000-0000-000000000002" };
  it("needs a recipient, a date and some text (2000 characters at most)", () => {
    expect(remarkInput.safeParse({ ...base, body: "Please complete the calibration test" }).success).toBe(true);
    expect(remarkInput.safeParse({ ...base, body: "   " }).success).toBe(false);
    expect(remarkInput.safeParse({ ...base, body: "x".repeat(2001) }).success).toBe(false);
    expect(remarkInput.safeParse({ ...base, recipient_id: "nope", body: "x" }).success).toBe(false);
  });
});

describe("Tasklist rows", () => {
  const t = (id: string, code: string, children: TasklistTask[] = []): TasklistTask => ({
    id, code, title: `Title ${code}`, parent_id: null, status: "In progress", priority: "Normal", assigned_to: "u", assignee_name: "U",
    created_by: "u", contribution_locked: false, is_leaf: children.length === 0, children,
  });
  it("makes each main task with subtasks a phase heading, with its subtasks numbered under it", () => {
    const rows = tasklistRows([t("p2", "P01-T02", [t("b", "P01-T02b"), t("a", "P01-T02a")]), t("p10", "P01-T10", [t("c", "P01-T10a")])]);
    expect(rows.map((r) => (r.kind === "phase" ? `# ${r.label} (${r.count})` : r.kind === "task" ? `${r.no} ${r.task.id}` : `row ${r.row.id}`))).toEqual([
      "# Title P01-T02 (2)", "2a a", "2b b", "# Title P01-T10 (1)", "10a c",
    ]);
  });
  it("puts single tasks under 'General tasks' when the list has phases, and no heading when it has none", () => {
    const mixed = tasklistRows([t("x", "P01-T01"), t("p", "P01-T02", [t("a", "P01-T02a")]), t("y", "P01-T03"), t("z", "P01-T04")]);
    expect(mixed.map((r) => (r.kind === "phase" ? `# ${r.label} (${r.count})` : r.kind === "task" ? r.no : r.row.id))).toEqual([
      `# ${GENERAL_PHASE} (1)`, "1", "# Title P01-T02 (1)", "2a", `# ${GENERAL_PHASE} (2)`, "3", "4",
    ]);
    const flat = tasklistRows([t("x", "P01-T01"), t("y", "P01-T02")]);
    expect(flat.every((r) => r.kind === "task")).toBe(true);
  });
  it("puts rows added on the Tasklist after the tasks of their phase, in the order added", () => {
    const row = (id: string, phaseId: string | null, position: number): SheetRow => ({ id, phaseId, position, title: "", status: "Not started", priority: "Normal", comment: "", category: "General" });
    const show = (rows: ReturnType<typeof tasklistRows>) =>
      rows.map((r) => (r.kind === "phase" ? `# ${r.label} (${r.count})` : r.kind === "task" ? r.no : `row ${r.row.id}`));
    const tree = [t("x", "P01-T01"), t("p", "P01-T02", [t("a", "P01-T02a")]), t("q", "P01-T03", [t("b", "P01-T03a")])];
    // "lost": its phase (P01-T01) is not a heading, so it goes to General tasks
    expect(show(tasklistRows(tree, [row("r2", "p", 2), row("r1", "p", 1), row("g1", null, 3), row("lost", "x", 4)]))).toEqual([
      `# ${GENERAL_PHASE} (1)`, "1", "# Title P01-T02 (3)", "2a", "row r1", "row r2", "# Title P01-T03 (1)", "3a",
      `# ${GENERAL_PHASE} (2)`, "row g1", "row lost",
    ]);
    // the list ends with single tasks: their General heading takes the rows too
    expect(show(tasklistRows([t("p", "P01-T02", [t("a", "P01-T02a")]), t("y", "P01-T03")], [row("g", null, 1)]))).toEqual([
      "# Title P01-T02 (1)", "2a", `# ${GENERAL_PHASE} (2)`, "3", "row g",
    ]);
    // no phases, no tasks: just the rows
    expect(show(tasklistRows([], [row("a", null, 1), row("b", null, 2)]))).toEqual(["row a", "row b"]);
  });
  it("offers the current phase headings as phases for new rows", () => {
    expect(phaseChoices([t("x", "P01-T01"), t("q", "P01-T10", [t("b", "P01-T10a")]), t("p", "P01-T02", [t("a", "P01-T02a")])]))
      .toEqual([{ id: "p", label: "2. Title P01-T02" }, { id: "q", label: "10. Title P01-T10" }]);
  });
  it("checks Add rows and Tasklist edits like the database", () => {
    const P = "aaaaaaaa-0000-0000-0000-000000000001";
    expect(tasklistAddRows.safeParse({ project_id: P, count: "10", phase_id: null }).success).toBe(true);
    expect(tasklistAddRows.safeParse({ project_id: P, count: 0, phase_id: null }).success).toBe(false);
    expect(tasklistAddRows.safeParse({ project_id: P, count: 51, phase_id: null }).success).toBe(false);
    expect(tasklistAddRows.safeParse({ project_id: P, count: 2.5, phase_id: null }).success).toBe(false);
    expect(tasklistTaskPatch.safeParse({ title: "   " }).success).toBe(false);
    expect(tasklistTaskPatch.safeParse({}).success).toBe(false);
    expect(tasklistTaskPatch.safeParse({ status: "Completed" }).success).toBe(true);
    expect(tasklistRowPatch.safeParse({ title: "" }).success).toBe(true);
    expect(tasklistRowPatch.safeParse({ comment: "x".repeat(501) }).success).toBe(false);
    expect(tasklistRowPatch.safeParse({ phase_task_id: null }).success).toBe(true);
  });
  it("offers the four Tasklist statuses in order, showing Blocked as Halted (stored value unchanged)", () => {
    expect(TASKLIST_STATUSES.map(tasklistStatus)).toEqual(["Pending", "On-Going", "Halted", "Done"]);
    expect(TASKLIST_STATUSES).toEqual(["Not started", "In progress", "Blocked", "Completed"]);
    expect(tasklistStatus("Blocked")).toBe("Halted");
    expect(tasklistStatus("Plan submitted")).toBe("Plan submitted");
  });
  it("has exactly two categories, General Task first (the default), separate from priority", () => {
    expect(CATEGORIES.map(categoryLabel)).toEqual(["General Task", "Urgent Task"]);
    const P = "aaaaaaaa-0000-0000-0000-000000000001";
    const added = tasklistAddRows.safeParse({ project_id: P, count: 1, phase_id: null });
    expect(added.success && added.data.category).toBe("General");
    expect(tasklistAddRows.safeParse({ project_id: P, count: 1, phase_id: null, category: "Urgent" }).success).toBe(true);
    expect(tasklistAddRows.safeParse({ project_id: P, count: 1, phase_id: null, category: "High" }).success).toBe(false);
    expect(tasklistRowPatch.safeParse({ category: "Urgent" }).success).toBe(true);
    expect(tasklistRowPatch.safeParse({ category: "Important" }).success).toBe(false);
    expect(tasklistTaskCategory.safeParse({ task_id: P, category: "General" }).success).toBe(true);
    expect(tasklistTaskCategory.safeParse({ task_id: P, category: "Normal" }).success).toBe(false);
  });
  it("gives each person the same chip colour every time", () => {
    expect(personTone("abc")).toEqual(personTone("abc"));
  });
});

describe("Excel formatting", () => {
  it("converts screen widths to Excel column widths", () => {
    expect(excelWidth(80)).toBe(10);
    expect(excelWidth(10)).toBe(6);
  });
  it("sizes rows to the wrapped text of the tallest cell", () => {
    expect(linesFor("short", 200)).toBe(1);
    expect(linesFor("a\nb\nc", 200)).toBe(3);
    expect(linesFor("x".repeat(100), 100)).toBeGreaterThan(5);
    expect(rowHeight(["one", "two\nlines"], [{ header: "a", width: 100 }, { header: "b", width: 100 }])).toBeCloseTo(9 + 2 * 14.5);
  });
  it("colours status, priority and score cells like the screen", () => {
    expect(toneFor("status", "Done")).toMatchObject({ fill: "#d9efdf" });
    expect(toneFor("status", "On-Going")).toMatchObject({ fill: "#fbe8b4" });
    expect(toneFor("status", "Pending")).toMatchObject({ fill: "#b3261e", color: "#ffffff" });
    expect(toneFor("priority", "Important")).toMatchObject({ fill: "#b3261e" });
    expect(toneFor("score", 85)).toMatchObject({ fill: "#d9efdf" });
    expect(toneFor("score", 40)).toMatchObject({ fill: "#f6d5d3" });
    expect(toneFor("text", "Done")).toBeUndefined();
    expect(toneFor("status", "")).toBeUndefined();
  });
});
