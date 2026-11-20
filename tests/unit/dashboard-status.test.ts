import { describe, expect, it } from "vitest";
import { bucketOf, statusBreakdown, weekStart, weekTaskStatus } from "@/lib/dashboard-status";

describe("Engineer dashboard status panels", () => {
  it("groups the five task statuses into four (Plan submitted is Not Started)", () => {
    expect(["Completed", "In progress", "Blocked", "Not started", "Plan submitted"].map(bucketOf))
      .toEqual(["Completed", "In Progress", "Blocked", "Not Started", "Not Started"]);
  });
  it("percentages are whole numbers that add up to 100", () => {
    const s = statusBreakdown(["Completed", "Completed", "In progress", "Not started", "Plan submitted", "Blocked"]);
    expect(s.map((x) => [x.bucket, x.count])).toEqual([["Completed", 2], ["In Progress", 1], ["Not Started", 2], ["Blocked", 1]]);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBe(100);
    const thirds = statusBreakdown(["Completed", "In progress", "Blocked"]);
    expect(thirds.map((x) => x.pct)).toEqual([34, 33, 0, 33]);
  });
  it("nothing to count: all zero", () => {
    expect(statusBreakdown([]).every((x) => x.count === 0 && x.pct === 0)).toBe(true);
  });
  it("the week starts on Monday (Dhaka dates)", () => {
    expect(weekStart("2026-11-20")).toBe("2026-11-16");   // Friday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");   // Monday
    expect(weekStart("2026-11-22")).toBe("2026-11-16");   // Sunday
  });
  it("this week: completed since Monday, open tasks as they stand (their total = Open tasks)", () => {
    const open = [{ status: "In progress" }, { status: "Plan submitted" }, { status: "Not started" }, { status: "Blocked" }, { status: "In progress" }];
    const w = weekTaskStatus(open, ["2026-11-15", "2026-11-16", "2026-11-20"], "2026-11-16");
    expect(w).toEqual({ Completed: 2, "In Progress": 2, "Not Started": 2, Blocked: 1 });
    expect(w["In Progress"] + w["Not Started"] + w.Blocked).toBe(open.length);
  });
});
