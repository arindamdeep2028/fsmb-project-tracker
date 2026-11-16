"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ALLOWED_TYPES, BUCKET, MAX_BYTES, reportFilePath } from "@/lib/storage";
import { genericName, namePasted, pastedImages } from "@/lib/paste-images";
import { recordAttachment } from "@/lib/actions/reports";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Why a chosen file can't be attached (null = fine): the bucket's types and the 10 MB limit. Photos over 10 MB are shrunk first, so they pass here. */
export function pickProblem(file: File): string | null {
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) return `${file.name}: use a photo, PDF or Office file.`;
  if (file.size > MAX_BYTES && !file.type.startsWith("image/")) return `${file.name} is over 10 MB.`;
  return null;
}

/** The images of a paste event to take, or null to leave the paste to the browser (rules: lib/paste-images). */
export function imagesFromPaste(e: ClipboardEvent): File[] | null {
  const dt = e.clipboardData;
  if (!dt) return null;
  const files = dt.files.length ? Array.from(dt.files) : Array.from(dt.items).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
  const target = e.target instanceof Element ? e.target : null;
  return pastedImages({ files, hasText: Boolean(dt.getData("text/plain")), inTextField: Boolean(target?.closest("textarea, input, [contenteditable]:not([contenteditable=false])")) });
}

/** Pasted files under readable, unique names ("screenshot-…", then -2, -3 for the same second). */
export function namePastedAll(files: File[], taken: Set<string>): File[] {
  const at = new Date();
  return files.map((raw) => {
    let file = namePasted(raw, at, 0);
    for (let n = 1; taken.has(file.name) && genericName(raw.name); n++) file = namePasted(raw, at, n);
    taken.add(file.name);
    return file;
  });
}

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

/** No upload progress and no answer for this long: the connection is treated as lost (instead of waiting forever). */
const STALL_MS = 60_000;

/**
 * One file to the Storage bucket: the same endpoint and headers as the Supabase client's upload, sent with
 * XMLHttpRequest so the browser reports progress and a stalled connection can be stopped. Resolves only when
 * Storage confirms the object; otherwise rejects with a message the user can act on.
 */
function sendToStorage(path: string, file: File, token: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout>;
    const watch = () => { clearTimeout(stall); stall = setTimeout(() => { xhr.abort(); reject(new Error("The connection stopped responding, so the upload was cancelled. Check your signal and retry.")); }, STALL_MS); };
    xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => { watch(); if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      clearTimeout(stall);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let body: { message?: string; error?: string; statusCode?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      const code = Number(body.statusCode ?? xhr.status);
      const text = `${body.error ?? ""} ${body.message ?? ""}`.toLowerCase();
      reject(new Error(
        code === 413 || text.includes("maximum allowed size") ? "It is over the 10 MB limit."
          : code === 415 || text.includes("mime") ? "That file type isn't accepted. Use a photo, PDF or Office file."
          : code === 401 || text.includes("jwt") ? "Your sign-in has expired. Reload the page, then retry."
          : code === 403 || text.includes("row-level security") ? "This report can't take more files: it may be locked, not today's, or already full."
          : code === 409 ? "A file with this name is already stored. Retry to upload it again."
          : `Storage refused the upload (${code || "no answer"}). Retry in a moment.`,
      ));
    };
    xhr.onerror = () => { clearTimeout(stall); reject(new Error("The upload was interrupted (network problem). Retry when you have signal.")); };
    xhr.onabort = () => clearTimeout(stall);
    watch();
    xhr.send(file);
  });
}

/** `taskId`/`taskLabel`: the task row of the report the file is attached to (none = the whole report). */
type Item = { id: string; file: File; state: "waiting" | "uploading" | "saving" | "done" | "failed"; pct: number; message?: string; preview?: string; taskId?: string | null; taskLabel?: string };
/** A task row a file can be attached to. */
export type TaskTarget = { id: string; label: string };
/** A pasted screenshot shown with its preview, not uploaded until the user says so. */
type Staged = { id: string; file: File; url: string; taskId?: string | null; taskLabel?: string };
/**
 * Each report's waiting screenshots, kept for as long as the tab is open: saving the Daily update moves to the
 * report's own page inside the app (no reload), and the screenshots are waiting in the tray there too.
 */
const trays = new Map<string, Staged[]>();

/**
 * Files chosen while a new Daily update was being written, handed to its report once the report exists. The
 * report's page picks them up and uploads them at once (same queue: progress, reasons, Retry), so nothing is
 * stored before the report is saved, and a failed file is retried against that same report.
 */
const carried = new Map<string, Staged[]>();
export function carryToReport(reportId: string, files: { id: string; file: File; url: string | null; taskId?: string | null; taskLabel?: string }[]) {
  if (files.length) carried.set(reportId, [...(carried.get(reportId) ?? []), ...files.map((f) => ({ id: f.id, file: f.file, url: f.url ?? "", taskId: f.taskId ?? null, taskLabel: f.taskLabel }))]);
}

/**
 * Browser → Storage directly under the Storage policy (v2 §14.8), path {project}/{report}/{uuid}-{name};
 * then the Server Action records the row. If recording fails the object is removed again. Each file shows its
 * own progress; it counts as added only after Storage has stored it and the row is recorded. A failed file
 * keeps its place in the list with the reason and a Retry button.
 * Screenshots pasted with Ctrl+V anywhere on the page wait in a tray with a preview, where each can be removed;
 * "Upload" sends them through the same queue as picked files (same checks, progress, errors and Retry).
 */
export function FileUploader({ projectId, reportId, existingCount, maxFiles, tasks = [] }: {
  projectId: string; reportId: string; existingCount: number; maxFiles: number;
  /** the report's task rows: files can be attached to one of them instead of the whole report */
  tasks?: TaskTarget[];
}) {
  const [target, setTarget] = useState("");                 // "" = the whole report, else a task id
  const targetOf = () => { const t = tasks.find((x) => x.id === target); return t ? { taskId: t.id, taskLabel: t.label } : { taskId: null }; };
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);             // one batch at a time: repeated clicks never start a second upload
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const left = maxFiles - existingCount;
  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** Uploads and records one file; resolves true once it is attached. Never throws. */
  async function send(item: Item): Promise<boolean> {
    const fail = (message: string) => { patch(item.id, { state: "failed", message }); return false; };
    patch(item.id, { state: "uploading", pct: 0, message: undefined });
    const file = await shrinkImage(item.file);
    if (file.size > MAX_BYTES) return fail("It is over the 10 MB limit.");
    const supabase = getBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();     // refreshes an expired sign-in first
    if (!session) return fail("Your sign-in has expired. Reload the page, then retry.");
    const path = reportFilePath(projectId, reportId, file.name);
    try {
      await sendToStorage(path, file, session.access_token, (pct) => patch(item.id, { pct }));
    } catch (e) { return fail(e instanceof Error ? e.message : "The upload failed. Retry."); }
    patch(item.id, { state: "saving", pct: 100 });
    try {
      const r = await recordAttachment({ report_id: reportId, storage_path: path, file_name: item.file.name, mime_type: file.type, size_bytes: file.size, task_id: item.taskId ?? null });
      if (!r.ok) { await supabase.storage.from(BUCKET).remove([path]); return fail(r.message ?? "The file was uploaded but couldn't be attached. Retry."); }
    } catch {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      return fail("The file was uploaded but the app couldn't attach it (connection lost). Retry.");
    }
    patch(item.id, { state: "done", message: undefined });
    return true;
  }

  async function run(batch: Item[]) {
    if (running.current || !batch.length) return;
    running.current = true; setBusy(true);
    let added = 0;
    try {
      for (const item of batch) if (await send(item)) added++;
    } finally {
      running.current = false; setBusy(false);
      if (input.current) input.current.value = "";
    }
    if (added) toast({ ok: true, message: added === 1 ? "File added" : `${added} files added` });
    if (added < batch.length) toast({ ok: false, message: `${batch.length - added} file(s) not added. See the reason next to each and retry.` });
  }

  // ---- files chosen with a new Daily update (see `carried`): uploaded as soon as its report page opens
  const [handed, setHanded] = useState<string[]>([]);       // ids of those files, for the notice above the list
  useEffect(() => {
    const c = carried.get(reportId);
    if (!c) return;
    carried.delete(reportId);
    const batch: Item[] = c.map((s) => ({ id: s.id, file: s.file, preview: s.url || undefined, state: "waiting", pct: 0, taskId: s.taskId ?? null, taskLabel: s.taskLabel }));
    setHanded(batch.map((x) => x.id));
    setItems((xs) => [...xs, ...batch]);
    void run(batch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per report page
  }, [reportId]);
  const handedItems = items.filter((x) => handed.includes(x.id));
  const handedFailed = handedItems.filter((x) => x.state === "failed").length;
  const handedOpen = handedItems.filter((x) => x.state !== "done" && x.state !== "failed").length;

  // leaving while files are on their way would cut them off
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function pick(files: FileList | null) {
    if (running.current || !files?.length) return;
    const all = Array.from(files);
    const fits = all.slice(0, Math.max(0, left));
    if (all.length > fits.length) toast({ ok: false, message: `Up to ${maxFiles} files per report.` });
    const fresh: Item[] = [];
    for (const file of fits) {
      const problem = pickProblem(file);
      if (problem) toast({ ok: false, message: problem });
      else fresh.push({ id: crypto.randomUUID(), file, state: "waiting", pct: 0, ...targetOf() });
    }
    items.filter((x) => x.state === "done").forEach((x) => release(x.preview));
    setItems((xs) => [...xs.filter((x) => x.state !== "done"), ...fresh]);
    void run(fresh);
  }

  // ---- Ctrl+V screenshots: previewed in a tray, removable, uploaded only on "Upload"
  const [staged, setStaged] = useState<Staged[]>(() => trays.get(reportId) ?? []);
  useEffect(() => { if (staged.length) trays.set(reportId, staged); else trays.delete(reportId); }, [reportId, staged]);
  // a preview URL is released when its screenshot is removed, or its upload row is dismissed or replaced; a
  // waiting one is kept across pages of the app (see `trays`) and goes with the tab
  const release = (url?: string) => { if (url) URL.revokeObjectURL(url); };
  const inFlight = items.filter((x) => x.state === "waiting" || x.state === "uploading" || x.state === "saving").length;

  function stage(files: File[]) {
    if (left <= 0) { toast({ ok: false, message: `This report already has its ${maxFiles} files.` }); return; }
    const room = Math.max(0, left - inFlight - staged.length);
    const fresh: Staged[] = [];
    let over = 0;
    namePastedAll(files, new Set([...staged, ...items].map((x) => x.file.name))).forEach((file) => {
      if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) { toast({ ok: false, message: `${file.name}: this image type isn't accepted. Paste a PNG, JPEG or WebP screenshot.` }); return; }
      if (fresh.length >= room) { over++; return; }
      const url = URL.createObjectURL(file);
      fresh.push({ id: crypto.randomUUID(), file, url });
    });
    if (over) toast({ ok: false, message: `Up to ${maxFiles} files per report: ${over} screenshot(s) not added.` });
    if (fresh.length) setStaged((xs) => [...xs, ...fresh]);
  }

  // listens on the whole page, so a screenshot can be pasted wherever the user is (also in the update's text
  // fields); a normal text paste is left alone
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (e.defaultPrevented) return;              // already taken by a task row's own screenshot field
      const images = imagesFromPaste(e);
      if (!images) return;
      e.preventDefault();
      stage(images);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // pasted screenshots live only in this page until uploaded: warn before a reload or close drops them
  useEffect(() => {
    if (!staged.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [staged.length]);

  const unstage = (id: string) => { release(staged.find((s) => s.id === id)?.url); setStaged((xs) => xs.filter((s) => s.id !== id)); };
  const clearStaged = () => { staged.forEach((s) => release(s.url)); setStaged([]); };
  function uploadStaged() {
    if (running.current || !staged.length) return;
    const batch: Item[] = staged.map((s) => ({ id: s.id, file: s.file, preview: s.url, state: "waiting", pct: 0, ...targetOf() }));
    trays.delete(reportId);
    setStaged([]);
    items.filter((x) => x.state === "done").forEach((x) => release(x.preview));
    setItems((xs) => [...xs.filter((x) => x.state !== "done"), ...batch]);
    void run(batch);
  }

  const retry = (item: Item) => { if (!running.current && left > 0) void run([item]); };
  const dismiss = (id: string) => { release(items.find((x) => x.id === id)?.preview); setItems((xs) => xs.filter((x) => x.id !== id)); };
  const label: Record<Item["state"], (x: Item) => string> = {
    waiting: () => "Waiting…", uploading: (x) => `Uploading ${x.pct}%`, saving: () => "Saving…", done: () => "Added", failed: (x) => x.message ?? "Failed",
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} className="sr-only" id="report-files" onChange={(e) => pick(e.target.files)} disabled={left <= 0 || busy} />
        <Button type="button" variant="secondary" size="sm" disabled={left <= 0 || busy} pending={busy} onClick={() => input.current?.click()}>Add photos or files</Button>
        <span className="text-sm text-ink-soft">{busy ? "Uploading, keep this page open…" : `${left} of ${maxFiles} left · photos, PDF, Word, Excel, PowerPoint · 10 MB each`}</span>
        {left > 0 ? <span data-testid="paste-hint" className="w-full text-xs text-ink-soft">Or paste screenshots with Ctrl+V: you'll see them here first and can remove any before uploading.</span> : null}
        {tasks.length && left > 0 ? (
          <label className="flex w-full flex-wrap items-center gap-2 text-sm">Attach to
            <select aria-label="Attach to" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}
              className="h-8 max-w-full rounded-md border border-line bg-panel px-2 text-sm">
              <option value="">The whole report</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>Task row: {t.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {staged.length ? (
        <div data-testid="paste-tray" className="rounded-md border border-dashed border-steel/60 bg-steel-wash/40 p-3">
          <p className="mb-2 text-sm font-medium">{staged.length === 1 ? "1 pasted screenshot" : `${staged.length} pasted screenshots`}, not uploaded yet. Remove any you don't want, then upload.</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Pasted screenshots">
            {staged.map((s) => (
              <li key={s.id} data-testid="pasted-item" className="relative overflow-hidden rounded-md border border-line bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing to optimise */}
                <img src={s.url} alt={`Preview of ${s.file.name}`} className="aspect-[4/3] w-full bg-panel object-contain" />
                <div className="truncate px-2 py-1.5 text-xs">{s.file.name} · {fmtSize(s.file.size)}</div>
                <button type="button" aria-label={`Remove ${s.file.name}`} onClick={() => unstage(s.id)}
                  className="absolute right-1.5 top-1.5 rounded bg-panel/90 p-1 text-signal-red hover:bg-panel"><X size={16} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={uploadStaged} disabled={busy}>{staged.length === 1 ? "Upload screenshot" : `Upload ${staged.length} screenshots`}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={clearStaged} disabled={busy}>Remove all</Button>
            {busy ? <span className="text-xs text-ink-soft">Waiting for the current upload to finish…</span> : null}
          </div>
        </div>
      ) : null}
      {handed.length ? (
        <p data-testid="carry-notice" role="status" className={cn("rounded-md border px-3 py-2 text-sm",
          handedFailed && !handedOpen ? "border-signal-red/50 bg-signal-red/5" : "border-line bg-steel-wash/40")}>
          {handedOpen
            ? `Your daily update is saved. Attaching the ${handed.length === 1 ? "file" : `${handed.length} files`} you added to it… keep this page open.`
            : handedFailed
              ? `Your daily update is saved, but ${handedFailed} of ${handed.length} file(s) couldn't be attached yet. The reason is next to each file: press Retry to attach it to this report. You don't need to submit the update again.`
              : `Your daily update is saved with the ${handed.length === 1 ? "file" : `${handed.length} files`} you added.`}
        </p>
      ) : null}
      {items.length ? (
        <ul className="space-y-1.5" aria-label="Uploads" aria-live="polite">
          {items.map((x) => (
            <li key={x.id} data-testid="upload-item" data-state={x.state} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview of a pasted screenshot */}
                {x.preview ? <img src={x.preview} alt="" className="h-9 w-12 shrink-0 rounded border border-line bg-panel object-contain" /> : null}
                <span className="min-w-0 flex-1 truncate font-medium">{x.file.name}{x.taskLabel ? <span data-testid="upload-task" className="ml-2 text-xs font-normal text-steel">→ task row: {x.taskLabel}</span> : null}</span>
                <span className={cn("text-xs", x.state === "failed" ? "text-signal-red" : x.state === "done" ? "text-signal-green" : "text-ink-soft")}>{label[x.state](x)}</span>
                {x.state === "failed" ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" disabled={busy || left <= 0} onClick={() => retry(x)}>Retry</Button>
                    <button type="button" className="text-xs text-ink-soft hover:underline" onClick={() => dismiss(x.id)}>Dismiss</button>
                  </>
                ) : null}
              </div>
              {x.state === "uploading" || x.state === "saving" ? (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.pct} aria-label={`${x.file.name} upload`}>
                  <div className="h-full bg-steel transition-[width]" style={{ width: `${x.pct}%` }} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
