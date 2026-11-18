import { sniffFileType } from "@/lib/uploads";

/**
 * Project Chat helpers: pure, shared by the browser and the Server Actions (tests/unit/chat.test.ts).
 *
 * Mentions are stored in a message body as @[Name](user-uuid). The database (migration 29) checks that every
 * mentioned person may read the conversation and records them in chat_mentions; the app only builds and renders the
 * markup. While typing, the composer shows plain "@Name" and remembers which people were picked.
 */

export const CHAT_BUCKET = "chat-files";
export const CHAT_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_MAX_FILES = 10;
export const CHAT_MAX_BODY = 4000;

const UUID_RE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const isUuid = (v: unknown): v is string => typeof v === "string" && new RegExp(`^${UUID_RE}$`).test(v);

// ---------------------------------------------------------------- mentions
export type Mentionable = { user_id: string; full_name: string };
export type Segment = { kind: "text"; text: string } | { kind: "mention"; name: string; userId: string };

const cleanName = (n: string) => n.replace(/[\[\]()\n]/g, "").trim().slice(0, 120) || "Member";

/** The markup for one mention. */
export const mentionMarkup = (p: Mentionable) => `@[${cleanName(p.full_name)}](${p.user_id})`;

/** Turns the typed text (with "@Name" for each picked person) into stored markup. Longer names first, so "@Ana Rahman"
 *  wins over "@Ana". A picked person whose "@Name" was deleted from the text is not mentioned. */
export function encodeMentions(text: string, picked: Mentionable[]): string {
  const uniq = [...new Map(picked.map((p) => [p.user_id, p])).values()].sort((a, b) => b.full_name.length - a.full_name.length);
  if (!uniq.length) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(${uniq.map((p) => esc(cleanName(p.full_name))).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const byName = new Map(uniq.map((p) => [cleanName(p.full_name), p]));
  return text.replace(re, (_m, name: string) => mentionMarkup(byName.get(name)!));
}

/** Splits a stored body into text and mention segments for display. */
export function parseBody(body: string): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(`@\\[([^\\]\\n]{1,120})\\]\\((${UUID_RE})\\)`, "g");
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push({ kind: "text", text: body.slice(last, m.index) });
    out.push({ kind: "mention", name: m[1], userId: m[2].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** Plain text of a body ("@Name" for mentions): previews and notifications. */
export const plainBody = (body: string) => parseBody(body).map((s) => (s.kind === "text" ? s.text : `@${s.name}`)).join("");

/** The "@query" the caret is in, if any: an @ at the start or after a space, then up to 30 non-newline characters. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s{2}/.test(query)) return null;
  return { start: at, query };
}

/** People matching a mention query: name starts with it first, then contains it. */
export function filterMentionable<T extends Mentionable>(people: T[], query: string, exclude?: string): T[] {
  const q = query.trim().toLowerCase();
  const list = people.filter((p) => p.user_id !== exclude);
  if (!q) return list;
  const starts = list.filter((p) => p.full_name.toLowerCase().startsWith(q) || p.full_name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  const contains = list.filter((p) => !starts.includes(p) && p.full_name.toLowerCase().includes(q));
  return [...starts, ...contains];
}

// ---------------------------------------------------------------- files
const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heic",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel",
  txt: "text/plain", csv: "text/csv",
};
export const CHAT_ACCEPT = Object.keys(TYPES).map((e) => "." + e).join(",");
export const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** The type a file is stored as, from its extension (browsers report CSV, HEIC and Office types inconsistently). */
export const chatMimeFor = (name: string): string | null => TYPES[extOf(name)] ?? null;

export function checkChatFile(f: { name: string; size: number }): { ok: true; mime: string } | { ok: false; message: string } {
  const mime = chatMimeFor(f.name);
  if (!mime) return { ok: false, message: `${f.name}: this file type can't be shared. Use images, PDF, Word, Excel, PowerPoint, text or CSV.` };
  if (f.size < 1) return { ok: false, message: `${f.name} is empty.` };
  if (f.size > CHAT_MAX_BYTES) return { ok: false, message: `${f.name} is larger than 25 MB.` };
  return { ok: true, mime };
}

export function chatFileName(name: string): string {
  const ext = extOf(name);
  const base = (ext ? name.slice(0, name.length - ext.length - 1) : name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 80) || "file";
  return ext ? `${base}.${ext}` : base;
}

/** {conversation_id}/{uuid}/{safe file name}: the Storage policy checks the conversation in the first part. */
export const chatFilePath = (conversationId: string, name: string, id: string = crypto.randomUUID()) =>
  `${conversationId}/${id}/${chatFileName(name)}`;

const CHAT_PATH = new RegExp(`^(${UUID_RE})/(${UUID_RE})/[a-z0-9._-]{1,100}$`);

/** Checks an attachment claim before it is sent: the path is in this conversation's folder and its extension is allowed. */
export function checkChatClaim(conversationId: string, c: { storage_path: string; file_name: string }): { ok: true; mime: string } | { ok: false; message: string } {
  const m = CHAT_PATH.exec(c.storage_path);
  if (!m || m[1].toLowerCase() !== conversationId.toLowerCase()) return { ok: false, message: "That file doesn't belong to this conversation." };
  if (typeof c.file_name !== "string" || !c.file_name.trim() || c.file_name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(c.file_name)) return { ok: false, message: "That file name can't be used." };
  const mime = chatMimeFor(c.storage_path);
  if (!mime) return { ok: false, message: `${c.file_name}: this file type can't be shared.` };
  return { ok: true, mime };
}

/** The stored bytes must be the kind of file the name says (a renamed script or page is refused). */
export function checkChatContent(mime: string, head: Uint8Array | null): boolean {
  if (!head || head.length === 0) return false;
  const starts = (sig: number[]) => head.length >= sig.length && sig.every((v, i) => head[i] === v);
  if (mime === "image/gif") return starts([0x47, 0x49, 0x46, 0x38]);
  if (mime === "application/msword" || mime === "application/vnd.ms-excel") return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (mime === "text/plain" || mime === "text/csv") {
    if (head.includes(0)) return false;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head).trimStart().toLowerCase();
    return !(text.startsWith("<!doctype") || text.startsWith("<html") || text.startsWith("<script") || text.startsWith("<svg"));
  }
  const kind = sniffFileType(head);
  if (mime.includes("openxmlformats")) return kind === "ooxml";
  return kind === mime;
}

export const isImageMime = (m: string) => m.startsWith("image/") && m !== "image/heic";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileKind(mime: string): "image" | "pdf" | "word" | "excel" | "powerpoint" | "text" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("word")) return "word";
  if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel" || mime === "text/csv") return "excel";
  if (mime.includes("presentation")) return "powerpoint";
  if (mime === "text/plain") return "text";
  return "file";
}

// ---------------------------------------------------------------- people and time
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const AVATAR = ["#34483c", "#7a5c3e", "#2e7d55", "#5b6878", "#8a6d1f", "#4f6b7a", "#7b4f5f", "#506557"];
export function avatarColor(id: string | null | undefined): string {
  let h = 0;
  for (const ch of id ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

const TZ = "Asia/Dhaka";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** "Today, 18 Nov 2026" / "Yesterday, 17 Nov 2026" / "Mon, 16 Nov 2026" (Dhaka time). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const full = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d);
  if (dayKey(d) === dayKey(now)) return `Today, ${full}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return `Yesterday, ${full}`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(d)}, ${full}`;
}
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Conversation list time: "10:24 AM" today, "Yesterday", or "Nov 17". */
export function listTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return timeLabel(iso);
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);
}
