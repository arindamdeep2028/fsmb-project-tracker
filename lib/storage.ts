export const BUCKET = "daily-report-files";
export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 80) || "file";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return ext ? `${base}.${ext}` : base;
}

/** {project_id}/{report_id}/{uuid}-{safe file name} — the Storage policy checks the first two parts. */
export function reportFilePath(projectId: string, reportId: string, fileName: string): string {
  return `${projectId}/${reportId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}
export const isImage = (mime: string) => mime.startsWith("image/");
