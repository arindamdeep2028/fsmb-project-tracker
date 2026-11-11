import { describe, expect, it } from "vitest";
import {
  lifecycleOf, nextStatuses, parseCategory, parseLifecycle, projectStatusLabel, projectStatusTone, transitionLabel,
} from "@/lib/project-status";
import { projectInput, projectStatusInput, projectUpdateInput } from "@/lib/validation";

describe("project lifecycle (migration 24)", () => {
  it("shows the stored values as Running / Halted / Completed", () => {
    expect(projectStatusLabel("Active")).toBe("Running");
    expect(projectStatusLabel("On hold")).toBe("Halted");
    expect(projectStatusLabel("Completed")).toBe("Completed");
    expect(projectStatusTone("Active")).toBe("running");
    expect(projectStatusTone("On hold")).toBe("halted");
    expect(projectStatusTone("Completed")).toBe("closed");
  });

  it("offers exactly the allowed moves", () => {
    expect(nextStatuses("Active")).toEqual(["On hold", "Completed"]);
    expect(nextStatuses("On hold")).toEqual(["Active", "Completed"]);
    expect(nextStatuses("Completed")).toEqual(["Active"]);           // a normal change, like Halted → Running
    expect(nextStatuses("Cancelled")).toEqual([]);
    expect(transitionLabel("Completed", "Active")).toBe("Set as Running");
    expect(transitionLabel("On hold", "Active")).toBe("Set as Running");
    expect(transitionLabel("Active", "On hold")).toBe("Set as Halted");
  });

  it("reads filters and categories from the URL, including dashboard links made before categories", () => {
    expect(parseLifecycle("running")).toBe("running");
    expect(parseLifecycle("Active")).toBe("running");           // /projects?status=Active from the dashboards
    expect(parseLifecycle("On hold")).toBe("halted");
    expect(parseLifecycle("bogus")).toBeUndefined();
    expect(lifecycleOf("Cancelled")).toBeUndefined();
    expect(parseCategory("embedded")).toBe("Embedded");
    expect(parseCategory("Optical")).toBe("Optical");
    expect(parseCategory("hardware")).toBeUndefined();
  });
});

describe("project validation", () => {
  it("a partial edit never resets the status (Zod 4 applies defaults inside .partial())", () => {
    expect(projectUpdateInput.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(projectUpdateInput.parse({ category: "Optical" })).toEqual({ category: "Optical" });
  });

  it("a new project carries its category", () => {
    const p = projectInput.parse({ code: "E01", name: "Board", department_id: "d0000000-0000-0000-0000-000000000003", category: "Embedded" });
    expect(p.category).toBe("Embedded");
    expect(p.status).toBe("Active");
  });

  it("a status change takes only lifecycle statuses and a short reason", () => {
    const id = "aaaaaaaa-0000-0000-0000-000000000001";
    expect(projectStatusInput.safeParse({ projectId: id, status: "On hold", reason: "Waiting for parts" }).success).toBe(true);
    expect(projectStatusInput.safeParse({ projectId: id, status: "Cancelled" }).success).toBe(false);
    expect(projectStatusInput.safeParse({ projectId: id, status: "Active", reason: "x".repeat(1001) }).success).toBe(false);
  });
});
