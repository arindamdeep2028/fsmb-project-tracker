import { describe, expect, it } from "vitest";
import { DAILY_HEAD, dailyCsvLine, type DailyRow } from "@/lib/sheet";
import { reportOrder } from "@/lib/auth/capabilities";
import { overdueReports, overdueWindowStart, type OverdueInput } from "@/lib/overdue";
import { dailyRowInput } from "@/lib/validation";
import type { Session } from "@/lib/auth/session";

const session = (role: Session["profile"]["role"], extra: Partial<Session> = {}): Session => ({
  userId: "me", email: null, isAdmin: role === "admin", headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: [],
  profile: { role } as Session["profile"], ...extra,
});

describe("Daily Reports sheet format", () => {
  const head = ["Day", "Date", "Days", "Task", "Assigned To", "Status", "Issues", "Next Task", "Remarks"];
  it("has the nine columns of the reference sheet, in order, on screen and in the CSV", () => {
    expect([...DAILY_HEAD]).toEqual(head);
  });
  it("puts the main task, subtask and the day's work in the Task column", () => {
    const row: DailyRow = {
      key: "r1", date: "2026-10-05", dayNo: 57, offDay: false, reportId: "r1", userId: "u1", locked: true, edit: null,
      mainTask: [{ label: "4. Vision alignment", sub: "a. Die center detection", status: "In progress" }],
      dailySubTask: "a. Tuned threshold\nb. Logged 20 samples", assignedTo: "Rahim", issues: "Camera drift", nextTask: "Calibrate", remarks: "",
    };
    expect(dailyCsvLine(row)).toEqual([
      "Day 57", "5-Oct-26", "Monday", "4. Vision alignment / a. Die center detection\na. Tuned threshold\nb. Logged 20 samples",
      "Rahim", "In progress", "Camera drift", "Calibrate", "",
    ]);
    expect(dailyCsvLine(row)).toHaveLength(head.length);
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
