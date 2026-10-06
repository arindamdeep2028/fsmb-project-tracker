import { ALLOWED_TYPES, MAX_BYTES } from "@/lib/storage";

/**
 * Checks on a file attached to a daily report, beyond what the browser says about it. Pure; the Server Action
 * (lib/actions/reports.ts recordAttachment) supplies the first bytes of the stored object. Tests:
 * tests/unit/uploads.test.ts.
 *
 * The declared type, the file name's extension and the file's own signature (its first bytes) must all agree,
 * so a script or an HTML page renamed to .jpg or .pdf is refused. The database then takes size and type from the
 * stored object itself (migration 23), and the bucket enforces the type list and the 10 MB limit.
 */
type Mime = (typeof ALLOWED_TYPES)[number];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const EXTENSIONS: Record<Mime, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"], "image/heic": ["heic", "heif"],
  "application/pdf": ["pdf"], [DOCX]: ["docx"], [XLSX]: ["xlsx"], [PPTX]: ["pptx"],
};
const OOXML_PARTS = ["[Content_Types].xml", "_rels/", "docProps/", "word/", "xl/", "ppt/"];
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(${UUID})/${UUID}-[a-z0-9._-]{1,100}$`, "i");

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const starts = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** The kind of file the bytes are, from their signature; null when it is none of the kinds the app accepts. */
export function sniffFileType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf" | "ooxml" | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(b, 8, 12))) return "image/heic";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  // Word, Excel and PowerPoint files are ZIP archives that open with their package parts
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) && OOXML_PARTS.some((part) => ascii(b, 0, Math.min(b.length, 4096)).includes(part))) return "ooxml";
  return null;
}

export type UploadClaim = { report_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number };

/** Checks that need no file content: type list, size, name, extension, and that the path is this report's folder. */
export function checkUploadClaim(c: UploadClaim): { ok: true; projectId: string } | { ok: false; message: string } {
  if (!(ALLOWED_TYPES as readonly string[]).includes(c.mime_type)) return { ok: false, message: "That file type isn't allowed" };
  if (!Number.isInteger(c.size_bytes) || c.size_bytes < 1) return { ok: false, message: "That file is empty" };
  if (c.size_bytes > MAX_BYTES) return { ok: false, message: "Files are limited to 10 MB" };
  if (typeof c.file_name !== "string" || c.file_name.length < 1 || c.file_name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(c.file_name)) return { ok: false, message: "That file name can't be used" };
  const m = PATH.exec(c.storage_path);
  if (!m || m[2].toLowerCase() !== c.report_id.toLowerCase()) return { ok: false, message: "That file doesn't belong to this report" };
  const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
  const allowed = EXTENSIONS[c.mime_type as Mime];
  // the stored name: a resized photo is stored as .jpg whatever the original was called
  if (!allowed.includes(ext(c.storage_path))) return { ok: false, message: `${c.file_name}: the file name doesn't match its type` };
  return { ok: true, projectId: m[1] };
}

/** The stored bytes must be the kind of file the upload claimed to be. */
export function checkUploadContent(c: Pick<UploadClaim, "file_name" | "mime_type">, head: Uint8Array | null): { ok: true } | { ok: false; message: string } {
  if (!head || head.length === 0) return { ok: false, message: `${c.file_name} couldn't be read back after the upload. Try again.` };
  const kind = sniffFileType(head);
  const expected = [DOCX, XLSX, PPTX].includes(c.mime_type) ? "ooxml" : c.mime_type;
  if (kind !== expected) return { ok: false, message: `${c.file_name} isn't a valid ${describe(c.mime_type)}, so it wasn't attached.` };
  return { ok: true };
}

function describe(mime: string): string {
  if (mime.startsWith("image/")) return "photo";
  if (mime === "application/pdf") return "PDF";
  return mime === DOCX ? "Word file" : mime === XLSX ? "Excel file" : "PowerPoint file";
}
