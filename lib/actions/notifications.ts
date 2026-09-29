"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import type { Enums } from "@/types/database";

export async function markRead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", auth.user!.id).is("read_at", null);
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "All marked as read" };
}

export async function deleteNotification(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/notifications");
  return { ok: true };
}

export async function savePreferences(rows: { type: Enums<"notification_type">; in_app: boolean; email: boolean }[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const mandatory = new Set(["task_assigned", "task_overdue"]);
  const { error } = await supabase.from("notification_preferences").upsert(
    rows.map((r) => ({ user_id: auth.user!.id, type: r.type, in_app: mandatory.has(r.type) ? true : r.in_app, email: r.email })),
    { onConflict: "user_id,type" },
  );
  if (error) return fail(error);
  revalidatePath("/settings");
  return { ok: true, message: "Preferences saved" };
}
