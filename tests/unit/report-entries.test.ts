import { describe, expect, it } from "vitest";
import {
  OTHER, blankEntry, buildSubmission, entriesFromSaved, entriesTotalHours, reportView, validateEntries,
  type EntryDraft, type SavedItem, type SavedReport,
} from "@/lib/report-entries";
import type { StepOption } from "@/lib/report-items";
import { dailyExcelLine, type DailyRow } from "@/lib/sheet";
import { reportInput } from "@/lib/validation";

// T1 "Format check" with subtasks a and b (both mine); T2 "Testing" (a task without subtasks); T3 done
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T1a = "aaaaaaaa-0000-4000-8000-00000000001a";
const T1b = "aaaaaaaa-0000-4000-8000-00000000001b";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const T3 = "aaaaaaaa-0000-4000-8000-000000000003";
const top1 = { id: T1, label: "1. Format check", progress: 65 };
const opt = (o: Partial<StepOption> & Pick<StepOption, "id">): StepOption => ({
  status: "In progress", choices: ["Blocked", "Completed"], is_leaf: true, done: false, label: "", sub: null, progress_pct: 0, top: top1, ...o,
});
const options: StepOption[] = [
  opt({ id: T1a, label: "1. Format check", sub: "a. Subtask 1", progress_pct: 50 }),
  opt({ id: T1b, label: "1. Format check", sub: "b. Subtask 2", status: "Plan submitted", choices: ["In progress", "Blocked", "Completed"], progress_pct: 100 }),
  opt({ id: T2, label: "2. Testing", progress_pct: 25, top: { id: T2, label: "2. Testing", progress: 25 } }),
  opt({ id: T3, label: "3. Done task", status: "Completed", choices: [], done: true, progress_pct: 100, top: { id: T3, label: "3. Done task", progress: 100 } }),
];
const entry = (e: Partial<EntryDraft>): EntryDraft => ({ ...blankEntry(), ...e });
const e1 = entry({ topId: T1, taskId: T1a, hours: "3", status: "In progress", progress: "50", work: "Checked the template", issues: "No issues", next: "Share" });
const e2 = entry({ topId: T1, taskId: T1b, hours: "2", status: "Plan submitted", progress: "75", work: "Prepared the draft", issues: "Waiting for feedback" });
const e3 = entry({ topId: T2, taskId: T2, hours: "2.5", status: "Blocked", progress: "30", work: "Started the system test", next: "Get the setup" });

describe("validating the entries of one daily report", () => {
  it("three different entries (subtasks of one task and another task) are valid; hours add up", () => {
    expect(validateEntries([e1, e2, e3], options)).toEqual({ ok: true, errors: {}, form: null });
    expect(entriesTotalHours([e1, e2, e3])).toBe(7.5);
  });
  it("the same task or subtask twice in one report is refused on the later entry", () => {
    const dup = { ...e2, key: "dup", taskId: T1a };
    const v = validateEntries([e1, dup], options);
    expect(v.ok).toBe(false);
    expect(v.errors.dup?.subtask).toMatch(/Already in entry 1/);
    expect(v.errors[e1.key]).toBeUndefined();
  });
  it("task, subtask, hours, work and completion are required; completion is 0 to 100", () => {
    const v = validateEntries([entry({ key: "a" }), entry({ key: "b", topId: T1 }), entry({ key: "c", topId: T2, taskId: T2, hours: "x", status: "In progress", progress: "120", work: " " })], options);
    expect(v.errors.a).toMatchObject({ task: expect.any(String), hours: expect.any(String), work: expect.any(String) });
    expect(v.errors.b?.subtask).toBe("Choose the subtask");
    expect(v.errors.c).toMatchObject({ hours: expect.any(String), progress: "0 to 100", work: expect.any(String) });
  });
  it("a Completed status needs no completion value (it becomes 100)", () => {
    expect(validateEntries([{ ...e3, status: "Completed", progress: "" }], options).ok).toBe(true);
  });
  it("more than 24 hours in one report is refused", () => {
    expect(validateEntries([{ ...e1, hours: "20" }, { ...e2, hours: "5" }], options).form).toMatch(/24 at most/);
  });
  it("only one Other work entry", () => {
    const o1 = entry({ key: "o1", topId: OTHER, taskId: OTHER, hours: "1", work: "Meeting" });
    const o2 = entry({ key: "o2", topId: OTHER, taskId: OTHER, hours: "1", work: "Meeting" });
    expect(validateEntries([o1, o2], options).errors.o2?.subtask).toMatch(/already entry 1/);
  });
});

describe("what one save sends (save_daily_report payload)", () => {
  it("each entry becomes its own item with its own status, completion, hours and texts", () => {
    const s = buildSubmission([e1, e2, e3], options, []);
    expect(s.items).toEqual([
      { task_id: T1a, status_after: "In progress", progress_after: 50, work_hours: 3, work_text: "Checked the template", issues: "No issues", next_task_text: "Share" },
      { task_id: T1b, status_after: "Plan submitted", progress_after: 75, work_hours: 2, work_text: "Prepared the draft", issues: "Waiting for feedback", next_task_text: null },
      { task_id: T2, status_after: "Blocked", progress_after: 30, work_hours: 2.5, work_text: "Started the system test", issues: null, next_task_text: "Get the setup" },
    ]);
    expect(s.work_hours).toBeNull();
    expect(s.remove_task_ids).toEqual([]);
    expect(s.update_text).toBe("1. Format check / a. Subtask 1: Checked the template\n1. Format check / b. Subtask 2: Prepared the draft\n2. Testing: Started the system test");
    expect(s.issues).toBe("1. Format check / a. Subtask 1: No issues\n1. Format check / b. Subtask 2: Waiting for feedback");
    // the summary fits the report's own columns
    expect(reportInput.safeParse({ project_id: T1, ...s, next_task_id: null }).success).toBe(true);
  });
  it("Completed sends 100; a status the user may not choose falls back to the task's own", () => {
    const s = buildSubmission([{ ...e3, status: "Completed", progress: "40" }, { ...e1, status: "Not started" }], options, []);
    expect(s.items[0]).toMatchObject({ task_id: T2, status_after: "Completed", progress_after: 100 });
    expect(s.items[1]).toMatchObject({ task_id: T1a, status_after: "In progress" });
  });
  it("a task with subtasks (whole task) never sends a completion: its progress is calculated", () => {
    const whole = opt({ id: T1, label: "1. Format check", is_leaf: false, status: "In progress" });
    const s = buildSubmission([entry({ topId: T1, taskId: T1, hours: "1", status: "In progress", progress: "90", work: "Review" })], [...options, whole], []);
    expect(s.items[0]).toMatchObject({ task_id: T1, progress_after: null });
  });
  it("an entry removed from the form is named for removal; locked and kept entries are not sent and not removed", () => {
    const done = entry({ topId: T3, taskId: T3, locked: "done", work: "Finished earlier", hours: "1" });
    const gone = entry({ taskId: "aaaaaaaa-0000-4000-8000-00000000000f", locked: "unavailable", lockedLabel: "9. Reassigned", work: "x", hours: "1" });
    const s = buildSubmission([e1, done, gone], options, [T1a, T1b, T3, gone.taskId]);
    expect(s.items.map((i) => i.task_id)).toEqual([T1a]);
    expect(s.remove_task_ids).toEqual([T1b]);
    expect(s.update_text).toContain("9. Reassigned: x");
  });
  it("Other work goes on the report itself with its hours", () => {
    const o = entry({ topId: OTHER, taskId: OTHER, hours: "1.5", work: "Team meeting", issues: "Room booked late" });
    const s = buildSubmission([e1, o], options, []);
    expect(s).toMatchObject({ update_text: "Team meeting", issues: "Room booked late", work_hours: 1.5 });
    expect(s.items).toHaveLength(1);
  });
});

const savedItem = (i: Partial<SavedItem> & Pick<SavedItem, "task_id">): SavedItem => ({
  task_code: "P01-T01a", task_title: "Subtask 1", parent: { code: "P01-T01", title: "Format check" }, status_after: "In progress", progress_after: 50, work_hours: 3, ...i,
});

describe("loading a saved report back into the form", () => {
  it("a multi-entry report: every entry with its own texts, in the order saved", () => {
    const saved: SavedReport = {
      update_text: "summary", issues: "summary", next_task_text: null, work_hours: null,
      items: [
        savedItem({ task_id: T2, task_code: "P01-T02", task_title: "Testing", parent: null, work_text: "Test", progress_after: 30, created_at: "2026-11-20T02:00:00Z" }),
        savedItem({ task_id: T1a, work_text: "Template", issues: "None", next_task_text: "Share", created_at: "2026-11-20T01:00:00Z" }),
      ],
    };
    const es = entriesFromSaved(saved, options);
    expect(es.map((e) => [e.taskId, e.topId, e.work, e.issues, e.next, e.hours, e.progress])).toEqual([
      [T1a, T1, "Template", "None", "Share", "3", "50"],
      [T2, T2, "Test", "", "", "3", "30"],
    ]);
  });
  it("a report saved before (one text): the text goes to its first entry; no task: one Other work entry", () => {
    const old: SavedReport = { update_text: "Did things", issues: "Late parts", next_task_text: "Order", work_hours: null, items: [savedItem({ task_id: T1a })] };
    expect(entriesFromSaved(old, options)[0]).toMatchObject({ taskId: T1a, work: "Did things", issues: "Late parts", next: "Order" });
    const none: SavedReport = { update_text: "General work", issues: null, next_task_text: null, work_hours: 2, items: [] };
    expect(entriesFromSaved(none, options)).toEqual([expect.objectContaining({ taskId: OTHER, work: "General work", hours: "2" })]);
  });
  it("a Completed task's entry and a reassigned task's entry stay, locked", () => {
    const saved: SavedReport = { update_text: "s", issues: null, next_task_text: null, work_hours: null, items: [
      savedItem({ task_id: T3, work_text: "done", created_at: "1" }),
      savedItem({ task_id: "aaaaaaaa-0000-4000-8000-00000000000f", task_code: "P01-T09", task_title: "Moved", parent: null, work_text: "w", created_at: "2" }),
    ] };
    const es = entriesFromSaved(saved, options);
    expect(es[0]).toMatchObject({ locked: "done", status: "Completed", progress: "100" });
    expect(es[1]).toMatchObject({ locked: "unavailable", lockedLabel: "9. Moved" });
  });
});

describe("how a report reads in the Daily Reports sheet and Excel", () => {
  const items = [
    savedItem({ task_id: T1a, work_text: "Template", issues: "None", next_task_text: "Share", created_at: "1" }),
    savedItem({ task_id: T2, task_code: "P01-T02", task_title: "Testing", parent: null, work_text: "Test", next_task_text: "Lab", work_hours: 2.5, progress_after: 30, created_at: "2" }),
  ];
  it("a multi-entry report: entries with their own work; Issues and Next Task per entry; no duplicated summary", () => {
    const v = reportView({ update_text: "summary", issues: "summary", next_task_text: "summary", work_hours: null }, items);
    expect(v.multi).toBe(true);
    expect(v.text).toBe("");
    expect(v.entries.map((e) => [e.label, e.sub, e.work, e.hours, e.progress])).toEqual([["1. Format check", "a. Subtask 1", "Template", 3, 50], ["2. Testing", null, "Test", 2.5, 30]]);
    expect(v.issues).toBe("a. Subtask 1: None");
    expect(v.nextTask).toBe("a. Subtask 1: Share\n2. Testing: Lab");
  });
  it("a report saved before migration 35 reads exactly as before", () => {
    const v = reportView({ update_text: "One text", issues: "I", next_task_text: "N", work_hours: null }, [savedItem({ task_id: T1a })]);
    expect(v).toMatchObject({ multi: false, text: "One text", issues: "I", nextTask: "N" });
    expect(v.entries[0].work).toBeNull();
  });
  it("Excel: each entry with its hours, completion and work under its task", () => {
    const v = reportView({ update_text: "summary", issues: null, next_task_text: null, work_hours: null }, items);
    const row: DailyRow = { key: "r", date: "2026-11-20", dayNo: 5, offDay: false, reportId: "r", userId: "u", locked: false, edit: null, hours: 5.5,
      mainTask: v.entries, entries: true, dailySubTask: v.text, assignedTo: "Deep", issues: v.issues, nextTask: v.nextTask, remarks: "" };
    expect(dailyExcelLine(row)[3]).toBe("1. Format check / a. Subtask 1\n3.0 hrs · 50%\nTemplate\n2. Testing\n2.5 hrs · 30%\nTest");
  });
});
