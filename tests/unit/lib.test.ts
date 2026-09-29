import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/errors";
import { fromLocalInput, toLocalInput } from "@/lib/time";
import { reportFilePath, safeFileName } from "@/lib/storage";
import { deadlineSignal } from "@/lib/labels";

describe("error mapping (v2 §14.9)", () => {
  it("refused writes get one generic message", () => {
    expect(describeError({ code: "42501", message: "Only the head of this department…" })).toBe("You don't have permission to do that.");
  });
  it("rule failures show the rule's sentence", () => {
    expect(describeError({ code: "23514", message: "Reassign this member's open tasks before removing them" }))
      .toBe("Reassign this member's open tasks before removing them");
  });
  it("report history blocks deletes with a clear alternative", () => {
    expect(describeError({ code: "23503" })).toMatch(/archive it instead/i);
  });
});

describe("Dhaka time", () => {
  it("round-trips a Dhaka wall-clock value through UTC", () => {
    const iso = fromLocalInput("2026-10-05T18:00");
    expect(iso).toBe("2026-10-05T12:00:00.000Z");
    expect(toLocalInput(iso)).toBe("2026-10-05T18:00");
  });
});

describe("storage paths", () => {
  it("puts project and report first, as the Storage policy requires", () => {
    const p = reportFilePath("proj", "rep", "Site Photo (1).JPG");
    expect(p).toMatch(/^proj\/rep\/[0-9a-f-]{36}-site-photo-1\.jpg$/);
  });
  it("strips unsafe characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("....etcpasswd");
  });
});

describe("signal rail", () => {
  it("red wins over any deadline status", () => {
    expect(deadlineSignal("on_track", true)).toBe("red");
    expect(deadlineSignal("due_soon")).toBe("amber");
    expect(deadlineSignal("completed_on_time")).toBe("done");
  });
});
