/**
 * Ctrl+V screenshots for the Daily Reports uploader: which pasted files are taken as images to attach, and the
 * names they get. Pure functions (no DOM), so the rules are unit-tested.
 */

export type PasteInput = {
  /** the files on the clipboard (a screenshot arrives as one image file, usually "image.png") */
  files: File[];
  /** the clipboard also holds text */
  hasText: boolean;
  /** the paste happens inside a text field (textarea, input, contenteditable) */
  inTextField: boolean;
};

/**
 * The pasted images to stage, or null to leave the paste to the browser. Text pasted into a text field stays
 * text, even when the clipboard also carries a picture of it (Word, Excel and web pages put both); a paste with
 * no image at all is never touched.
 */
export function pastedImages({ files, hasText, inTextField }: PasteInput): File[] | null {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!images.length) return null;
  if (inTextField && hasText) return null;
  return images;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif", "image/bmp": "bmp" };
const pad = (n: number) => String(n).padStart(2, "0");

/** True for the placeholder names browsers give clipboard images ("image.png", "image", "blob"). */
export const genericName = (name: string) => !name || /^(image|blob|clipboard|untitled)(\.\w+)?$/i.test(name.trim());

/** "screenshot-2026-11-16-14-05-09.png"; several from one paste get "-2", "-3", … */
export function screenshotName(at: Date, index: number, mime: string): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `screenshot-${stamp}${index > 0 ? `-${index + 1}` : ""}.${EXT[mime] ?? "png"}`;
}

/** The pasted file under a readable name; a file that already has a real name (copied from a folder) keeps it. */
export function namePasted(file: File, at: Date, index: number): File {
  if (!genericName(file.name)) return file;
  return new File([file], screenshotName(at, index, file.type), { type: file.type, lastModified: at.getTime() });
}
