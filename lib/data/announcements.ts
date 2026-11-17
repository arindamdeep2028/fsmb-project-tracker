import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Announcement, AnnouncementTargets } from "@/lib/announcements";

/** Everything this user may read (RLS decides; Admin gets every announcement). Expired ones included, flagged. */
export async function getAnnouncementFeed(): Promise<Announcement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("announcement_feed");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Active, unread, visible to this user: the sidebar badge. */
export async function announcementUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("announcement_unread_count");
  return data ?? 0;
}

/** Departments and projects this user may publish to (empty for engineers). */
export async function getAnnouncementTargets(): Promise<AnnouncementTargets> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("announcement_targets");
  const t = (data ?? {}) as Partial<AnnouncementTargets>;
  return { departments: t.departments ?? [], projects: t.projects ?? [] };
}
