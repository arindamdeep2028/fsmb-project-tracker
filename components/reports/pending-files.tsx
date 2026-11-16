"use client";
import { useEffect, useRef } from "react";
import { FileText, X } from "lucide-react";
import { ALLOWED_TYPES, isImage } from "@/lib/storage";
import type { ActionResult } from "@/lib/errors";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { fmtSize, imagesFromPaste, namePastedAll, pickProblem } from "./file-uploader";

/** A file chosen for a Daily update that isn't saved yet; `url` is its image preview (null for PDF/Office). */
export type PendingFile = { id: string; file: File; url: string | null };

/**
 * Runs a save action; a dropped connection becomes a plain error instead of an exception. The update is not
 * saved then, and since files are uploaded only after it is saved, none were stored either.
 */
export async function reach<T>(save: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try { return await save(); } catch {
    return { ok: false, message: "The update couldn't be sent (connection problem), so nothing was saved and no files were uploaded. Your text and files are still here: try again." };
  }
}

/** Releases the previews of files that are dropped (removed, cleared or the draft cancelled). */
export const releasePending = (files: PendingFile[]) => files.forEach((f) => f.url && URL.revokeObjectURL(f.url));

/**
 * `current` plus the chosen files that pass the checks (allowed types, 10 MB each — photos are shrunk first —
 * and at most `room` more files); each refused file is reported through `say`. Pasted files get readable names.
 */
export function withAdded(current: PendingFile[], chosen: File[], opts: { room: number; maxFiles: number; pasted: boolean; say: (message: string) => void; others?: PendingFile[] }): PendingFile[] {
  if (!chosen.length) return current;
  if (opts.room <= 0) { opts.say(`Up to ${opts.maxFiles} files per report.`); return current; }
  // pasted names are unique across both lists of the update (task row and whole update)
  const named = opts.pasted ? namePastedAll(chosen, new Set([...current, ...(opts.others ?? [])].map((f) => f.file.name))) : chosen;
  const fresh: PendingFile[] = [];
  let over = 0;
  for (const file of named) {
    const problem = pickProblem(file);
    if (problem) { opts.say(problem); continue; }
    if (fresh.length >= opts.room) { over++; continue; }
    fresh.push({ id: crypto.randomUUID(), file, url: isImage(file.type) && file.type !== "image/heic" ? URL.createObjectURL(file) : null });
  }
  if (over) opts.say(`Up to ${opts.maxFiles} files per report: ${over} file(s) not added.`);
  return fresh.length ? [...current, ...fresh] : current;
}

/**
 * Photos and files for a Daily update that is still being written: chosen with the picker or pasted with Ctrl+V,
 * previewed here, removable one by one or all at once. Nothing is uploaded until the update is saved; then the
 * caller hands them to the report (`carryToReport`), whose page uploads them with progress and Retry. Same
 * checks as the report's uploader: allowed types, 10 MB each (photos are shrunk first), and the files-per-report limit.
 *
 * `variant="task"`: the files of ONE task row (shown in its Task cell). It takes no page-wide paste — the row
 * itself passes pasted screenshots in with `withAdded` — and `used` counts the report's other files against the limit.
 */
export function PendingFiles({ files, onChange, maxFiles, used = 0, others = [], disabled = false, compact = false, variant = "update", task }: {
  files: PendingFile[]; onChange: (next: PendingFile[]) => void; maxFiles: number;
  /** files the report already has or will get otherwise (saved ones, the other list) */
  used?: number;
  /** the update's other pending list (pasted names stay unique across both) */
  others?: PendingFile[];
  disabled?: boolean; compact?: boolean; variant?: "update" | "task";
  /** variant task: the task's label, for the accessible names */
  task?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const isTask = variant === "task";
  const room = Math.max(0, maxFiles - used - files.length);
  const add = (chosen: File[], pasted: boolean) => {
    const next = withAdded(files, chosen, { room, maxFiles, pasted, others, say: (message) => toast({ ok: false, message }) });
    if (next !== files) onChange(next);
  };

  // Ctrl+V anywhere on the page while the update is open (text pasted into a field stays text); a paste a task
  // row has already taken is left to it
  useEffect(() => {
    if (disabled || isTask) return;
    function onPaste(e: ClipboardEvent) {
      if (e.defaultPrevented) return;
      const images = imagesFromPaste(e);
      if (!images) return;
      e.preventDefault();
      add(images, true);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // chosen files live only in this page until the update is saved: warn before a reload or close drops them
  useEffect(() => {
    if (!files.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [files.length]);

  const remove = (id: string) => { releasePending(files.filter((f) => f.id === id)); onChange(files.filter((f) => f.id !== id)); };
  const clear = () => { releasePending(files); onChange([]); };
  const p = isTask ? "task-" : "";              // test ids: task-pending-item, task-pending-tray…

  if (isTask) {
    return (
      <div data-testid="task-pending-files" className="mt-1.5 space-y-1.5 text-xs font-normal">
        <div className="flex flex-wrap items-center gap-1.5">
          <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} className="sr-only" aria-label={`Add screenshots or photos to the task row${task ? ` ${task}` : ""}`}
            onChange={(e) => { add(Array.from(e.target.files ?? []), false); e.target.value = ""; }} disabled={disabled || room <= 0} />
          <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0} onClick={() => input.current?.click()}>Add screenshot to this task</Button>
          <span className="text-ink-soft">or Ctrl+V in this row · {room} left</span>
        </div>
        {files.length ? (
          <div data-testid="task-pending-tray">
            <ul className="flex flex-wrap gap-1.5" aria-label={`Screenshots for the task row${task ? ` ${task}` : ""}`}>
              {files.map((f) => (
                <li key={f.id} data-testid="task-pending-item" className="relative w-20 overflow-hidden rounded border border-line bg-paper" title={f.file.name}>
                  {f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing to optimise
                    <img src={f.url} alt={`Preview of ${f.file.name}`} className="h-14 w-20 bg-panel object-contain" />
                  ) : <div className="grid h-14 w-20 place-items-center text-ink-faint"><FileText size={18} /></div>}
                  <div className="truncate px-1 py-0.5 text-[10px]">{f.file.name}</div>
                  <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => remove(f.id)} disabled={disabled}
                    className="absolute right-0.5 top-0.5 rounded bg-panel/90 p-0.5 text-signal-red hover:bg-panel"><X size={12} /></button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-ink-soft">{files.length === 1 ? "1 file" : `${files.length} files`} for this task, attached when the update is saved.{" "}
              <button type="button" className="text-steel hover:underline" onClick={clear} disabled={disabled}>Remove all</button></p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid={`${p}pending-files`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} className="sr-only" aria-label="Add photos or files to this update"
          onChange={(e) => { add(Array.from(e.target.files ?? []), false); e.target.value = ""; }} disabled={disabled || room <= 0} />
        <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0} onClick={() => input.current?.click()}>Add photos or files</Button>
        <span className="text-sm text-ink-soft">{room} of {maxFiles} left · photos, PDF, Word, Excel, PowerPoint · 10 MB each</span>
        <span className="w-full text-xs text-ink-soft">Or paste screenshots with Ctrl+V. They are attached when you save the update; until then you can remove any.</span>
      </div>
      {files.length ? (
        <div data-testid="pending-tray" className="rounded-md border border-dashed border-steel/60 bg-steel-wash/40 p-3">
          <p className="mb-2 text-sm font-medium">{files.length === 1 ? "1 file" : `${files.length} files`} to attach when the update is saved</p>
          <ul className={compact ? "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"} aria-label="Files to attach">
            {files.map((f) => (
              <li key={f.id} data-testid="pending-item" className="relative overflow-hidden rounded-md border border-line bg-paper">
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing to optimise
                  <img src={f.url} alt={`Preview of ${f.file.name}`} className="aspect-[4/3] w-full bg-panel object-contain" />
                ) : <div className="grid aspect-[4/3] place-items-center text-ink-faint"><FileText size={28} /></div>}
                <div className="truncate px-2 py-1.5 text-xs" title={f.file.name}>{f.file.name} · {fmtSize(f.file.size)}</div>
                <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => remove(f.id)} disabled={disabled}
                  className="absolute right-1.5 top-1.5 rounded bg-panel/90 p-1 text-signal-red hover:bg-panel"><X size={16} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2"><Button type="button" size="sm" variant="secondary" onClick={clear} disabled={disabled}>Remove all</Button></div>
        </div>
      ) : null}
    </div>
  );
}
