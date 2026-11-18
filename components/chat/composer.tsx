"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AtSign, Check, Loader2, Paperclip, Pencil, Plus, Reply, SendHorizontal, Smile, X } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { discardChatUploads } from "@/lib/actions/chat";
import {
  CHAT_ACCEPT, CHAT_BUCKET, CHAT_MAX_BODY, CHAT_MAX_FILES, activeMentionQuery, chatFilePath, checkChatFile,
  encodeMentions, filterMentionable, formatBytes, parseBody, plainBody, type Mentionable,
} from "@/lib/chat";
import { cn } from "@/lib/utils";
import { Avatar, roleText } from "./bits";
import type { MessageRow, PersonRow } from "./types";

type Upload = { key: string; name: string; size: number; mime: string; path: string; progress: number; status: "uploading" | "ready" | "error"; error?: string; xhr?: XMLHttpRequest };
export type SendPayload = { body: string; attachments: { storage_path: string; file_name: string }[] };

const EMOJI = ["👍", "🙏", "✅", "👌", "🎉", "😊", "😂", "🙂", "🤝", "👏", "🔥", "💡", "⚠️", "❗", "📎", "📄", "⏰", "📌", "✔️", "❌", "🚀", "👀", "💯", "😅"];

function upload(file: File, path: string, mime: string, token: string, onProgress: (n: number) => void): { xhr: XMLHttpRequest; done: Promise<void> } {
  const xhr = new XMLHttpRequest();
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${CHAT_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "Upload failed";
      try { msg = JSON.parse(xhr.responseText).message ?? msg; } catch { /* keep generic */ }
      reject(new Error(/mime|type/i.test(msg) ? "This file type isn't allowed" : /size|large/i.test(msg) ? "The file is too large" : msg));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
  return { xhr, done };
}

export function Composer({ conversationId, canPost, people, meId, replyTo, onCancelReply, onSend, onMentionOpen, disabledReason,
  editing, onCancelEdit, onSaveEdit }: {
  conversationId: string; canPost: boolean; people: PersonRow[]; meId: string; replyTo: MessageRow | null;
  onCancelReply: () => void; onSend: (p: SendPayload) => Promise<boolean>; onMentionOpen?: () => void; disabledReason?: string;
  /** a message being edited: the composer holds its text; Save replaces the message (no new message) */
  editing?: MessageRow | null; onCancelEdit?: () => void; onSaveEdit?: (body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadsRef = useRef<Upload[]>([]);
  uploadsRef.current = uploads;

  const options = useMemo(() => (mention ? filterMentionable(people, mention.query, meId).slice(0, 8) : []), [mention, people, meId]);

  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  // entering / leaving edit mode: load the message's text (mentions shown as @Name and remembered), or clear it
  const editId = editing?.id ?? null;
  useEffect(() => {
    if (!editing) { setText(""); setPicked([]); return; }
    const segs = parseBody(editing.body);
    setText(plainBody(editing.body));
    setPicked(segs.flatMap((x) => (x.kind === "mention" ? [{ user_id: x.userId, full_name: x.name }] : [])));
    setMention(null);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); autosize(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);
  // leaving the conversation: uploads that were never sent are removed again
  useEffect(() => () => {
    const left = uploadsRef.current;
    left.forEach((u) => u.xhr?.abort());
    const paths = left.filter((u) => u.status === "ready").map((u) => u.path);
    if (paths.length) void discardChatUploads(conversationId, paths);
  }, [conversationId]);

  const autosize = () => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; } };
  const updateMention = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret);
    if (next && !mention) onMentionOpen?.();
    setMention(next); setActive(0);
  };

  const choose = (p: PersonRow) => {
    if (!mention || !ta.current) return;
    const caret = ta.current.selectionStart;
    const insert = `@${p.full_name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setPicked((xs) => (xs.some((x) => x.user_id === p.user_id) ? xs : [...xs, { user_id: p.user_id, full_name: p.full_name }]));
    setMention(null);
    requestAnimationFrame(() => { const pos = mention.start + insert.length; ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); autosize(); });
  };

  const addFiles = async (files: File[]) => {
    setNotice(null);
    if (!files.length) return;
    if (uploadsRef.current.length + files.length > CHAT_MAX_FILES) { setNotice(`Attach up to ${CHAT_MAX_FILES} files to one message.`); return; }
    const { data } = await getBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setNotice("Sign in again to upload files."); return; }
    for (const file of files) {
      const check = checkChatFile(file);
      if (!check.ok) { setNotice(check.message); continue; }
      const key = crypto.randomUUID();
      const path = chatFilePath(conversationId, file.name);
      const entry: Upload = { key, name: file.name, size: file.size, mime: check.mime, path, progress: 0, status: "uploading" };
      const { xhr, done } = upload(file, path, check.mime, token, (n) => setUploads((xs) => xs.map((u) => (u.key === key ? { ...u, progress: n } : u))));
      entry.xhr = xhr;
      setUploads((xs) => [...xs, entry]);
      done.then(() => setUploads((xs) => xs.map((u) => (u.key === key ? { ...u, progress: 100, status: "ready", xhr: undefined } : u))))
        .catch((e: Error) => setUploads((xs) => xs.map((u) => (u.key === key ? { ...u, status: "error", error: e.message, xhr: undefined } : u))));
    }
  };

  const removeUpload = (u: Upload) => {
    u.xhr?.abort();
    setUploads((xs) => xs.filter((x) => x.key !== u.key));
    if (u.status === "ready") void discardChatUploads(conversationId, [u.path]);
  };

  const ready = uploads.filter((u) => u.status === "ready");
  const busy = uploads.some((u) => u.status === "uploading");
  const canSend = canPost && !sending && !busy && text.length <= CHAT_MAX_BODY
    && (editing ? text.trim().length > 0 || editing.attachments.length > 0 : text.trim().length > 0 || ready.length > 0);

  const send = async () => {
    if (!canSend) return;
    if (editing && onSaveEdit) {
      setSending(true); setNotice(null);
      const ok = await onSaveEdit(encodeMentions(text.trim(), picked));
      setSending(false);
      if (ok) { setText(""); setPicked([]); setMention(null); requestAnimationFrame(() => { autosize(); ta.current?.focus(); }); }
      return;
    }
    setSending(true); setNotice(null);
    const body = encodeMentions(text.trim(), picked);
    const ok = await onSend({ body, attachments: ready.map((u) => ({ storage_path: u.path, file_name: u.name })) });
    setSending(false);
    if (ok) {
      setText(""); setPicked([]); setUploads((xs) => xs.filter((u) => u.status !== "ready")); setMention(null);
      requestAnimationFrame(() => { autosize(); ta.current?.focus(); });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && options.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Escape" && editing) { onCancelEdit?.(); return; }
    if (e.key === "Escape" && replyTo) { onCancelReply(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };

  const insertAt = (s: string) => {
    const el = ta.current; const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret); const pad = s === "@" && before && !/\s$/.test(before) ? " " : "";
    const next = before + pad + s + text.slice(caret);
    setText(next);
    requestAnimationFrame(() => { const pos = caret + pad.length + s.length; el?.focus(); el?.setSelectionRange(pos, pos); updateMention(next, pos); autosize(); });
  };

  if (!canPost) {
    return <div className="border-t border-line bg-panel px-4 py-3 text-sm text-ink-soft" data-testid="composer-disabled">{disabledReason ?? "You can read this conversation but can't send messages."}</div>;
  }

  return (
    <div className="relative border-t border-line bg-panel px-3 pb-3 pt-2 md:px-4" data-testid="composer">
      {editing ? (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-4 border-sage bg-paper px-3 py-2 text-sm" data-testid="edit-preview">
          <Pencil size={15} className="mt-0.5 shrink-0 text-steel" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-steel">Editing message</div>
            <div className="truncate text-ink-soft">{plainBody(editing.body) || editing.attachments.map((a) => a.file_name).join(", ")}</div>
          </div>
          <button type="button" onClick={onCancelEdit} className="rounded p-1 text-ink-soft hover:bg-panel" aria-label="Cancel edit"><X size={15} /></button>
        </div>
      ) : null}
      {replyTo && !editing ? (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-4 border-steel bg-steel-wash px-3 py-2 text-sm" data-testid="reply-preview">
          <Reply size={15} className="mt-0.5 shrink-0 text-steel" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-steel">Replying to {replyTo.sender_id === meId ? "yourself" : replyTo.sender_name ?? "a former member"}</div>
            <div className="truncate text-ink-soft">{plainBody(replyTo.body) || (replyTo.attachments.length ? replyTo.attachments.map((a) => a.file_name).join(", ") : "")}</div>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded p-1 text-ink-soft hover:bg-panel" aria-label="Cancel reply"><X size={15} /></button>
        </div>
      ) : null}
      {uploads.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
          {uploads.map((u) => (
            <li key={u.key} data-testid="upload-chip" data-status={u.status}
              className={cn("relative flex w-56 items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-xs", u.status === "error" ? "border-signal-red/40 bg-signal-red/5" : "border-line bg-paper")}>
              <Paperclip size={14} className="shrink-0 text-ink-soft" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{u.name}</div>
                <div className={u.status === "error" ? "text-signal-red" : "text-ink-faint"}>
                  {u.status === "error" ? u.error : u.status === "uploading" ? `Uploading ${u.progress}% · ${formatBytes(u.size)}` : formatBytes(u.size)}
                </div>
              </div>
              <button type="button" onClick={() => removeUpload(u)} className="rounded p-0.5 text-ink-soft hover:text-signal-red" aria-label={`Remove ${u.name}`}><X size={14} /></button>
              {u.status === "uploading" ? <span className="absolute bottom-0 left-0 h-0.5 bg-steel transition-[width]" style={{ width: `${u.progress}%` }} role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="mb-2 text-sm text-signal-red" role="alert">{notice}</p> : null}

      {mention && options.length ? (
        <div className="absolute bottom-full left-3 z-30 mb-1 w-72 overflow-hidden rounded-lg border border-line bg-panel shadow-lg md:left-14" role="listbox" aria-label="Mention a member" data-testid="mention-list">
          <div className="border-b border-line-soft px-3 py-1.5 text-xs text-ink-soft">@ Mention a member</div>
          {options.map((p, i) => (
            <button key={p.user_id} type="button" role="option" aria-selected={i === active} data-testid="mention-option"
              onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}
              className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm", i === active ? "bg-steel-wash" : "hover:bg-paper")}>
              <Avatar id={p.user_id} name={p.full_name} size={28} />
              <span className="min-w-0"><span className="block truncate font-medium">{p.full_name}</span><span className="block text-xs text-ink-soft">{roleText(p)}</span></span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" multiple accept={CHAT_ACCEPT} className="hidden" data-testid="chat-file-input"
          onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={!!editing} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-ink-soft hover:border-steel hover:text-steel disabled:opacity-40" aria-label="Attach files">
          <Plus size={20} />
        </button>
        <div className="flex min-h-10 flex-1 items-end rounded-2xl border border-line bg-panel focus-within:border-steel focus-within:ring-2 focus-within:ring-steel/20">
          <textarea ref={ta} value={text} rows={1} maxLength={CHAT_MAX_BODY} placeholder="Type a message…" aria-label="Message (type @ to mention a member)"
            data-testid="chat-input"
            onChange={(e) => { setText(e.target.value); updateMention(e.target.value, e.target.selectionStart); autosize(); }}
            onKeyDown={onKeyDown}
            onClick={(e) => updateMention(text, e.currentTarget.selectionStart)}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void addFiles(files); } }}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3.5 py-2 text-[15px] outline-none focus-visible:outline-none" />
          <button type="button" onClick={() => insertAt("@")} className="mb-1.5 rounded p-1 text-ink-soft hover:text-steel" aria-label="Mention someone"><AtSign size={18} /></button>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="mb-1.5 mr-2 rounded p-1 text-ink-soft hover:text-steel" aria-label="Insert emoji"><Smile size={18} /></button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="end" sideOffset={8} className="z-50 grid w-64 grid-cols-8 gap-1 rounded-lg border border-line bg-panel p-2 shadow-lg">
                {EMOJI.map((e) => <Popover.Close key={e} asChild><button type="button" onClick={() => insertAt(e)} className="rounded p-1 text-lg hover:bg-steel-wash">{e}</button></Popover.Close>)}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <button type="button" onClick={() => void send()} disabled={!canSend} data-testid="chat-send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel text-white hover:bg-steel-dark disabled:bg-ink-faint" aria-label={editing ? "Save edit" : "Send"}>
          {sending || busy ? <Loader2 size={18} className="animate-spin" /> : editing ? <Check size={18} /> : <SendHorizontal size={18} />}
        </button>
      </div>
    </div>
  );
}
