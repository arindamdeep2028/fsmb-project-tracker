import { describe, expect, it } from "vitest";
import {
  announcementInput, departmentCounts, expiryDay, filterAnnouncements, parseTab, priorityTone, sortAnnouncements, tabCounts,
  type Announcement,
} from "@/lib/announcements";
import { navFor } from "@/lib/auth/nav";
import type { Session } from "@/lib/auth/session";

const SW = "00000000-0000-4000-8000-0000000000a1";
const EE = "00000000-0000-4000-8000-0000000000a2";
const P1 = "00000000-0000-4000-8000-0000000000b1";

function ann(p: Partial<Announcement>): Announcement {
  return {
    id: p.title ?? "x", kind: "general", project_id: null, project_code: null, project_name: null, title: "x", message: "m",
    priority: "Normal", pinned: false, expires_at: null, expired: false, published_at: "2026-11-10T04:00:00Z",
    author_id: null, author_name: "Admin", author_role: "admin", updated_at: null, updated_by_name: null, updated_by_role: null,
    department_ids: [SW], department_names: ["SW Team"], read_at: null, can_edit: false, readers: null, audience: null, ...p,
  };
}

const items = [
  ann({ title: "old general", published_at: "2026-11-01T04:00:00Z", read_at: "2026-11-02T04:00:00Z" }),
  ann({ title: "new general", published_at: "2026-11-15T04:00:00Z", department_ids: [SW, EE], department_names: ["SW Team", "EE Team"] }),
  ann({ title: "pinned old", published_at: "2026-10-01T04:00:00Z", pinned: true }),
  ann({ title: "project", kind: "project", project_id: P1, project_code: "001", department_ids: [], department_names: [] }),
  ann({ title: "expired", expired: true, expires_at: "2026-11-05T18:00:00Z" }),
];

describe("announcement lists", () => {
  it("puts pinned first, then newest first", () => {
    expect(sortAnnouncements(items).map((a) => a.title).slice(0, 3)).toEqual(["pinned old", "new general", "project"]);
  });

  it("All keeps read ones and leaves expired ones out", () => {
    const all = filterAnnouncements(items, "all").map((a) => a.title);
    expect(all).toContain("old general");      // read, still listed
    expect(all).not.toContain("expired");
    expect(all).toHaveLength(4);
  });

  it("Unread, General, Projects and Expired tabs", () => {
    expect(filterAnnouncements(items, "unread").map((a) => a.title)).toEqual(["pinned old", "new general", "project"]);
    expect(filterAnnouncements(items, "general")).toHaveLength(3);
    expect(filterAnnouncements(items, "projects").map((a) => a.title)).toEqual(["project"]);
    expect(filterAnnouncements(items, "expired").map((a) => a.title)).toEqual(["expired"]);
    expect(tabCounts(items)).toEqual({ all: 4, unread: 3, general: 3, projects: 1, expired: 1 });
  });

  it("an expired unread announcement does not count as unread", () => {
    expect(filterAnnouncements([ann({ expired: true })], "unread")).toHaveLength(0);
  });

  it("filters by department and counts each department once per active announcement", () => {
    expect(filterAnnouncements(items, "all", EE).map((a) => a.title)).toEqual(["new general"]);
    expect(departmentCounts(items)).toEqual([{ id: EE, name: "EE Team", count: 1 }, { id: SW, name: "SW Team", count: 3 }]);
  });

  it("parses tabs safely", () => {
    expect(parseTab("unread")).toBe("unread");
    expect(parseTab("nonsense")).toBe("all");
    expect(parseTab(undefined)).toBe("all");
  });

  it("tints by priority", () => {
    expect(priorityTone("Urgent")).toBe("red");
    expect(priorityTone("Important")).toBe("amber");
    expect(priorityTone("Normal")).toBe("green");
  });

  it("shows the expiry as the last Dhaka day it is visible", () => {
    // expiry date 19 Nov is stored as the start of the next Dhaka day: 2026-11-20 00:00 +06:00 = 2026-11-19T18:00Z
    expect(expiryDay("2026-11-19T18:00:00Z")).toBe("2026-11-19");
    expect(expiryDay(null)).toBeNull();
  });
});

describe("announcement form validation", () => {
  const base = { title: "Site visit", message: "Be there", priority: "Important" as const };
  it("a general announcement needs a department", () => {
    expect(announcementInput.safeParse({ ...base, kind: "general", department_ids: [] }).success).toBe(false);
    const ok = announcementInput.parse({ ...base, kind: "general", department_ids: [SW, SW, EE], project_id: P1 });
    expect(ok.department_ids).toEqual([SW, EE]);   // duplicates dropped
    expect(ok.project_id).toBeNull();              // a general one never carries a project
  });
  it("a project announcement needs a project and drops departments", () => {
    expect(announcementInput.safeParse({ ...base, kind: "project" }).success).toBe(false);
    const ok = announcementInput.parse({ ...base, kind: "project", project_id: P1, department_ids: [SW] });
    expect(ok.department_ids).toEqual([]);
  });
  it("rejects empty titles, unknown priorities and bad dates", () => {
    expect(announcementInput.safeParse({ ...base, title: "  ", kind: "general", department_ids: [SW] }).success).toBe(false);
    expect(announcementInput.safeParse({ ...base, priority: "Low", kind: "general", department_ids: [SW] }).success).toBe(false);
    expect(announcementInput.safeParse({ ...base, kind: "general", department_ids: [SW], expires_on: "20/11/2026" }).success).toBe(false);
    expect(announcementInput.parse({ ...base, kind: "general", department_ids: [SW], expires_on: "" }).expires_on).toBeNull();
  });
});

describe("sidebar", () => {
  const session = (p: Partial<Session>): Session => ({
    userId: "u", email: null, isAdmin: false, headedDepartmentIds: [], pmProjectIds: [], memberProjectIds: [],
    profile: {} as Session["profile"], ...p,
  });
  for (const [who, s] of [
    ["admin", session({ isAdmin: true })], ["engineer", session({})], ["PM", session({ pmProjectIds: ["p"] })],
    ["department head", session({ headedDepartmentIds: ["d"] })],
  ] as const) {
    it(`${who}: Announcement, then Project Chat directly below it, then Notifications`, () => {
      const nav = navFor(s);
      const i = nav.findIndex((n) => n.href === "/announcements");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(nav[i + 1]).toMatchObject({ href: "/chat", label: "Project Chat", icon: "chat" });
      expect(nav[i + 2].href).toBe("/notifications");
      expect(nav[i]).toMatchObject({ label: "Announcement", icon: "megaphone" });
    });
  }
});
