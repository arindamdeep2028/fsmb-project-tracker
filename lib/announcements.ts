import { z } from "zod";
import { id } from "@/lib/validation";
import type { Database } from "@/types/database";

/** One row of public.announcement_feed(): only what the database lets this user read (RLS). */
export type Announcement = Database["public"]["Functions"]["announcement_feed"]["Returns"][number];
export type AnnouncementPriority = Announcement["priority"];
export type AnnouncementTab = "all" | "unread" | "general" | "projects" | "expired";

export const ANNOUNCEMENT_PRIORITIES: AnnouncementPriority[] = ["Normal", "Important", "Urgent"];
export const ANNOUNCEMENT_TABS: AnnouncementTab[] = ["all", "unread", "general", "projects", "expired"];

export function parseTab(v: string | undefined): AnnouncementTab {
  return ANNOUNCEMENT_TABS.includes(v as AnnouncementTab) ? (v as AnnouncementTab) : "all";
}

export const isActive = (a: Pick<Announcement, "expired">) => !a.expired;
export const isUnread = (a: Pick<Announcement, "read_at" | "expired">) => !a.read_at && !a.expired;

/** Pinned first, then newest first (the database already orders them so; kept here so filters never reorder). */
export function sortAnnouncements<T extends Pick<Announcement, "pinned" | "published_at">>(xs: T[]): T[] {
  return [...xs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.published_at.localeCompare(a.published_at));
}

/** Department chip: general announcements that target this department (project ones have no department). */
export function inDepartment(a: Pick<Announcement, "department_ids">, dept: string | undefined) {
  return !dept || a.department_ids.includes(dept);
}

/**
 * The list for one tab. Active views (All, Unread, General, Projects) leave expired announcements out;
 * the Expired tab shows only those. Nothing is ever removed by reading: All keeps read ones.
 */
export function filterAnnouncements(items: Announcement[], tab: AnnouncementTab, dept?: string): Announcement[] {
  const byDept = dept ? items.filter((a) => a.kind === "general" && inDepartment(a, dept)) : items;
  const pick = (a: Announcement) => {
    switch (tab) {
      case "expired": return a.expired;
      case "unread": return isUnread(a);
      case "general": return isActive(a) && a.kind === "general";
      case "projects": return isActive(a) && a.kind === "project";
      default: return isActive(a);
    }
  };
  return sortAnnouncements(byDept.filter(pick));
}

export function tabCounts(items: Announcement[], dept?: string): Record<AnnouncementTab, number> {
  return Object.fromEntries(ANNOUNCEMENT_TABS.map((t) => [t, filterAnnouncements(items, t, dept).length])) as Record<AnnouncementTab, number>;
}

/** Department chips with counts of active general announcements (Admin and publishers see this filter). */
export function departmentCounts(items: Announcement[]): { id: string; name: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const a of items) {
    if (a.kind !== "general" || a.expired) continue;
    a.department_ids.forEach((d, i) => {
      const cur = m.get(d) ?? { id: d, name: a.department_names[i] ?? "", count: 0 };
      cur.count += 1;
      m.set(d, cur);
    });
  }
  return [...m.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** Card tint follows the priority. */
export function priorityTone(p: AnnouncementPriority): "red" | "amber" | "green" {
  return p === "Urgent" ? "red" : p === "Important" ? "amber" : "green";
}

/** yyyy-mm-dd (Dhaka) of the last day an announcement is shown, from its stored expires_at (end of that day). */
export function expiryDay(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const d = new Date(new Date(expiresAt).getTime() - 1);                 // the last instant of the day
  return new Date(d.getTime() + 6 * 3600e3).toISOString().slice(0, 10);  // Asia/Dhaka is UTC+6, no DST
}

export const announcementInput = z
  .object({
    id: id.optional().nullable(),
    kind: z.enum(["general", "project"]),
    project_id: id.optional().nullable(),
    department_ids: z.array(id).default([]),
    title: z.string().trim().min(1, "Give the announcement a title").max(200, "Keep the title under 200 characters"),
    message: z.string().trim().min(1, "Write the announcement details").max(5000, "Keep the message under 5,000 characters"),
    priority: z.enum(["Normal", "Important", "Urgent"]).default("Normal"),
    pinned: z.boolean().default(false),
    expires_on: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "general" && v.department_ids.length === 0) ctx.addIssue({ code: "custom", path: ["department_ids"], message: "Choose at least one department" });
    if (v.kind === "project" && !v.project_id) ctx.addIssue({ code: "custom", path: ["project_id"], message: "Choose a project" });
  })
  .transform((v) => ({
    ...v,
    project_id: v.kind === "project" ? v.project_id ?? null : null,
    department_ids: v.kind === "general" ? [...new Set(v.department_ids)] : [],
    expires_on: v.expires_on || null,
  }));
export type AnnouncementInput = z.input<typeof announcementInput>;

export type AnnouncementTargets = { departments: { id: string; name: string }[]; projects: { id: string; code: string; name: string }[] };
