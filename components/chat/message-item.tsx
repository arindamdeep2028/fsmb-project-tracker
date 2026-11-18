"use client";
import { memo, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Check, CheckCheck, Download, FileSpreadsheet, FileText, File as FileIcon, Image as ImageIcon, MoreHorizontal, Pencil, Presentation, Reply, Trash2 } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { CHAT_BUCKET, fileKind, formatBytes, isImageMime, parseBody, plainBody, timeLabel } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { Avatar, MentionChip, roleText } from "./bits";
import type { Attachment, MessageRow, PersonRow } from "./types";

const urlCache = new Map<string, { url: string; until: number }>();
async function signedUrl(path: string, download?: string): Promise<string | null> {
  const key = download ? `${path}#${download}` : path;
  const hit = urlCache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await getBrowserClient().storage.from(CHAT_BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (!data?.signedUrl) return null;
  urlCache.set(key, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

function FileBadge({ mime }: { mime: string }) {
  const k = fileKind(mime);
  const cls = "grid h-10 w-9 shrink-0 place-items-center rounded-md text-white";
  if (k === "pdf") return <span className={cn(cls, "bg-signal-red text-[10px] font-bold")}>PDF</span>;
  if (k === "excel") return <span className={cn(cls, "bg-signal-green")}><FileSpreadsheet size={18} /></span>;
  if (k === "word") return <span className={cn(cls, "bg-[#2b579a]")}><FileText size={18} /></span>;
  if (k === "powerpoint") return <span className={cn(cls, "bg-signal-amber")}><Presentation size={18} /></span>;
  if (k === "image") return <span className={cn(cls, "bg-steel")}><ImageIcon size={18} /></span>;
  return <span className={cn(cls, "bg-ink-faint")}><FileIcon size={18} /></span>;
}

function AttachmentView({ a, onOpenImage }: { a: Attachment; onOpenImage: (url: string, name: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = isImageMime(a.mime_type);
  useEffect(() => {
    if (!image) return;
    let live = true;
    signedUrl(a.storage_path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [a.storage_path, image]);
  const download = async () => {
    const u = await signedUrl(a.storage_path, a.file_name);
    if (u) { const link = document.createElement("a"); link.href = u; link.rel = "noopener"; link.click(); }
  };
  if (image) {
    return (
      <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-panel" data-testid="chat-attachment">
        <button type="button" onClick={() => url && onOpenImage(url, a.file_name)} className="block" aria-label={`Preview ${a.file_name}`}>
          {url ? <img src={url} alt={a.file_name} className="max-h-60 max-w-[16rem] object-cover" /> : <div className="grid h-32 w-56 place-items-center text-xs text-ink-faint">Loading preview…</div>}
        </button>
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-ink">
          <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
          <span className="text-ink-faint">{formatBytes(a.size_bytes)}</span>
          <button type="button" onClick={download} className="rounded p-1 text-ink-soft hover:bg-steel-wash hover:text-steel" aria-label={`Download ${a.file_name}`}><Download size={15} /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex w-80 max-w-full items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-ink" data-testid="chat-attachment" title={a.file_name}>
      <FileBadge mime={a.mime_type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{a.file_name}</div>
        <div className="text-xs text-ink-faint">{formatBytes(a.size_bytes)}</div>
      </div>
      {a.mime_type === "application/pdf" ? (
        <button type="button" onClick={async () => { const u = await signedUrl(a.storage_path); if (u) window.open(u, "_blank", "noopener"); }}
          className="rounded px-1.5 py-1 text-xs text-steel hover:bg-steel-wash">Open</button>
      ) : null}
      <button type="button" onClick={download} className="rounded p-1.5 text-ink-soft hover:bg-steel-wash hover:text-steel" aria-label={`Download ${a.file_name}`}><Download size={17} /></button>
    </div>
  );
}

type EditRow = { previous_body: string; edited_at: string };
/** "Edited" beside a changed message; opens the edit history (previous versions kept in chat_message_edits). */
function EditedTag({ m, mine }: { m: MessageRow; mine: boolean }) {
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const load = async () => {
    const { data } = await getBrowserClient().from("chat_message_edits").select("previous_body, edited_at")
      .eq("message_id", m.id).order("edited_at", { ascending: true });
    setRows(data ?? []);
  };
  return (
    <Popover.Root onOpenChange={(open) => { if (open) void load(); }}>
      <Popover.Trigger asChild>
        <button type="button" data-testid="edited-tag" title={m.edited_at ? "Edited " + timeLabel(m.edited_at) : "Edited"}
          className={cn("ml-1.5 text-[11px] italic underline-offset-2 hover:underline", mine ? "text-white/75" : "text-ink-faint")}>
          Edited
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-72 rounded-lg border border-line bg-panel p-3 text-sm shadow-lg" data-testid="edit-history">
          <div className="mb-2 font-semibold">Edit history</div>
          {rows === null ? <div className="text-xs text-ink-faint">Loading…</div> : (
            <ol className="max-h-64 space-y-2 overflow-y-auto">
              {rows.map((r, i) => (
                <li key={i} className="rounded-md bg-paper px-2 py-1.5" data-testid="edit-version">
                  <div className="text-[11px] text-ink-faint">{i === 0 ? "Original" : "Version " + (i + 1)} · replaced at {timeLabel(r.edited_at)}</div>
                  <div className="whitespace-pre-wrap break-words text-ink-soft">{plainBody(r.previous_body) || "(no text)"}</div>
                </li>
              ))}
              <li className="rounded-md border border-line px-2 py-1.5">
                <div className="text-[11px] text-ink-faint">Current</div>
                <div className="whitespace-pre-wrap break-words">{plainBody(m.body) || "(no text)"}</div>
              </li>
            </ol>
          )}
          <Popover.Arrow className="fill-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type Receipt = { seenBy: string[]; total: number } | null;

type Props = {
  m: MessageRow; mine: boolean; grouped: boolean; people: Map<string, PersonRow>; meId: string; canSeeProfiles: boolean;
  receipt: Receipt; highlight: boolean; canDelete: boolean; canEdit: boolean; beforeJoin: boolean; editing: boolean;
  onReply: (m: MessageRow) => void; onJump: (id: string) => void; onDelete: (id: string) => void; onEdit: (m: MessageRow) => void;
  onOpenImage: (url: string, name: string) => void; onMessagePerson?: (userId: string) => void;
};

export const MessageItem = memo(function MessageItem(p: Props) {
  const { m, mine } = p;
  const sender = m.sender_id ? p.people.get(m.sender_id) : undefined;
  // ---- swipe left to reply (touch)
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);   // the release reads the ref: a fast swipe can end before React re-renders
  const start = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, horizontal: null }; dxRef.current = 0; };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current; if (!s || m.deleted || m.pending) return;
    const t = e.touches[0]; const ddx = t.clientX - s.x; const ddy = t.clientY - s.y;
    if (s.horizontal === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) s.horizontal = Math.abs(ddx) > Math.abs(ddy);
    if (s.horizontal) { dxRef.current = Math.max(-90, Math.min(0, ddx)); setDx(dxRef.current); }
  };
  const onTouchEnd = () => { if (dxRef.current <= -60) p.onReply(m); dxRef.current = 0; setDx(0); start.current = null; };

  const segments = parseBody(m.body);
  const mentionsMe = m.mention_ids?.includes(p.meId);
  return (
    <div id={`msg-${m.id}`} data-testid="chat-message" data-message-id={m.id}
      className={cn("group relative flex gap-2.5 px-3 md:px-5", p.grouped ? "mt-1" : "mt-4", mine && "flex-row-reverse",
        p.highlight && "animate-pulse")}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="w-9 shrink-0">{!p.grouped ? <Avatar id={m.sender_id} name={m.sender_name} /> : null}</div>
      <div className={cn("relative flex min-w-0 max-w-[78%] flex-col md:max-w-[68%]", mine && "items-end")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 150ms" }}>
        {!p.grouped ? (
          <div className={cn("mb-1 flex items-baseline gap-2 text-sm", mine && "flex-row-reverse")}>
            <span className="font-semibold text-ink">{mine ? "You" : m.sender_name ?? "Former member"}</span>
            {!mine && sender ? <span className="text-xs text-ink-soft">({roleText(sender)})</span> : null}
            <span className="text-xs text-ink-faint">{timeLabel(m.created_at)}</span>
            {p.beforeJoin ? <span className="text-[11px] text-ink-faint">· before you joined</span> : null}
          </div>
        ) : null}
        <div className={cn("relative rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed shadow-sm",
          mine ? "rounded-tr-md bg-steel text-white" : "rounded-tl-md bg-steel-wash text-ink",
          mentionsMe && !mine && "border-l-4 border-sage",
          p.highlight && "ring-2 ring-signal-amber",
          p.editing && "ring-2 ring-sage",
          m.deleted && "bg-transparent italic text-ink-faint shadow-none ring-1 ring-line")}>
          {m.reply_to_id && !m.deleted ? (
            <button type="button" onClick={() => p.onJump(m.reply_to_id!)} data-testid="reply-quote"
              className={cn("mb-1.5 block w-full rounded-md border-l-4 px-2 py-1 text-left text-xs",
                mine ? "border-white/70 bg-white/15 text-white/90" : "border-steel bg-panel text-ink-soft")}>
              <span className="flex items-center gap-1 font-semibold"><Reply size={12} /> {m.reply_sender_id === p.meId ? "You" : m.reply_sender_name ?? "Former member"}</span>
              <span className="line-clamp-2">{m.reply_deleted ? "Message deleted" : plainBody(m.reply_body ?? "") || "File"}</span>
            </button>
          ) : null}
          {m.deleted ? <span>This message was deleted</span> : (
            <span className="whitespace-pre-wrap break-words">
              {segments.map((s, i) => s.kind === "text" ? <span key={i}>{s.text}</span> : (
                <MentionChip key={i} name={s.name} userId={s.userId} person={p.people.get(s.userId)} mine={mine}
                  canSeeProfile={p.canSeeProfiles} onMessage={s.userId !== p.meId ? p.onMessagePerson : undefined} />
              ))}
            </span>
          )}
          {m.edited_at && !m.deleted ? <EditedTag m={m} mine={mine} /> : null}
          {mine && !m.deleted ? (
            <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[11px] text-white/80" data-testid="read-receipt"
              title={m.pending ? "Sending…" : p.receipt && p.receipt.seenBy.length ? `Seen by ${p.receipt.seenBy.join(", ")}` : "Sent"}>
              {p.grouped ? timeLabel(m.created_at) : null}
              {m.pending ? <Check size={14} className="opacity-50" /> : p.receipt && p.receipt.seenBy.length ? (
                <CheckCheck size={15} className={p.receipt.seenBy.length >= p.receipt.total ? "text-[#a8e6c1]" : ""} aria-label={`Seen by ${p.receipt.seenBy.length}`} />
              ) : <Check size={14} aria-label="Sent" />}
            </span>
          ) : null}
        </div>
        {!m.deleted && m.attachments.length ? (
          <div className={cn("flex flex-col", mine && "items-end")}>
            {m.attachments.map((a) => <AttachmentView key={a.id} a={a} onOpenImage={p.onOpenImage} />)}
          </div>
        ) : null}
        {/* swipe hint revealed under the bubble */}
        {dx < 0 ? (
          <span className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-[calc(100%+8px)] flex-col items-center rounded-lg bg-steel px-2 py-1 text-xs text-white"
            style={{ opacity: Math.min(1, -dx / 60) }}>
            <Reply size={16} /> Reply
          </span>
        ) : null}
      </div>
      {!m.deleted && !m.pending ? (
        <div className="flex items-start gap-0.5 self-center transition-opacity md:invisible md:opacity-0 md:group-hover:visible md:group-hover:opacity-100 md:group-focus-within:visible md:group-focus-within:opacity-100">
          <button type="button" onClick={() => p.onReply(m)} data-testid="reply-button"
            className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-xs text-ink-soft shadow-sm hover:border-steel hover:text-steel max-md:hidden" aria-label="Reply">
            <Reply size={14} /> Reply
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" data-testid="message-menu" aria-label="Message options"
                className="rounded-md border border-line bg-panel p-1 text-ink-soft shadow-sm hover:border-steel hover:text-steel">
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align={mine ? "end" : "start"} sideOffset={4} className="z-50 min-w-36 rounded-lg border border-line bg-panel p-1 text-sm shadow-lg">
                <DropdownMenu.Item onSelect={() => p.onReply(m)} data-testid="menu-reply" className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-steel-wash">
                  <Reply size={14} /> Reply
                </DropdownMenu.Item>
                {p.canEdit ? (
                  <DropdownMenu.Item onSelect={() => p.onEdit(m)} data-testid="menu-edit" className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-steel-wash">
                    <Pencil size={14} /> Edit
                  </DropdownMenu.Item>
                ) : null}
                {p.canDelete ? (
                  <DropdownMenu.Item onSelect={() => p.onDelete(m.id)} data-testid="menu-delete" className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-signal-red outline-none data-[highlighted]:bg-signal-red/10">
                    <Trash2 size={14} /> Delete
                  </DropdownMenu.Item>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      ) : null}
    </div>
  );
});
