"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CircleAlert, Clock, Copy, FileText, ListChecks, Paperclip, Plus, Save, Send, Trash2, X } from "lucide-react";
import { saveReport } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { stepChoices, taskSteps, type StepOption } from "@/lib/report-items";
import {
  OTHER, blankEntry, buildSubmission, entriesFromSaved, entriesTotalHours, newKey, optionLabel, validateEntries,
  type EntryDraft, type EntryErrors, type SavedReport,
} from "@/lib/report-entries";
import { formatHours } from "@/lib/hours";
import { sheetDate } from "@/lib/sheet";
import { cn, pct } from "@/lib/utils";
import { reach, releasePending, withAdded, type PendingFile } from "./pending-files";
import { carryToReport, fmtSize, imagesFromPaste } from "./file-uploader";
import { ALLOWED_TYPES } from "@/lib/storage";

/** Dot colour beside each status, as in the design. */
const STATUS_DOT: Record<string, string> = {
  "Not started": "#a3adb8", "Plan submitted": "#3b6ea8", "In progress": "#2e9d5b", Blocked: "#c4302b", Completed: "#1d6b40",
};

type Props = {
  projectId: string; projects: { id: string; code: string; name: string }[];
  /** the report's date, and the dates that may be chosen (an Admin: Day 1 to today; others: today only) */
  date: string; today: string; dateChoice: { min: string; max: string; fixed: boolean };
  /** whose report: the viewer, or (Admin) another current member */
  userId: string; viewerId: string; isAdmin: boolean; people: { id: string; name: string }[];
  tasks: StepOption[]; saved: SavedReport | null;
  /** files the report already has, by task row (null: the whole report) */
  savedFiles: { taskId: string | null; size: number }[];
  maxFiles: number;
};

/**
 * Submit Daily Report: several task/subtask entries in one report for the chosen person, project and date
 * (migration 35). Each entry has its own task, subtask, hours, status, completion, work done, issues, next task
 * and files; all are saved together as one report. Status and completion are applied to each entry's own task,
 * so one entry never changes another task's progress. Files are uploaded once the report is saved, each to its
 * entry's task row. "Save as draft" keeps the entries (not the files) on this device only.
 */
export function DailyEntriesForm(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => entriesFromSaved(p.saved, p.tasks), [p.saved, p.tasks]);
  const [entries, setEntries] = useState<EntryDraft[]>(initial);
  const [files, setFiles] = useState<Record<string, PendingFile[]>>({});
  const [errors, setErrors] = useState<Record<string, EntryErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftFound, setDraftFound] = useState<{ savedAt: string; entries: EntryDraft[] } | null>(null);
  const baseline = useRef(JSON.stringify(initial.map(({ key: _k, ...rest }) => rest)));
  const groups = useMemo(() => taskSteps(p.tasks), [p.tasks]);
  const savedTaskIds = useMemo(() => (p.saved?.items ?? []).map((i) => i.task_id), [p.saved]);
  const draftKey = `fsmb:daily-entries:${p.viewerId}:${p.userId}:${p.projectId}:${p.date}`;
  const allFiles = Object.values(files).flat();
  const room = Math.max(0, p.maxFiles - p.savedFiles.length - allFiles.length);
  const total = entriesTotalHours(entries);
  const dirty = JSON.stringify(entries.map(({ key: _k, ...rest }) => rest)) !== baseline.current || allFiles.length > 0;
  const self = p.userId === p.viewerId;

  // a draft kept on this device for this person, project and date is offered back (never applied silently)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) { const d = JSON.parse(raw); if (Array.isArray(d?.entries) && d.entries.length) setDraftFound(d); }
    } catch { /* storage unavailable: no drafts */ }
  }, [draftKey]);

  // unsaved entries or chosen files: warn before a reload or close drops them
  useEffect(() => {
    if (!dirty || saving) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const update = (key: string, patch: Partial<EntryDraft>) => {
    setEntries((xs) => xs.map((e) => (e.key === key ? { ...e, ...patch } : e)));
    setErrors((er) => (er[key] ? { ...er, [key]: {} } : er));
  };

  function pickTop(e: EntryDraft, topId: string) {
    if (topId === OTHER) { update(e.key, { topId, taskId: OTHER, status: "", progress: "" }); return; }
    const choices = stepChoices(groups.find((g) => g.id === topId));
    // one choice only (a task without subtasks of mine): it is the entry's task straight away
    const only = choices.length === 1 ? choices[0].option : null;
    update(e.key, { topId, taskId: only?.id ?? "", status: only?.status ?? "", progress: only ? String(only.progress_pct ?? 0) : "" });
  }
  function pickTask(e: EntryDraft, taskId: string) {
    const o = p.tasks.find((x) => x.id === taskId);
    update(e.key, { taskId, status: o?.status ?? "", progress: o ? String(o.done ? 100 : o.progress_pct ?? 0) : "" });
  }

  const add = () => setEntries((xs) => [...xs, blankEntry()]);
  /** a copy of the entry's texts, hours and status under the same task; the subtask is chosen again (one entry per subtask) */
  const duplicate = (e: EntryDraft) => setEntries((xs) => {
    const at = xs.findIndex((x) => x.key === e.key);
    const choices = e.topId && e.topId !== OTHER ? stepChoices(groups.find((g) => g.id === e.topId)) : [];
    const copy: EntryDraft = {
      ...e, key: newKey(), locked: undefined, lockedLabel: undefined,
      topId: e.locked || e.topId === OTHER ? "" : e.topId, taskId: choices.length === 1 && !e.locked ? choices[0].option.id : "",
      status: "", progress: "",
    };
    return [...xs.slice(0, at + 1), copy, ...xs.slice(at + 1)];
  });
  const remove = (e: EntryDraft) => {
    const filled = e.work.trim() || e.issues.trim() || e.next.trim() || (files[e.key]?.length ?? 0) > 0;
    if (filled && !window.confirm(`Remove entry ${entries.indexOf(e) + 1}?${savedTaskIds.includes(e.taskId) ? " It is removed from the saved report when you save." : ""}`)) return;
    releasePending(files[e.key] ?? []);
    setFiles(({ [e.key]: _gone, ...rest }) => rest);
    setEntries((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== e.key) : [blankEntry()]));
  };

  function addFiles(e: EntryDraft, chosen: File[], pasted: boolean) {
    const mine = files[e.key] ?? [];
    const next = withAdded(mine, chosen, {
      room: Math.max(0, p.maxFiles - p.savedFiles.length - allFiles.length), maxFiles: p.maxFiles, pasted,
      others: allFiles.filter((f) => !mine.includes(f)), say: (message) => toast({ ok: false, message }),
    });
    if (next !== mine) setFiles((fs) => ({ ...fs, [e.key]: next }));
  }
  const dropFile = (e: EntryDraft, id: string) => {
    const mine = files[e.key] ?? [];
    releasePending(mine.filter((f) => f.id === id));
    setFiles((fs) => ({ ...fs, [e.key]: mine.filter((f) => f.id !== id) }));
  };

  function go(params: Record<string, string>) {
    if (dirty && !window.confirm("Leave this report? Changes that are not saved (and chosen files) will be lost. Use Save as draft to keep the entries.")) return;
    const q = new URLSearchParams({ project: p.projectId, ...(p.date !== p.today ? { date: p.date } : {}), ...(self ? {} : { user: p.userId }), ...params });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    router.push(`/daily-reports/new?${q}`);
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), entries }));
      baseline.current = JSON.stringify(entries.map(({ key: _k, ...rest }) => rest));
      toast({ ok: true, message: allFiles.length ? "Draft saved on this device. Chosen files are not kept in a draft; add them again before saving." : "Draft saved on this device" });
    } catch {
      toast({ ok: false, message: "The draft couldn't be saved in this browser." });
    }
  }
  const dropDraft = () => { try { window.localStorage.removeItem(draftKey); } catch { /* nothing kept */ } setDraftFound(null); };
  function restoreDraft() {
    if (!draftFound) return;
    // a restored entry keeps its texts; a task that is no longer offered is cleared so it is chosen again
    setEntries(draftFound.entries.map((e) => ({
      ...e, key: newKey(),
      ...(e.locked || e.taskId === OTHER || p.tasks.some((t) => t.id === e.taskId) ? {} : { topId: groups.some((g) => g.id === e.topId) ? e.topId : "", taskId: "" }),
    })));
    setDraftFound(null);
  }

  async function submit() {
    const v = validateEntries(entries, p.tasks);
    setErrors(v.errors); setFormError(v.form);
    if (!v.ok) {
      const first = entries.find((e) => v.errors[e.key]);
      if (first) document.getElementById(`entry-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast({ ok: false, message: v.form ?? "Some entries need attention (marked in red)." });
      return;
    }
    const sub = buildSubmission(entries, p.tasks, savedTaskIds);
    setSaving(true);
    const r = await reach(() => saveReport({
      project_id: p.projectId,
      ...(self ? {} : { user_id: p.userId }),
      ...(p.date !== p.today ? { report_date: p.date } : {}),
      update_text: sub.update_text, issues: sub.issues, next_task_id: null, next_task_text: sub.next_task_text,
      work_hours: sub.work_hours, items: sub.items, remove_task_ids: sub.remove_task_ids,
    }));
    if (!r.ok || !r.data) { setSaving(false); setFormError(r.message ?? "The report couldn't be saved."); return; }
    toast({ ok: true, message: p.saved ? "Daily report saved" : "Daily report submitted" });
    // each entry's files go to its own task row (an "Other work" entry: the whole report); the report page uploads them
    for (const e of entries) {
      const fs = files[e.key] ?? [];
      const task = e.taskId && e.taskId !== OTHER ? e.taskId : null;
      const o = p.tasks.find((x) => x.id === task);
      carryToReport(r.data.id, fs.map((f) => ({ ...f, taskId: task, taskLabel: task ? e.lockedLabel ?? (o ? optionLabel(o) : undefined) : undefined })));
    }
    try { window.localStorage.removeItem(draftKey); } catch { /* nothing kept */ }
    setFiles({});
    router.push(`/daily-reports/${r.data.id}`);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard the changes to this report? Chosen files are dropped too.")) return;
    releasePending(allFiles);
    setFiles({});
    router.push("/daily-reports");
  }

  const field = "h-9 w-full rounded-md border border-line bg-panel px-2.5 text-sm text-ink disabled:bg-paper disabled:text-ink-soft";
  const area = "min-h-[58px] w-full resize-y rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-ink disabled:bg-paper disabled:text-ink-soft";
  const label = "mb-1 block text-xs font-semibold text-ink";
  const star = <span className="text-signal-red" aria-hidden> *</span>;
  const bad = (msg?: string) => (msg ? "border-signal-red ring-1 ring-signal-red/30" : "");
  const Err = ({ msg }: { msg?: string }) => (msg ? <p role="alert" className="mt-0.5 text-[11px] leading-tight text-signal-red">{msg}</p> : null);
  const otherUsed = (e: EntryDraft) => entries.some((x) => x.key !== e.key && x.taskId === OTHER);
  const usedBy = (e: EntryDraft, taskId: string) => { const i = entries.findIndex((x) => x.key !== e.key && x.taskId === taskId); return i >= 0 ? i + 1 : null; };

  return (
    <div className="space-y-5">
      {/* project, date and (Admin) person */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,13rem)_minmax(0,12rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,13rem)_minmax(0,12rem)_auto_minmax(0,1fr)] lg:items-end">
        <label className="block">
          <span className={label}>Project{star}</span>
          <select aria-label="Project" data-testid="entries-project" className={field} value={p.projectId} onChange={(e) => go({ project: e.target.value, user: "" })} disabled={saving}>
            {p.projects.map((x) => <option key={x.id} value={x.id}>{x.code}{x.name ? ` · ${x.name}` : ""}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Report Date{star}</span>
          <span className="relative block">
            <CalendarCheck size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input type="date" aria-label="Report Date" data-testid="entries-date" className={cn(field, "pl-8")} value={p.date} min={p.dateChoice.min} max={p.dateChoice.max}
              disabled={p.dateChoice.fixed || saving} title={p.dateChoice.fixed ? "Daily reports are written for today" : undefined}
              onChange={(e) => e.target.value && e.target.value !== p.date && go({ date: e.target.value === p.today ? "" : e.target.value })} />
          </span>
        </label>
        {p.isAdmin ? (
          <label className="block">
            <span className={label}>Employee{star}</span>
            <select aria-label="Employee" data-testid="entries-user" className={cn(field, "min-w-44")} value={p.userId} disabled={saving}
              onChange={(e) => go({ user: e.target.value === p.viewerId ? "" : e.target.value })}>
              {p.people.some((x) => x.id === p.userId) ? null : <option value={p.userId}>Me</option>}
              {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === p.viewerId ? " (me)" : ""}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <section aria-labelledby="entries-title" className="rounded-xl border border-line bg-panel p-3 shadow-sm sm:p-4">
        <h2 id="entries-title" className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          <ListChecks size={18} className="text-signal-green" aria-hidden />Daily Work Entries
          <span className="text-sm font-normal text-ink-soft" data-testid="entries-count">({entries.length} {entries.length === 1 ? "entry" : "entries"})</span>
        </h2>

        {draftFound ? (
          <div data-testid="draft-banner" className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-signal-amber/40 bg-[#fdf6e7] px-3 py-2 text-sm">
            <span>A draft of this report is saved on this device ({new Date(draftFound.savedAt).toLocaleString()}).</span>
            <Button type="button" size="sm" variant="secondary" onClick={restoreDraft}>Restore draft</Button>
            <button type="button" className="text-sm text-ink-soft hover:underline" onClick={dropDraft}>Discard</button>
          </div>
        ) : null}

        <ol className="space-y-3">
          {entries.map((e, n) => {
            const err = errors[e.key] ?? {};
            const group = groups.find((g) => g.id === e.topId);
            const choices = stepChoices(group);
            const o = p.tasks.find((x) => x.id === e.taskId);
            const isOther = e.taskId === OTHER;
            const off = Boolean(e.locked) || saving;
            const mine = files[e.key] ?? [];
            const kept = p.savedFiles.filter((f) => f.taskId === (isOther ? null : e.taskId) && (isOther || e.taskId)).length;
            const title = e.lockedLabel ?? (isOther ? "Other work (no task)" : o ? optionLabel(o) : group?.label ?? "");
            const status = o?.done ? "Completed" : e.status;
            const leafOpen = Boolean(o && o.is_leaf && !o.done);
            return (
              <li key={e.key} id={`entry-${e.key}`} data-testid="entry-card" onPaste={(ev) => {
                if (off) return;
                const images = imagesFromPaste(ev.nativeEvent);
                if (!images) return;
                ev.preventDefault();
                addFiles(e, images, true);
              }} className={cn("overflow-hidden rounded-lg border bg-panel", Object.keys(err).length ? "border-signal-red/50" : "border-[#cfe0cc]")}>
                <div className="flex items-center gap-2 bg-[#e6f1e3] px-3 py-1.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#2e7d4f] text-xs font-bold text-white">{n + 1}</span>
                  <h3 className="shrink-0 text-sm font-semibold">Entry {n + 1}</h3>
                  {title ? <span data-testid="entry-title" className="min-w-0 truncate text-xs text-ink-soft" title={title}>· {title}</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => duplicate(e)} disabled={saving} aria-label={`Duplicate entry ${n + 1}`} title="Duplicate entry"
                      className="rounded p-1 text-signal-green hover:bg-white/70 disabled:opacity-50"><Copy size={16} /></button>
                    <button type="button" onClick={() => remove(e)} disabled={saving} aria-label={`Delete entry ${n + 1}`} title="Delete entry"
                      className="rounded p-1 text-signal-red hover:bg-white/70 disabled:opacity-50"><Trash2 size={16} /></button>
                  </span>
                </div>

                <div className="space-y-2.5 px-3 pb-3 pt-2">
                  {e.locked ? (
                    <p className="flex items-center gap-1.5 rounded bg-paper px-2 py-1 text-xs text-ink-soft">
                      <CircleAlert size={13} aria-hidden />
                      {e.locked === "done" ? "This task is Completed: its entry stays in the report as saved." : "This task is no longer assigned to this person: its entry stays in the report as saved."}
                    </p>
                  ) : null}
                  {/* first row: Task | Subtask | Working Hours | Status | Completion */}
                  <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,0.75fr)]">
                    <label className="block">
                      <span className={label}>Task{star}</span>
                      <select aria-label={`Task of entry ${n + 1}`} data-testid="entry-task" className={cn(field, bad(err.task))} value={e.locked === "unavailable" ? "locked" : e.topId} disabled={off}
                        onChange={(ev) => pickTop(e, ev.target.value)}>
                        {e.locked === "unavailable" ? <option value="locked">{e.lockedLabel}</option> : null}
                        <option value="">{groups.length ? "Choose the task" : "No task assigned yet"}</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                        {otherUsed(e) && !isOther ? null : <option value={OTHER}>Other work (no task)</option>}
                      </select>
                      <Err msg={err.task} />
                      {group && !e.locked ? <span className="mt-0.5 block text-[11px] text-ink-soft">Task progress now {pct(group.progress)}{group.subtasks.length || (group.own && !group.own.is_leaf) ? " (weighted from subtasks)" : ""}</span> : null}
                    </label>
                    <label className="block">
                      <span className={label}>Subtask</span>
                      <select aria-label={`Subtask of entry ${n + 1}`} data-testid="entry-subtask" className={cn(field, bad(err.subtask))} value={isOther || e.locked === "unavailable" ? "" : e.taskId}
                        disabled={off || !group || isOther} onChange={(ev) => pickTask(e, ev.target.value)}>
                        <option value="">{isOther ? "—" : !group ? "Choose the task first" : "Choose the subtask"}</option>
                        {choices.map((c) => {
                          const taken = usedBy(e, c.option.id);
                          return (
                            <option key={c.option.id} value={c.option.id} disabled={taken != null}>
                              {c.whole ? (c.option.is_leaf ? "No subtask (the task itself)" : "Whole task (status only)") : c.text}{c.option.done ? " (Completed)" : ""}{taken ? ` (entry ${taken})` : ""}
                            </option>
                          );
                        })}
                      </select>
                      <Err msg={err.subtask} />
                    </label>
                    <label className="block">
                      <span className={label}>Working Hours{star}</span>
                      <span className="flex items-center gap-1.5">
                        <input type="text" inputMode="decimal" aria-label={`Working hours of entry ${n + 1}`} data-testid="entry-hours" placeholder="e.g. 1.5"
                          className={cn(field, "text-center", bad(err.hours))} value={e.hours} disabled={off} onChange={(ev) => update(e.key, { hours: ev.target.value })} />
                        <span className="text-sm text-ink-soft">hours</span>
                      </span>
                      <Err msg={err.hours} />
                    </label>
                    <label className="block">
                      <span className={label}>Status{o && !o.done ? star : null}</span>
                      <span className="relative block">
                        {status ? <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: STATUS_DOT[status] ?? "#a3adb8" }} /> : null}
                        <select aria-label={`Status of entry ${n + 1}`} data-testid="entry-status" className={cn(field, status && "pl-7", bad(err.status))} value={status}
                          disabled={off || !o || o.done} onChange={(ev) => update(e.key, { status: ev.target.value, ...(ev.target.value === "Completed" && o?.is_leaf ? { progress: "100" } : {}) })}>
                          {!o ? <option value="">{isOther ? "—" : "Choose the task"}</option> : null}
                          {o ? [o.status, ...o.choices.filter((s) => s !== o.status)].map((s) => <option key={s} value={s}>{s}</option>) : null}
                        </select>
                      </span>
                      <Err msg={err.status} />
                    </label>
                    <label className="block">
                      <span className={label}>Completion{leafOpen ? star : null}</span>
                      <span className="flex items-center gap-1.5">
                        <input type="number" min={0} max={100} step={5} aria-label={`Completion % of entry ${n + 1}`} data-testid="entry-progress"
                          className={cn(field, "w-full text-right", bad(err.progress))}
                          value={leafOpen ? (status === "Completed" ? "100" : e.progress) : o?.done ? "100" : o && !o.is_leaf ? String(group?.progress ?? "") : ""}
                          disabled={off || !leafOpen || status === "Completed"} title={o && !o.is_leaf ? "Calculated from its subtasks" : undefined}
                          onChange={(ev) => update(e.key, { progress: ev.target.value })} />
                        <span className="text-sm text-ink-soft">%</span>
                      </span>
                      <Err msg={err.progress} />
                      {o && !o.is_leaf && !o.done ? <span className="mt-0.5 block text-[11px] text-ink-soft">From subtasks</span> : null}
                    </label>
                  </div>

                  {/* second row: Work done today | Issues | Next Task | Attachment */}
                  <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.45fr)_minmax(0,1.45fr)_minmax(0,0.95fr)]">
                    <label className="block">
                      <span className={label}>Work done today{star}</span>
                      <textarea aria-label={`Work done today, entry ${n + 1}`} data-testid="entry-work" rows={2} className={cn(area, bad(err.work))} value={e.work} disabled={off}
                        onChange={(ev) => update(e.key, { work: ev.target.value })} />
                      <Err msg={err.work} />
                    </label>
                    <label className="block">
                      <span className={label}>Issues</span>
                      <textarea aria-label={`Issues, entry ${n + 1}`} data-testid="entry-issues" rows={2} className={cn(area, bad(err.issues))} value={e.issues} disabled={off}
                        onChange={(ev) => update(e.key, { issues: ev.target.value })} />
                      <Err msg={err.issues} />
                    </label>
                    <label className="block">
                      <span className={label}>Next Task</span>
                      <textarea aria-label={`Next task, entry ${n + 1}`} data-testid="entry-next" rows={2} className={cn(area, bad(err.next))} value={e.next} disabled={off}
                        onChange={(ev) => update(e.key, { next: ev.target.value })} />
                      <Err msg={err.next} />
                    </label>
                    <EntryFiles n={n + 1} files={mine} kept={kept} disabled={saving || room <= 0} canRemove={!saving}
                      onAdd={(chosen) => addFiles(e, chosen, false)} onRemove={(id) => dropFile(e, id)} room={room} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={add} disabled={saving} data-testid="entry-add"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-signal-green/60 bg-panel px-4 text-sm font-semibold text-signal-green hover:bg-[#eef6ec] disabled:opacity-50">
            <Plus size={17} />Add another task / subtask
          </button>
          <p data-testid="entries-total" className="inline-flex items-center gap-2 rounded-lg border border-[#cfe3cd] bg-[#e6f1e3] px-4 py-2 text-sm font-medium">
            <Clock size={17} className="text-signal-green" aria-hidden />Total Working Hours:
            <strong className="text-lg">{total == null ? "0 hours" : `${total} ${total === 1 ? "hour" : "hours"}`}</strong>
          </p>
        </div>
      </section>

      {formError ? <p role="alert" data-testid="entries-error" className="rounded-md border border-signal-red/40 bg-[#fbeceb] px-3 py-2 text-sm text-signal-red">{formError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} pending={saving} data-testid="entries-submit" className="h-11 px-5">
          <Send size={16} />{self && p.date === p.today ? "Save today's report" : "Save report"}{allFiles.length ? ` (${allFiles.length === 1 ? "1 file" : `${allFiles.length} files`})` : ""}
        </Button>
        <Button type="button" variant="secondary" onClick={saveDraft} disabled={saving} data-testid="entries-draft" className="h-11 px-5"><Save size={16} />Save as draft</Button>
        <button type="button" onClick={cancel} disabled={saving} className="h-11 px-3 text-[15px] font-medium text-ink hover:text-steel hover:underline">Cancel</button>
        <span className="text-xs text-ink-soft">
          {self ? null : `Report of ${p.people.find((x) => x.id === p.userId)?.name ?? "this member"}, `}{sheetDate(p.date)} · {formatHours(total)} · {p.maxFiles - p.savedFiles.length - allFiles.length} of {p.maxFiles} files left
        </span>
      </div>
    </div>
  );
}

/** An entry's attachments: "Add file", the count and size, and each chosen file (preview, name, remove). */
function EntryFiles({ n, files, kept, room, disabled, canRemove, onAdd, onRemove }: {
  n: number; files: PendingFile[]; kept: number; room: number; disabled: boolean; canRemove: boolean;
  onAdd: (files: File[]) => void; onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const size = files.reduce((a, f) => a + f.file.size, 0);
  return (
    <div data-testid="entry-files">
      <span className="mb-1 block text-xs font-semibold text-ink">Attachment</span>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} className="sr-only" aria-label={`Add files to entry ${n}`}
          onChange={(ev) => { onAdd(Array.from(ev.target.files ?? [])); ev.target.value = ""; }} disabled={disabled} />
        <button type="button" onClick={() => input.current?.click()} disabled={disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-sm font-medium text-ink hover:border-steel disabled:opacity-50">
          <Paperclip size={15} />Add file
        </button>
        {files.length ? <span data-testid="entry-file-count" className="text-xs font-medium text-signal-green">{files.length === 1 ? "1 file" : `${files.length} files`} ({fmtSize(size)})</span> : null}
        {kept ? <span className="text-xs text-ink-soft">{kept} saved</span> : null}
      </div>
      {files.length ? (
        <ul className="mt-1.5 space-y-1" aria-label={`Files for entry ${n}`}>
          {files.map((f) => (
            <li key={f.id} data-testid="entry-file" className="flex items-center gap-1.5 text-[11px]">
              {f.url
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing to optimise
                ? <img src={f.url} alt={`Preview of ${f.file.name}`} className="h-7 w-9 shrink-0 rounded border border-line object-cover" />
                : <FileText size={14} className="shrink-0 text-ink-faint" aria-hidden />}
              <span className="min-w-0 truncate" title={f.file.name}>{f.file.name}</span>
              <button type="button" onClick={() => onRemove(f.id)} disabled={!canRemove} aria-label={`Remove ${f.file.name}`} className="shrink-0 text-signal-red hover:opacity-70"><X size={12} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-[11px] text-ink-soft">or Ctrl+V a screenshot in this entry{room <= 0 ? " · file limit reached" : ""}</p>}
    </div>
  );
}
