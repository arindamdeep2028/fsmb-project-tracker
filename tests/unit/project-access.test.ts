import { describe, expect, it } from "vitest";
import { dateRange, isOffDay, letterOf, projectDayNumber, sheetDate, slOf, taskLabel, weekday } from "@/lib/sheet";
import { projectRolesFor, taskCaps } from "@/lib/auth/capabilities";
import type { Session } from "@/lib/auth/session";

describe("workbook Task list numbering", () => {
  it("SL comes from the task code, the sub-task letter from its suffix", () => {
    expect(slOf("P03-T04")).toBe("4");
    expect(slOf("P03-T12b")).toBe("12");
    expect(letterOf("P03-T04")).toBe("");
    expect(letterOf("P03-T04b")).toBe("b");
    expect(taskLabel("P03-T04", "Natural language input")).toBe("4. Natural language input");
    expect(taskLabel("P03-T04a", "Die center detection")).toBe("4a. Die center detection");
  });
});

describe("Daily Follow Up dates (calendar days, as in the workbook)", () => {
  it("counts Day N from the project start, weekends included", () => {
    // workbook: project started 10-Aug-26 → 25-Sep-26 is Day 47, 30-Sep-26 is Day 52
    expect(projectDayNumber("2026-08-10", "2026-09-25")).toBe(47);
    expect(projectDayNumber("2026-08-10", "2026-09-30")).toBe(52);
    expect(projectDayNumber("2026-08-10", "2026-08-10")).toBe(1);
    expect(projectDayNumber("2026-08-10", "2026-08-09")).toBeNull();
    expect(projectDayNumber(null, "2026-08-09")).toBeNull();
  });
  it("formats the Date and Day columns like the sheet and shades non-working days", () => {
    expect(sheetDate("2026-09-25")).toBe("25-Sep-26");
    expect(weekday("2026-09-25")).toBe("Friday");
    expect(isOffDay("2026-09-26")).toBe(true);   // Saturday
    expect(isOffDay("2026-09-28")).toBe(false);  // Monday
    expect(dateRange("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("project membership roles (mirror of the project_members trigger)", () => {
  it("engineer accounts join as Engineer; PM-only accounts need an Admin or Department Head", () => {
    expect(projectRolesFor("engineer", false)).toEqual(["engineer"]);
    expect(projectRolesFor("pm", false)).toEqual(["engineer"]);
    expect(projectRolesFor("pm", true)).toEqual(["engineer", "pm"]);
    expect(projectRolesFor("dept_head", true)).toEqual(["pm"]);
    expect(projectRolesFor("admin", true)).toEqual(["pm"]);
    expect(projectRolesFor("dept_head", false)).toEqual([]);
  });
});

describe("a member sees colleagues' tasks but works only on their own", () => {
  const s = { userId: "me", email: null, isAdmin: false, headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: ["p1"],
    profile: { role: "engineer" } as Session["profile"] } satisfies Session;
  const task = (assigned_to: string) => ({ project_id: "p1", assigned_to, created_by: "pm", status: "In progress" as const, contribution_locked: false });
  it("no controls on a colleague's task", () => {
    const c = taskCaps(s, task("colleague"), false, true);
    expect(c.statuses).toEqual([]);
    expect(c.progress).toBe(false);
    expect(c.comment).toBe(false);
  });
  it("status and progress on my own task", () => {
    const c = taskCaps(s, task("me"), false, true);
    expect(c.statuses).toEqual(["Blocked", "Completed"]);
    expect(c.progress).toBe(true);
  });
});

describe("partial task updates write only what was sent", () => {
  it("a status change does not clear the description (Remarks) or blocker note", async () => {
    const { taskPatch } = await import("@/lib/validation");
    expect(taskPatch.parse({ status: "In progress" })).toEqual({ status: "In progress" });
    expect(taskPatch.parse({ description: "  " }).description).toBeNull();
    expect(taskPatch.parse({ description: " Pre-phase work " }).description).toBe("Pre-phase work");
  });
});
