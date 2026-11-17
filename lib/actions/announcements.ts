"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { announcementInput, type AnnouncementInput } from "@/lib/announcements";
import { id } from "@/lib/validation";
import type { Json } from "@/types/database";

/** Publish or edit. The database decides who may (RLS on every row the RPC writes) and keeps the original author. */
export async function saveAnnouncement(input: AnnouncementInput): Promise<ActionResult<string>> {
  const p = announcementInput.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Check the form" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_announcement", { p: p.data as unknown as Json });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: p.data.id ? "Announcement updated" : "Announcement published", data: data ?? undefined };
}

export async function deleteAnnouncement(announcementId: string): Promise<ActionResult> {
  if (!id.safeParse(announcementId).success) return { ok: false, message: "Not found" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("announcements").delete().eq("id", announcementId).select("id");
  if (error) return fail(error);
  if (!data?.length) return { ok: false, message: "You don't have permission to do that." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Announcement deleted" };
}

/** Opening an announcement marks it read for this user only. Idempotent. */
export async function markAnnouncementRead(announcementId: string): Promise<ActionResult> {
  if (!id.safeParse(announcementId).success) return { ok: false, message: "Not found" };
  const supabase = await createClient();
  const { error } = await supabase.from("announcement_reads")
    .upsert({ announcement_id: announcementId }, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAnnouncementUnread(announcementId: string): Promise<ActionResult> {
  if (!id.safeParse(announcementId).success) return { ok: false, message: "Not found" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Sign in again." };
  const { error } = await supabase.from("announcement_reads").delete().eq("announcement_id", announcementId).eq("user_id", auth.user.id);
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Marked as unread" };
}

export async function markAllAnnouncementsRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_announcements_read");
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "All marked as read" };
}
