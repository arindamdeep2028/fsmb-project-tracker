import { describe, expect, it } from "vitest";
import { reportItemChange, type ReportTaskOption } from "@/lib/report-items";
import { dailyRowInput, reportInput } from "@/lib/validation";

const open: ReportTaskOption = { id: "aaaaaaaa-0000-4000-8000-000000000001", status: "In progress", choices: ["Blocked", "Completed"], is_leaf: true, done: false };
const other: ReportTaskOption = { id: "aaaaaaaa-0000-4000-8000-000000000002", status: "Not started", choices: ["Plan submitted", "In progress", "Blocked", "Completed"], is_leaf: false, done: false };
const done: ReportTaskOption = { ...open, status: "Completed", choices: [], done: true };

describe("a daily report keeps the task entries it has", () => {
  it("REGRESSION: reopening a report whose task is now Completed and saving removes nothing", () => {
    // the original defect: the completed task was not in the list, the form sent items: [] and the entry was deleted
    expect(reportItemChange({ priorTaskId: done.id, task: done, changed: false, status: "Completed", progress: "100" })).toEqual({ items: [], remove_task_ids: [] });
  });
  it("saving other fields when the entry's task is not in the list (reassigned, archived) removes nothing", () => {
    expect(reportItemChange({ priorTaskId: open.id, task: undefined, changed: false, status: "", progress: "" })).toEqual({ items: [], remove_task_ids: [] });
  });
  it("an empty selection on a new report sends nothing to remove", () => {
    expect(reportItemChange({ priorTaskId: null, task: undefined, changed: false, status: "", progress: "" })).toEqual({ items: [], remove_task_ids: [] });
    expect(reportItemChange({ priorTaskId: null, task: undefined, changed: true, status: "", progress: "" })).toEqual({ items: [], remove_task_ids: [] });
  });
  it("an unchanged open task is saved again with its status and progress", () => {
    expect(reportItemChange({ priorTaskId: open.id, task: open, changed: false, status: "Completed", progress: "80" })).toEqual({
      items: [{ task_id: open.id, status_after: "Completed", progress_after: 80, note: null }], remove_task_ids: [],
    });
  });
  it("only the user changing the Main Task replaces the entry; clearing it removes the entry", () => {
    expect(reportItemChange({ priorTaskId: open.id, task: other, changed: true, status: "In progress", progress: "40" })).toEqual({
      items: [{ task_id: other.id, status_after: "In progress", progress_after: null, note: null }], remove_task_ids: [open.id],
    });
    expect(reportItemChange({ priorTaskId: open.id, task: undefined, changed: true, status: "", progress: "" })).toEqual({ items: [], remove_task_ids: [open.id] });
    expect(reportItemChange({ priorTaskId: done.id, task: other, changed: true, status: "", progress: "" }).remove_task_ids).toEqual([done.id]);
  });
  it("picking another task and coming back to the same one removes nothing", () => {
    expect(reportItemChange({ priorTaskId: open.id, task: open, changed: true, status: "In progress", progress: "50" }).remove_task_ids).toEqual([]);
  });
  it("a status the user may not set falls back to the task's own; progress is clamped and only for leaf tasks", () => {
    expect(reportItemChange({ priorTaskId: null, task: open, changed: true, status: "Not started", progress: "250" }).items[0]).toMatchObject({ status_after: "In progress", progress_after: 100 });
    expect(reportItemChange({ priorTaskId: null, task: open, changed: true, status: "Blocked", progress: "" }).items[0]).toMatchObject({ status_after: "Blocked", progress_after: null });
    expect(reportItemChange({ priorTaskId: null, task: open, changed: true, status: "Blocked", progress: "abc" }).items[0].progress_after).toBeNull();
  });
});

describe("report inputs", () => {
  const project_id = "aaaaaaaa-0000-4000-8000-0000000000aa";
  it("removals default to none and must be task ids", () => {
    expect(reportInput.parse({ project_id, update_text: "Did the work" }).remove_task_ids).toEqual([]);
    expect(reportInput.parse({ project_id, update_text: "Did the work", items: [] }).items).toEqual([]);
    expect(reportInput.safeParse({ project_id, update_text: "x", remove_task_ids: ["all"] }).success).toBe(false);
    const row = { project_id, user_id: project_id, report_date: "2026-10-05", task_id: null, update_text: "x", status: null, progress: null, issues: "", next_task_text: "", remarks: "" };
    expect(dailyRowInput.parse(row).remove_task_ids).toEqual([]);
    expect(dailyRowInput.safeParse({ ...row, remove_task_ids: ["*"] }).success).toBe(false);
  });
  it("a report must name a real project id", () => {
    expect(reportInput.safeParse({ project_id: "", update_text: "x" }).success).toBe(false);
    expect(reportInput.safeParse({ project_id: "../other", update_text: "x" }).success).toBe(false);
  });
});
