"use client";
import { useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ALLOWED_TYPES, BUCKET, MAX_BYTES, reportFilePath } from "@/lib/storage";
import { recordAttachment } from "@/lib/actions/reports";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

/** Resize large photos in the browser before upload (keeps shop-floor uploads quick). HEIC is uploaded as is. */
async function shrinkImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch { return file; }
}

/**
 * Browser → Storage directly under the Storage policy (v2 §14.8), path {project}/{report}/{uuid}-{name};
 * then the Server Action records the row. If recording fails the object is removed again.
 */
export function FileUploader({ projectId, reportId, existingCount, maxFiles }: { projectId: string; reportId: string; existingCount: number; maxFiles: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const left = maxFiles - existingCount;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, left));
    if (files.length > list.length) toast({ ok: false, message: `Up to ${maxFiles} files per report.` });
    const supabase = getBrowserClient();
    for (const original of list) {
      if (!(ALLOWED_TYPES as readonly string[]).includes(original.type)) { toast({ ok: false, message: `${original.name}: use a photo, PDF or Office file.` }); continue; }
      const file = await shrinkImage(original);
      if (file.size > MAX_BYTES) { toast({ ok: false, message: `${original.name} is over 10 MB.` }); continue; }
      setBusy(`Uploading ${original.name}…`);
      const path = reportFilePath(projectId, reportId, file.name);
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) { toast({ ok: false, message: `${original.name} wasn't uploaded. The report may be locked.` }); continue; }
      const r = await recordAttachment({ report_id: reportId, storage_path: path, file_name: original.name, mime_type: file.type, size_bytes: file.size });
      if (!r.ok) { await supabase.storage.from(BUCKET).remove([path]); toast(r); }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    toast({ ok: true, message: "Files added" });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} className="sr-only" id="report-files" onChange={(e) => upload(e.target.files)} disabled={left <= 0 || Boolean(busy)} />
      <Button type="button" variant="secondary" size="sm" disabled={left <= 0 || Boolean(busy)} onClick={() => input.current?.click()}>Add photos or files</Button>
      <span className="text-sm text-ink-soft">{busy ?? `${left} of ${maxFiles} left · photos, PDF, Word, Excel, PowerPoint · 10 MB each`}</span>
    </div>
  );
}
