"use server";
import { createClient, type ServerClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";
import { getSession } from "@/lib/auth/session";
import { CHAT_BUCKET, CHAT_MAX_BODY, CHAT_MAX_FILES, checkChatClaim, checkChatContent, isUuid } from "@/lib/chat";
import type { Json } from "@/types/database";

export type ChatSendInput = {
  conversation_id: string;
  body: string;
  reply_to_id?: string | null;
  attachments: { storage_path: string; file_name: string }[];
};

/**
 * Sends a message that carries files. The files were uploaded by the browser (with progress) under the caller's own
 * access; here each one must sit in this conversation's folder, have an allowed extension, and its stored bytes must
 * match that type. Then send_chat_message runs as the caller: RLS and the attachment trigger check the rest (the
 * conversation, that the caller uploaded the object, size and type from Storage). Files that fail are removed again.
 */
export async function sendChatWithFiles(input: ChatSendInput): Promise<ActionResult<{ id: string }>> {
  if (!isUuid(input.conversation_id)) return { ok: false, message: "Choose a conversation." };
  if (input.reply_to_id != null && !isUuid(input.reply_to_id)) return { ok: false, message: "That reply can't be used." };
  if (typeof input.body !== "string" || input.body.length > CHAT_MAX_BODY) return { ok: false, message: "Messages are limited to 4000 characters." };
  const files = Array.isArray(input.attachments) ? input.attachments : [];
  if (files.length > CHAT_MAX_FILES) return { ok: false, message: "Attach up to 10 files to one message." };
  const s = await getSession();
  if (!s || !s.profile.active) return { ok: false, message: "Sign in again to send." };
  const supabase = await createClient();

  for (const f of files) {
    const claim = checkChatClaim(input.conversation_id, f);
    if (!claim.ok) { await removeAll(supabase, files); return claim; }
    if (!checkChatContent(claim.mime, await readHead(supabase, f.storage_path))) {
      await removeAll(supabase, files);
      return { ok: false, message: `${f.file_name} isn't a valid file of its type, so it wasn't sent.` };
    }
  }
  const { data, error } = await supabase.rpc("send_chat_message", {
    p: { conversation_id: input.conversation_id, body: input.body, reply_to_id: input.reply_to_id ?? null,
         attachments: files.map((f) => ({ storage_path: f.storage_path, file_name: f.file_name.trim() })) } as Json,
  });
  if (error) { await removeAll(supabase, files); return fail(error); }
  return { ok: true, data: { id: data } };
}

/** Deletes a message (sender, or Admin in a project chat): the row is marked deleted under RLS, then its files go. */
export async function deleteChatMessage(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, message: "That message can't be found." };
  const s = await getSession();
  if (!s || !s.profile.active) return { ok: false, message: "Sign in again." };
  const supabase = await createClient();
  const { data: files } = await supabase.from("chat_attachments").select("storage_path").eq("message_id", id);
  const { data, error } = await supabase.from("chat_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return fail(error);
  if (!data?.length) return { ok: false, message: "You don't have permission to do that." };
  const paths = (files ?? []).map((f) => f.storage_path);
  if (paths.length) await supabase.storage.from(CHAT_BUCKET).remove(paths);
  return { ok: true, message: "Message deleted" };
}

/** Removes uploaded files that will not be sent (the uploader may delete files not attached to a live message). */
export async function discardChatUploads(conversationId: string, paths: string[]): Promise<ActionResult> {
  if (!isUuid(conversationId) || !Array.isArray(paths)) return { ok: true };
  const mine = paths.filter((p) => typeof p === "string" && p.startsWith(conversationId + "/")).slice(0, CHAT_MAX_FILES);
  if (!mine.length) return { ok: true };
  const supabase = await createClient();
  await supabase.storage.from(CHAT_BUCKET).remove(mine);
  return { ok: true };
}

async function removeAll(supabase: ServerClient, files: { storage_path: string }[]) {
  const paths = files.map((f) => f.storage_path).filter((p) => typeof p === "string");
  if (paths.length) await supabase.storage.from(CHAT_BUCKET).remove(paths).catch(() => null);
}

/** The first bytes of a stored file, read with the caller's own access (short-lived signed URL); null if unreadable. */
async function readHead(supabase: ServerClient, path: string): Promise<Uint8Array | null> {
  const { data } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 60);
  if (!data?.signedUrl) return null;
  try {
    const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-4095" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (size < 4096) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value); size += value.length;
    }
    await reader.cancel().catch(() => {});
    const head = new Uint8Array(Math.min(size, 4096));
    let at = 0;
    for (const c of chunks) { const part = c.subarray(0, head.length - at); head.set(part, at); at += part.length; if (at >= head.length) break; }
    return head;
  } catch { return null; }
}
