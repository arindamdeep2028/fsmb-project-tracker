import { describe, expect, it } from "vitest";
import { cellCaps, reportStatuses, taskCaps } from "@/lib/auth/capabilities";
import type { Session } from "@/lib/auth/session";
import { PRIORITIES, priorityChoices } from "@/lib/labels";
import { PRIORITY_TONE, dhakaDateOf, sheetDay } from "@/lib/sheet";
import { priority, taskPatch, tasklistRowPatch, tasklistTaskPatch } from "@/lib/validation";
import { caretLines, caretToStart, cellKeyAction, editableField, isCtrlEnter, toCellStart, type KeyLike } from "@/lib/sheet-keys";
import { reportItemChange, stepChoices, taskSteps, type StepOption } from "@/lib/report-items";
import { tasklistRows, type TasklistTask } from "@/lib/tasklist";

const base = (over: Partial<Session> = {}): Session => ({
  userId: "u-eng", email: null, isAdmin: false, headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: ["p1"],
  profile: { role: "engineer" } as Session["profile"], ...over,
});
const task = (over = {}) => ({ project_id: "p1", assigned_to: "u-eng", created_by: "u-eng", status: "Not started" as const, contribution_locked: false, ...over });

describe("priority: Normal / Important / Urgent (migrations 30, 31)", () => {
  it("offers the three levels in order", () => {
    expect(PRIORITIES).toEqual(["Normal", "Important", "Urgent"]);
  });
  it("every dropdown offers exactly the three levels (High and Low were moved by migration 31)", () => {
    expect(priorityChoices()).toEqual(["Normal", "Important", "Urgent"]);
    expect(Object.keys(PRIORITY_TONE).sort()).toEqual(["Important", "Normal", "Urgent"]);
  });
  it("Urgent is red, Important is clearly different from Normal", () => {
    expect(PRIORITY_TONE.Urgent[0]).toBe("#b3261e");
    expect(PRIORITY_TONE.Important).not.toEqual(PRIORITY_TONE.Normal);
    expect(PRIORITY_TONE.Important).not.toEqual(PRIORITY_TONE.Urgent);
  });
  it("is accepted by every save path (task edit, Tasklist task, Tasklist row); High and Low are refused", () => {
    for (const p of ["Normal", "Important", "Urgent"]) expect(priority.safeParse(p).success).toBe(true);
    for (const p of ["High", "Low", "Critical"]) expect(priority.safeParse(p).success).toBe(false);
    expect(taskPatch.safeParse({ priority: "High" }).success).toBe(false);
    expect(taskPatch.safeParse({ priority: "Urgent" }).success).toBe(true);
    expect(tasklistTaskPatch.safeParse({ priority: "Urgent" }).success).toBe(true);
    expect(tasklistRowPatch.safeParse({ priority: "Urgent" }).success).toBe(true);
  });
});

describe("Responsibilities cells follow the role rules", () => {
  it("Admin edits every cell of an existing row in place, Assign To and End Date included (migration 32)", () => {
    const s = base({ isAdmin: true, userId: "u-admin", memberProjectIds: [] });
    const c = cellCaps(taskCaps(s, task({ assigned_to: "u-x", created_by: "u-x", status: "In progress" }), true, true), { status: "In progress", isLeaf: true });
    expect(c).toMatchObject({ endDate: true, remarks: true, title: true, assignee: true, priority: true, progress: true });
    expect(c.statuses.length).toBeGreaterThan(0);
  });
  it("a project manager keeps their existing rights (name, owner, deadline, remarks)", () => {
    const s = base({ pmProjectIds: ["p1"], userId: "u-pm" });
    const c = cellCaps(taskCaps(s, task(), true, true), { status: "In progress", isLeaf: true });
    expect(c).toMatchObject({ title: true, assignee: true, endDate: true, remarks: true, priority: true });
  });
  it("an Admin or manager may move a Completed task back to any other status", () => {
    const s = base({ isAdmin: true, userId: "u-admin" });
    const c = cellCaps(taskCaps(s, task({ status: "Completed" }), true, true), { status: "Completed", isLeaf: true });
    expect(c.statuses).toEqual(["Not started", "Plan submitted", "In progress", "Blocked"]);
    expect(c.endDate).toBe(false);       // a completed task shows its completion date
    expect(c.progress).toBe(false);
  });
  it("every role may reopen a Completed task: an engineer on their own task (not a colleague's), but sets no deadline", () => {
    const own = cellCaps(taskCaps(base(), task({ status: "Completed" }), false, true), { status: "Completed", isLeaf: true });
    expect(own.statuses).toEqual(["Not started", "Plan submitted", "In progress", "Blocked"]);
    expect(own.endDate).toBe(false);
    const created = taskCaps(base(), task({ status: "Completed", assigned_to: "u-x" }), false, true);   // created by me
    expect(created.statuses).toContain("In progress");
    const other = taskCaps(base(), task({ status: "Completed", assigned_to: "u-x", created_by: "u-x" }), false, true);
    expect(other.statuses).toEqual([]);                                                             // a colleague's task
    expect(other).toMatchObject({ member: false, titleAndAssignee: false, priority: false, progress: false, deadline: false });
    for (const role of [{ pmProjectIds: ["p1"] }, { headedDepartmentIds: ["d1"], memberProjectIds: [] }]) {
      const c = taskCaps(base({ userId: "u-m", ...role }), task({ status: "Completed" }), true, true);
      expect(c.statuses).toEqual(["Not started", "Plan submitted", "In progress", "Blocked"]);
    }
  });
  it("someone who is not a member of the project changes no status", () => {
    expect(taskCaps(base({ memberProjectIds: [] }), task({ status: "In progress", assigned_to: "u-x" }), false, true).statuses).toEqual([]);
  });
  it("a daily report keeps its rule: the assignee moves forward only, a manager any way", () => {
    expect(reportStatuses(base(), task({ status: "Completed" }), false)).toEqual([]);
    expect(reportStatuses(base(), task({ status: "In progress" }), false)).toEqual(["Blocked", "Completed"]);
    expect(reportStatuses(base(), task({ status: "Completed" }), true)).toContain("In progress");
  });
  it("an engineer member edits every cell but End Date of their own task, at any status (migration 32)", () => {
    for (const own of [task({ status: "In progress" }), task({ status: "In progress", created_by: "u-x" }), task({ status: "In progress", assigned_to: "u-x" })]) {
      const c = cellCaps(taskCaps(base(), own, false, true), { status: "In progress", isLeaf: true });
      expect(c).toMatchObject({ title: true, assignee: true, remarks: true, priority: true, progress: true, endDate: false });
      expect(c.statuses).toEqual(["Not started", "Plan submitted", "Blocked"]);   // Completed goes through Mark Done
    }
  });
  it("an engineer edits nothing on a colleague's task", () => {
    const other = task({ status: "In progress", assigned_to: "u-x", created_by: "u-x" });
    expect(cellCaps(taskCaps(base(), other, false, true), { status: "In progress", isLeaf: true }))
      .toMatchObject({ title: false, assignee: false, remarks: false, priority: false, progress: false, endDate: false, statuses: [] });
  });
  it("someone who has left the project keeps only their old rights on a task still assigned to them", () => {
    const c = cellCaps(taskCaps(base({ memberProjectIds: [] }), task({ status: "In progress" }), false, true), { status: "In progress", isLeaf: true });
    expect(c).toMatchObject({ title: false, assignee: false, remarks: false, endDate: false, priority: true, progress: true });
  });
  it("nobody types a percentage for a task with subtasks (it is calculated)", () => {
    const s = base({ isAdmin: true, userId: "u-admin" });
    expect(cellCaps(taskCaps(s, task(), true, false), { status: "In progress", isLeaf: false }).progress).toBe(false);
  });
  it("a viewer with no rights on the row edits nothing", () => {
    expect(cellCaps(undefined, { status: "In progress", isLeaf: true })).toMatchObject({ title: false, remarks: false, endDate: false, statuses: [] });
  });
});

describe("spreadsheet keys", () => {
  const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it("Ctrl+Enter (and ⌘+Enter) puts the caret at the start: no line break, no save", () => {
    expect(cellKeyAction(k("Enter", { ctrlKey: true }))).toBe("caret-start");
    expect(cellKeyAction(k("Enter", { metaKey: true }))).toBe("caret-start");
  });
  it("Enter saves and goes down; Shift+Enter is a new line; Esc cancels; other Enter chords do nothing", () => {
    expect(cellKeyAction(k("Enter"))).toBe("commit-down");
    expect(cellKeyAction(k("Enter", { shiftKey: true }))).toBe("newline");
    expect(cellKeyAction(k("Escape"))).toBe("cancel");
    expect(cellKeyAction(k("Enter", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(cellKeyAction(k("Enter", { altKey: true }))).toBeNull();
  });
  it("arrows leave the cell only from its first / last line", () => {
    expect(cellKeyAction(k("ArrowUp"), { atFirstLine: true, atLastLine: false })).toBe("up");
    expect(cellKeyAction(k("ArrowUp"), { atFirstLine: false, atLastLine: true })).toBeNull();
    expect(cellKeyAction(k("ArrowDown"), { atFirstLine: false, atLastLine: true })).toBe("down");
    expect(cellKeyAction(k("ArrowDown", { shiftKey: true }))).toBeNull();
  });
  it("knows which line the caret is on", () => {
    expect(caretLines("one\ntwo", 2, 2)).toEqual({ atFirstLine: true, atLastLine: false });
    expect(caretLines("one\ntwo", 5, 5)).toEqual({ atFirstLine: false, atLastLine: true });
  });
  it("caretToStart moves the caret to 0 and scrolls to the top", () => {
    const calls: number[][] = [];
    const el = { setSelectionRange: (a: number, b: number) => { calls.push([a, b]); }, scrollTop: 40, scrollLeft: 9 };
    caretToStart(el);
    expect(calls).toEqual([[0, 0]]);
    expect(el.scrollTop).toBe(0);
    expect(el.scrollLeft).toBe(0);
  });
});

describe("daily update steps: task → subtask", () => {
  const opt = (id: string, top: string, over: Partial<StepOption> = {}): StepOption => ({
    id, status: "In progress", choices: ["Blocked", "Completed"], is_leaf: true, done: false, label: `T ${top}`, sub: id === top ? null : `${id}. sub`,
    progress_pct: 10, top: { id: top, label: `T ${top}`, progress: 40 }, ...over,
  });
  const options = [
    opt("t1", "t1"),                                  // my task without subtasks
    opt("t2", "t2", { is_leaf: false }), opt("t2a", "t2"), opt("t2b", "t2"), // my task with my subtasks
    opt("t3a", "t3"),                                 // only a subtask of someone else's task
  ];
  it("groups by task in the given order", () => {
    const g = taskSteps(options);
    expect(g.map((x) => x.id)).toEqual(["t1", "t2", "t3"]);
    expect(g[1].own?.id).toBe("t2");
    expect(g[1].subtasks.map((s) => s.id)).toEqual(["t2a", "t2b"]);
    expect(g[2].own).toBeNull();
  });
  it("a task without subtasks offers the task itself", () => {
    const c = stepChoices(taskSteps(options)[0]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ whole: true });
    expect(c[0].option.id).toBe("t1");
    expect(c[0].text).toMatch(/No subtask/);
  });
  it("a task with subtasks offers its subtasks first, then the whole task (status only)", () => {
    const c = stepChoices(taskSteps(options)[1]);
    expect(c.map((x) => x.option.id)).toEqual(["t2a", "t2b", "t2"]);
    expect(c[2].text).toMatch(/status only/);
  });
  it("only my subtasks of someone else's task", () => {
    expect(stepChoices(taskSteps(options)[2]).map((x) => x.option.id)).toEqual(["t3a"]);
  });
  it("nothing chosen: no step 3 choices", () => {
    expect(stepChoices(undefined)).toEqual([]);
  });
  it("the percentage goes on the chosen subtask; a parent with subtasks gets no percentage", () => {
    const sub = reportItemChange({ priorTaskId: null, task: options[2], changed: true, status: "In progress", progress: "60" });
    expect(sub.items).toEqual([{ task_id: "t2a", status_after: "In progress", progress_after: 60, note: null }]);
    const parent = reportItemChange({ priorTaskId: null, task: options[1], changed: true, status: "In progress", progress: "60" });
    expect(parent.items[0].progress_after).toBeNull();
  });
  it("switching to another task removes only the previous entry of today's update (history of other days is untouched)", () => {
    const r = reportItemChange({ priorTaskId: "t1", task: options[2], changed: true, status: "In progress", progress: "30" });
    expect(r.remove_task_ids).toEqual(["t1"]);
  });
});

describe("Tasklist deadline column", () => {
  const t = (id: string, code: string, over: Partial<TasklistTask> = {}): TasklistTask => ({
    id, code, title: id, parent_id: null, status: "In progress", priority: "Normal", assigned_to: "u", assignee_name: "U",
    created_by: "u", contribution_locked: false, is_leaf: true, children: [], due: null, ...over,
  });
  it("a phase heading carries its task's deadline", () => {
    const phase = t("p", "P01-T01", { due: "2026-12-03T12:00:00Z", is_leaf: false, children: [t("c", "P01-T01a", { parent_id: "p", due: "2026-12-01T12:00:00Z" })] });
    const rows = tasklistRows([phase]);
    expect(rows[0]).toMatchObject({ kind: "phase", due: "2026-12-03T12:00:00Z" });
    expect(rows[1]).toMatchObject({ kind: "task" });
  });
  it("dates show in Dhaka time in one format, the same as Responsibilities' End Date", () => {
    // 20:00 UTC on 2 Dec is 02:00 on 3 Dec in Dhaka
    expect(sheetDay("2026-12-02T20:00:00Z")).toBe("12/3/2026");
    expect(dhakaDateOf("2026-12-02T20:00:00Z")).toBe("2026-12-03");
    expect(sheetDay(null)).toBe("");
    expect(dhakaDateOf(undefined)).toBe("");
  });
});

describe("Ctrl+Enter in every editable sheet cell", () => {
  const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it("is Ctrl+Enter or ⌘+Enter only", () => {
    expect(isCtrlEnter(k("Enter", { ctrlKey: true }))).toBe(true);
    expect(isCtrlEnter(k("Enter", { metaKey: true }))).toBe(true);
    for (const m of [{}, { shiftKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }]) expect(isCtrlEnter(k("Enter", m))).toBe(false);
    expect(isCtrlEnter(k("a", { ctrlKey: true }))).toBe(false);
  });
  const field = (tagName: string, over: Record<string, unknown> = {}) => ({ tagName, disabled: false, readOnly: false, type: "text", ...over }) as unknown as EventTarget;
  it("acts on enabled inputs, text areas and dropdowns, never on read-only or disabled cells", () => {
    for (const f of [field("TEXTAREA"), field("INPUT"), field("INPUT", { type: "date" }), field("INPUT", { type: "number" }), field("SELECT")]) expect(editableField(f)).not.toBeNull();
    for (const f of [field("SPAN"), field("A"), field("TD"), field("INPUT", { disabled: true }), field("SELECT", { disabled: true }), field("TEXTAREA", { readOnly: true }), field("INPUT", { type: "checkbox" }), null]) expect(editableField(f)).toBeNull();
  });
  it("text cells: caret to the start; dropdowns, dates and numbers: left as they are", () => {
    const calls: string[] = [];
    const mk = (tagName: string, type = "text") => ({ tagName, type, scrollTop: 5, scrollLeft: 5, setSelectionRange: () => calls.push(`${tagName}:${type}`) });
    toCellStart(mk("TEXTAREA") as never); toCellStart(mk("INPUT") as never);
    toCellStart(mk("INPUT", "date") as never); toCellStart(mk("INPUT", "number") as never); toCellStart(mk("SELECT", "") as never);
    expect(calls).toEqual(["TEXTAREA:text", "INPUT:text"]);
  });
});
