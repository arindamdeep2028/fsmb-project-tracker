import { describe, expect, it } from "vitest";
import { DAILY_HEAD, DAILY_WIDTHS, dailyExcelLine, dayGroups, remarksFor, remarksForDay, rowDateChoice, sheetStatus, type DailyRow, type DayRemark } from "@/lib/sheet";
import { reportOrder } from "@/lib/auth/capabilities";
import { overdueReports, overdueWindowStart, type OverdueInput } from "@/lib/overdue";
import { dailyRowInput } from "@/lib/validation";
import type { Session } from "@/lib/auth/session";

const session = (role: Session["profile"]["role"], extra: Partial<Session> = {}): Session => ({
  userId: "me", email: null, isAdmin: role === "admin", headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: [],
  profile: { role } as Session["profile"], ...extra,
});

describe("Daily Reports sheet format", () => {
  const head = ["Day", "Date", "Days", "Task", "Assigned To", "Working Hours", "Status", "Issues", "Next Task", "Attachment", "Remarks"];
  it("has the eleven columns of the redesigned sheet, in order, on screen and in the Excel export", () => {
    expect([...DAILY_HEAD]).toEqual(head);
    expect(DAILY_WIDTHS).toHaveLength(head.length);
  });
  it("shows task statuses in the sheet words (Done, On-Going, Pending) without changing the stored value", () => {
    expect(sheetStatus("Completed")).toBe("Done");
    expect(sheetStatus("In progress")).toBe("On-Going");
    expect(sheetStatus("Not started")).toBe("Pending");
    expect(sheetStatus("Blocked")).toBe("Blocked");
    expect(sheetStatus(null)).toBe("");
  });
  it("puts the main task, subtask and the day's work in the Task column, and hours, files and remarks in theirs", () => {
    const row: DailyRow = {
      key: "r1", date: "2026-10-05", dayNo: 57, offDay: false, reportId: "r1", userId: "u1", locked: true, edit: null,
      mainTask: [{ label: "4. Vision alignment", sub: "a. Die center detection", status: "In progress" }],
      dailySubTask: "a. Tuned threshold\nb. Logged 20 samples", assignedTo: "Rahim", issues: "Camera drift", nextTask: "Calibrate", remarks: "",
      hours: 4.5, fileCount: 3,
    };
    const remark: DayRemark = { id: "m1", date: "2026-10-05", recipientId: "u1", recipient: "Rahim", authorId: "a", author: "Admin One", body: "Finish the calibration", createdAt: "2026-10-05T09:20:00Z", updatedAt: "2026-10-05T09:20:00Z", edited: false };
    expect(dailyExcelLine(row, [remark])).toEqual([
      "Day 57", "5-Oct-26", "Monday", "4. Vision alignment / a. Die center detection\na. Tuned threshold\nb. Logged 20 samples",
      "Rahim", 4.5, "On-Going", "Camera drift", "Calibrate", 3, "Finish the calibration (from Admin One to Rahim)",
    ]);
    expect(dailyExcelLine(row)).toHaveLength(head.length);
    expect(dailyExcelLine({ ...row, hours: null, fileCount: 0 })[5]).toBeNull();
    expect(dailyExcelLine({ ...row, hours: null, fileCount: 0 })[9]).toBe("");
  });
});

describe("remarks per row and per day", () => {
  const line = (key: string, userId: string | null, remarks = ""): DailyRow => ({
    key, date: "2026-11-17", dayNo: 43, offDay: false, reportId: userId ? key : null, userId, locked: false, edit: null,
    mainTask: [], dailySubTask: "x", assignedTo: userId ?? "", issues: "", nextTask: "", remarks,
  });
  const m = (id: string, to: string, date = "2026-11-17", at = "2026-11-17T09:00:00Z"): DayRemark => ({ id, date, recipientId: to, recipient: to, authorId: "admin", author: "Admin", body: id, createdAt: at, updatedAt: at, edited: false });
  it("gives a person only the Admin remarks addressed to them that day, then their own saved note", () => {
    const got = remarksFor(line("r1", "deep", "old note"), [m("a", "deep"), m("b", "imam"), m("c", "deep", "2026-11-16")]);
    expect(got.map((x) => x.id)).toEqual(["a", "legacy-r1"]);
    expect(got[1]).toMatchObject({ legacy: true, body: "old note", author: "deep" });
  });
  it("collects every remark of a project day, oldest first, including one to a person with no report that day", () => {
    const got = remarksForDay([line("r1", "deep"), line("r2", "imam")], [m("late", "imam", "2026-11-17", "2026-11-17T10:00:00Z"), m("early", "anik", "2026-11-17", "2026-11-17T08:00:00Z"), m("other", "deep", "2026-11-15")]);
    expect(got.map((x) => x.id)).toEqual(["early", "late"]);
  });
});

describe("project-day rows", () => {
  const line = (key: string, date: string, userId: string | null): DailyRow => ({
    key, date, dayNo: 1, offDay: false, reportId: userId ? key : null, userId, locked: false, edit: null,
    mainTask: [], dailySubTask: "", assignedTo: userId ?? "", issues: "", nextTask: "", remarks: "",
  });
  it("puts several people's updates for one date in one row, keeping each update and its order", () => {
    const rows = [line("a", "2026-11-13", "deep"), line("b", "2026-11-13", "imam"), line("c", "2026-11-13", "masrur"), line("d", "2026-11-12", "deep"), line("e", "2026-11-11", null)];
    const g = dayGroups(rows);
    expect(g.map((x) => x.map((r) => r.key))).toEqual([["a", "b", "c"], ["d"], ["e"]]);
    expect(g.flat()).toEqual(rows);   // nothing merged, dropped or reordered
  });
  it("keeps different dates in separate rows, in either order", () => {
    expect(dayGroups([line("a", "2026-11-11", "deep"), line("b", "2026-11-12", "imam")]).length).toBe(2);
    expect(dayGroups([])).toEqual([]);
  });
});

describe("daily report order by role", () => {
  it("Admin, Department Head and Project Manager read newest first", () => {
    expect(reportOrder(session("admin"))).toBe("desc");
    expect(reportOrder(session("dept_head", { headedDepartmentIds: ["d1"] }))).toBe("desc");
    expect(reportOrder(session("pm", { pmProjectIds: ["p1"] }))).toBe("desc");
    expect(reportOrder(session("pm"))).toBe("desc");
  });
  it("an Engineer reads oldest first, from Day 1", () => {
    expect(reportOrder(session("engineer", { memberProjectIds: ["p1"] }))).toBe("asc");
  });
});

describe("overdue daily reports", () => {
  // Tuesday 6 Oct 2026; the project started on Monday 28 Sep, Rahim and Karim joined that day.
  const base = (): OverdueInput => ({
    today: "2026-10-06",
    projects: [{ id: "p1", code: "P01", name: "Bonder", start: "2026-09-28" }],
    members: [
      { project_id: "p1", user_id: "rahim", full_name: "Rahim", added: "2026-09-28" },
      { project_id: "p1", user_id: "karim", full_name: "Karim", added: "2026-09-28" },
    ],
    tasks: [{ project_id: "p1", assigned_to: "rahim", assigned: "2026-09-30", completed: null }],
    reports: [{ project_id: "p1", user_id: "rahim", report_date: "2026-10-01" }],
  });
  const dates = (i: OverdueInput) => overdueReports(i).map((x) => `${x.fullName} ${x.date}`);

  it("lists each required working day with no saved report, newest first, once", () => {
    // assigned Wed 30 Sep: due 30 Sep, 1 Oct (saved), 2 Oct, then Mon 5 Oct; not the weekend, not today
    expect(dates(base())).toEqual(["Rahim 2026-10-05", "Rahim 2026-10-02", "Rahim 2026-09-30"]);
    const items = overdueReports(base());
    expect(new Set(items.map((x) => x.key)).size).toBe(items.length);
    expect(items[0]).toMatchObject({ projectId: "p1", projectCode: "P01", userId: "rahim", dayNo: 8 });
  });
  it("never lists a day that has a saved report, and saving one removes it", () => {
    const i = base();
    i.reports.push({ project_id: "p1", user_id: "rahim", report_date: "2026-10-05" });
    expect(dates(i)).toEqual(["Rahim 2026-10-02", "Rahim 2026-09-30"]);
  });
  it("requires nothing from a member with no task, before a task was assigned or after it was completed", () => {
    const i = base();
    expect(dates(i).some((d) => d.startsWith("Karim"))).toBe(false);
    i.tasks = [{ project_id: "p1", assigned_to: "rahim", assigned: "2026-09-30", completed: "2026-10-02" }];
    expect(dates(i)).toEqual(["Rahim 2026-09-30"]);   // open at the end of 30 Sep and 1 Oct (saved); completed on 2 Oct
  });
  it("does not repeat a day when the person has several open tasks", () => {
    const i = base();
    i.tasks.push({ project_id: "p1", assigned_to: "rahim", assigned: "2026-09-30", completed: null });
    expect(dates(i)).toEqual(["Rahim 2026-10-05", "Rahim 2026-10-02", "Rahim 2026-09-30"]);
  });
  it("starts at the project's Day 1 and the day the person joined, and respects the working week", () => {
    const i = base();
    i.tasks = [{ project_id: "p1", assigned_to: "rahim", assigned: "2026-09-01", completed: null }];
    i.reports = [];
    expect(dates(i).at(-1)).toBe("Rahim 2026-09-28");
    i.members[0].added = "2026-10-02";
    expect(dates(i)).toEqual(["Rahim 2026-10-05", "Rahim 2026-10-02"]);
    i.workdays = [1, 2, 3, 4, 5, 6];
    expect(dates(i)).toEqual(["Rahim 2026-10-05", "Rahim 2026-10-03", "Rahim 2026-10-02"]);
  });
  it("skips projects outside the viewer's scope and looks back a fixed window", () => {
    const i = base();
    i.projects = [];
    expect(overdueReports(i)).toEqual([]);
    expect(overdueWindowStart("2026-10-06")).toBe("2026-09-06");
    const j = base();
    j.projects[0].start = "2026-01-01"; j.members[0].added = "2026-01-01"; j.reports = [];
    j.tasks = [{ project_id: "p1", assigned_to: "rahim", assigned: "2026-01-01", completed: null }];
    expect(dates(j).at(-1)).toBe("Rahim 2026-09-07");   // Monday; 6 Sep is a Sunday
  });
});

describe("daily row input", () => {
  const row = {
    project_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", report_date: "2026-10-05",
    task_id: null, update_text: "Did the work", status: null, progress: null, issues: "", next_task_text: "", remarks: "",
  };
  it("a new row carries no report id; an edit names the saved report", () => {
    expect(dailyRowInput.parse(row).report_id ?? null).toBeNull();
    expect(dailyRowInput.parse({ ...row, report_id: "33333333-3333-4333-8333-333333333333" }).report_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(dailyRowInput.safeParse({ ...row, report_id: "not-an-id" }).success).toBe(false);
  });
});

describe("the dates a new Daily Update row may be given", () => {
  it("an Admin picks any day from the project's Day 1 to today", () => {
    expect(rowDateChoice(true, "2026-10-01", "2026-10-06")).toEqual({ min: "2026-10-01", max: "2026-10-06", fixed: false });
  });
  it("an Admin has nothing to pick when Day 1 is today or later", () => {
    expect(rowDateChoice(true, "2026-10-06", "2026-10-06")).toEqual({ min: "2026-10-06", max: "2026-10-06", fixed: true });
    expect(rowDateChoice(true, "2026-10-09", "2026-10-06")).toEqual({ min: "2026-10-06", max: "2026-10-06", fixed: true });
  });
  it("everyone else writes today's row only", () => {
    expect(rowDateChoice(false, "2026-10-01", "2026-10-06")).toEqual({ min: "2026-10-06", max: "2026-10-06", fixed: true });
  });
});
