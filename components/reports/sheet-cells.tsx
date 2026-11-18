"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronRight, Image as ImageIcon, MessageSquare, Plus, User, X } from "lucide-react";
import { loadReportFiles, saveRemark } from "@/lib/actions/reports";
import { fmt } from "@/lib/time";
import type { DayRemark } from "@/lib/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { AttachmentGallery } from "./attachment-gallery";

type GalleryFile = { id: string; file_name: string; mime_type: string; size_bytes: number; url: string | null; task: string | null };
const chip = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold transition-colors";

/**
 * Attachment column: an image icon and the number of files the report has; a click opens that report's gallery
 * (signed with the viewer's own access, read-only here; files are added and removed on the report's page, with
 * the same permissions as before). A dash when the report has no files.
 */
export function AttachmentChip({ reportId, count, label }: { reportId: string | null; count: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<GalleryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !reportId) return;
    let live = true;
    setFiles(null); setError(null);
    loadReportFiles(reportId).then((r) => { if (live) { if (r.ok) setFiles(r.data ?? []); else setError(r.message ?? "The files couldn't be loaded."); } })
      .catch(() => live && setError("The files couldn't be loaded. Try again."));
    return () => { live = false; };
  }, [open, reportId]);
  if (!reportId || !count) return <span className="text-ink-soft">-</span>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" data-testid="attachment-chip" onClick={() => setOpen(true)} aria-label={`${count} ${count === 1 ? "file" : "files"} attached: open gallery for ${label}`}
        className={`${chip} border-[#bfe0c8] bg-[#e4f3e8] text-[#1d6b40] hover:border-[#1d6b40]`}>
        <ImageIcon size={14} aria-hidden />{count}
      </button>
      <DialogContent title="Attachments" description={label} className="max-w-3xl">
        <div data-testid="attachment-gallery">
          {error ? <p role="alert" className="text-sm text-signal-red">{error}</p>
            : files ? <AttachmentGallery files={files} canDelete={false} />
            : <p className="text-sm text-ink-soft">Loading files…</p>}
        </div>
        <p className="mt-4 text-sm"><Link href={`/daily-reports/${reportId}`} className="text-steel hover:underline">Open the report</Link> to add or remove files.</p>
      </DialogContent>
    </Dialog>
  );
}

type Person = { id: string; name: string };

/**
 * Remarks column: a comment icon and the number of remarks for the day; a click opens a small popup with each
 * remark in full — text, who gave it, to whom, when. An Admin also adds a remark there (to a member of the
 * project) and edits one; everyone else only reads the remarks addressed to them (RLS decides what is loaded).
 * A dash when there is none.
 */
export function RemarksCell({ remarks, projectId, date, people, isAdmin, defaultRecipient, openId, label }: {
  remarks: DayRemark[]; projectId: string; date: string; people: Person[]; isAdmin: boolean;
  /** the person of the row, preselected as recipient */
  defaultRecipient?: string | null;
  /** a remark to open on load (?remark= from a notification) */
  openId?: string | null;
  label: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(() => Boolean(openId && remarks.some((m) => m.id === openId)));
  const [form, setForm] = useState<{ id: string | null; recipient: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = remarks.length;
  const startNew = () => { setError(null); setForm({ id: null, recipient: defaultRecipient && people.some((p) => p.id === defaultRecipient) ? defaultRecipient : people[0]?.id ?? "", body: "" }); };

  async function send() {
    if (!form) return;
    setSaving(true); setError(null);
    const r = await saveRemark({ id: form.id, project_id: projectId, report_date: date, recipient_id: form.recipient, body: form.body }).catch(() => ({ ok: false, message: "Couldn't reach the server. Try again." }));
    setSaving(false);
    if (!r.ok) { setError(r.message ?? "Couldn't save the remark."); return; }
    toast({ ok: true, message: r.message ?? "Remark saved" });
    setForm(null);
    router.refresh();
  }

  if (!n && !isAdmin) return <span className="text-ink-soft">-</span>;
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(null); }}>
      {n ? (
        <Popover.Trigger asChild>
          <button type="button" data-testid="remarks-chip" aria-label={`${n} ${n === 1 ? "remark" : "remarks"} for ${label}`}
            className={`${chip} border-line bg-steel-wash text-ink hover:border-steel`}>
            <MessageSquare size={14} aria-hidden />{n} {n === 1 ? "remark" : "remarks"}<ChevronRight size={14} aria-hidden />
          </button>
        </Popover.Trigger>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-soft">-</span>
          <Popover.Trigger asChild>
            <button type="button" data-testid="remark-add" onClick={startNew} aria-label={`Add a remark for ${label}`} title="Add a remark"
              className="rounded-full border border-line p-0.5 text-ink-faint hover:border-steel hover:text-steel"><Plus size={13} aria-hidden /></button>
          </Popover.Trigger>
        </span>
      )}
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={12} data-testid="remarks-popup"
          className="z-50 w-80 rounded-lg border border-line bg-panel p-3 text-left text-ink shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Remarks ({n})</h3>
            <Popover.Close aria-label="Close" className="rounded p-0.5 text-ink-faint hover:text-ink"><X size={16} /></Popover.Close>
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {remarks.map((m) => (
              <li key={m.id} data-testid="remark" className={`rounded-md border border-line-soft border-l-4 bg-panel p-2.5 shadow-sm ${m.legacy ? "border-l-sage" : "border-l-signal-green"}`}>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">{m.body}</p>
                <dl className="mt-2 space-y-0.5 text-[11px] text-ink-soft">
                  <div className="flex items-center gap-1.5"><User size={12} aria-hidden /><dt className="sr-only">Given by</dt><dd>From: {m.author}{m.legacy ? " (in their daily update)" : " (Admin)"}</dd></div>
                  {m.legacy ? null : <div className="flex items-center gap-1.5"><User size={12} aria-hidden /><dt className="sr-only">Given to</dt><dd>To: {m.recipient}</dd></div>}
                  {m.createdAt ? (
                    <div className="flex items-center gap-1.5"><CalendarDays size={12} aria-hidden /><dt className="sr-only">Date and time</dt>
                      <dd>{fmt(m.createdAt, "d-MMM-yy, hh:mm a")}{m.edited ? ` · edited ${fmt(m.updatedAt, "d-MMM-yy, hh:mm a")}` : ""}</dd></div>
                  ) : null}
                </dl>
                {isAdmin && !m.legacy && !form ? (
                  <button type="button" className="mt-1.5 text-[11px] font-medium text-steel hover:underline" onClick={() => { setError(null); setForm({ id: m.id, recipient: m.recipientId, body: m.body }); }}>Edit</button>
                ) : null}
              </li>
            ))}
          </ul>
          {isAdmin ? (form ? (
            <div className="mt-3 space-y-2 border-t border-line pt-3" data-testid="remark-form">
              <label className="block text-xs font-medium">To
                <select aria-label="Remark to" className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2 text-sm" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })}>
                  {people.length ? null : <option value="">No current member</option>}
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium">Remark
                <textarea aria-label="Remark text" rows={3} maxLength={2000} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </label>
              {error ? <p role="alert" className="text-xs text-signal-red">{error}</p> : null}
              <div className="flex gap-2">
                <Button size="sm" onClick={send} pending={saving} disabled={!form.body.trim() || !form.recipient}>{form.id ? "Save remark" : "Send remark"}</Button>
                <Button size="sm" variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
              </div>
              <p className="text-[11px] text-ink-faint">The person is notified. Every version is kept.</p>
            </div>
          ) : (
            <button type="button" onClick={startNew} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-steel hover:underline"><Plus size={13} />Add remark</button>
          )) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
