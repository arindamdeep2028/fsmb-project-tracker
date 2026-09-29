import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export async function unreadCount(userId: string) {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("read_at", null);
  return count ?? 0;
}

export async function listNotifications(userId: string, opts: { type?: Enums<"notification_type">; unread?: boolean; page?: number } = {}) {
  const supabase = await createClient();
  const page = opts.page ?? 0;
  let q = supabase.from("notifications").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).range(page * 50, page * 50 + 49);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.unread) q = q.is("read_at", null);
  const { data } = await q;
  return data ?? [];
}

export async function getPreferences(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("notification_preferences").select("*").eq("user_id", userId);
  return data ?? [];
}
