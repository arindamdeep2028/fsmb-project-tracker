import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Unread chat messages across every conversation the caller may read (sidebar badge). */
export async function chatUnreadTotal(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_unread_total");
  return error ? 0 : (data ?? 0);
}

/** The caller's conversations (project chats they may read + their direct conversations), newest first. */
export async function chatInbox() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("chat_inbox");
  return data ?? [];
}
