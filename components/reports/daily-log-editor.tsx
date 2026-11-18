"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";
import { saveDailyRow } from "@/lib/actions/reports";
import { DAILY_HEAD, SHEET_STATUS, projectDayNumber, rowDateChoice, sheetDate, weekday, type DailyRow, type DayRemark, type ReportOrder } from "@/lib/sheet";
import { parseHours } from "@/lib/hours";
import type { TaskStatus } from "@/lib/auth/capabilities";
import { reportItemChange } from "@/lib/report-items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { DailyLogTable, type RemarkContext } from "./daily-log-table";
import { PendingFiles, reach, releasePending, withAdded, type PendingFile } from "./pending-files";
import { carryToReport, imagesFromPaste } from "./file-uploader";

/** An open task or subtask someone can name as the Main Task of their row. */
export type RowTask = { id: string; assigned_to: string; label: string; sub: string | null; status: TaskStatus; choices: TaskStatus[]; is_leaf: boolean; progress_pct: number | null; done: boolean };
type Person = { id: string; name: string };
/** `priorTaskId`: the task entry the saved row already has; `taskChanged`: the user picked another Main Task or cleared it. */
type Draft = { key: string | null; date: string; userId: string; taskId: string; priorTaskId: string | null; taskChanged: boolean; text: string; status: string; progress: string; issues: string; next: string; hours: string };

/**
 * The project's Daily Reports sheet with "Add Daily Update": the same table for every viewer, plus an editable row.
 * Everyone adds and edits their own row for today; earlier days are read-only. Only an Admin may pick another
 * member and an earlier date, which is how an overdue report is filled in (`fill` opens that row ready to write); an Admin
 * fills several people's missing reports for one date ("Add report" on that date) and may give a saved report to
 * another member (Assigned To). Remarks are the Admin's, written in the Remarks column, not in the row.
 * The server action and the database enforce the same limits (report RLS and triggers); this only decides what to offer.
 */
export function DailyLogEditor({ projectId, rows, today, start, meId, isAdmin, canAdd, people, tasks, from, query, order, fill, filters, actions, maxFiles = 10, remarks = [], remarkContext }: {
  projectId: string; rows: DailyRow[]; today: string; start: string; meId: string; isAdmin: boolean; canAdd: boolean;
  people: Person[]; tasks: RowTask[]; from: string; query: string;
  /** files per report (workspace setting): a NEW update can take photos and files before it is saved */
  maxFiles?: number;
  /** newest date first (the new row is offered above the list) or oldest first (below it) */
  order: ReportOrder;
  /** Admin: an overdue report to fill in, opened as a new row for that person and date */
  fill?: { date: string; userId: string } | null;
  /** the page's filter form and other toolbar buttons, shown in the same toolbar as "Add Daily Update" */
  filters?: React.ReactNode; actions?: React.ReactNode;
  /** the Admin's remarks for the shown days, and what the Remarks column needs to add them */
  remarks?: DayRemark[]; remarkContext?: RemarkContext;
}) {
  const router = useRouter();
  const toast = useToast();
  const saved = (date: string, userId: string) => rows.find((r) => r.reportId && r.date === date && r.userId === userId);
  const empty = (date: string, userId: string): Draft => ({ key: null, date, userId, taskId: "", priorTaskId: null, taskChanged: false, text: "", status: "", progress: "", issues: "", next: "", hours: "" });
  const [draft, setDraft] = useState<Draft | null>(() => (fill && isAdmin && !saved(fill.date, fill.userId) ? empty(fill.date, fill.userId) : null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // photos and files for the row being written; uploaded only once its report is saved (see save())
  const [pending, setPending] = useState<PendingFile[]>([]);
  // screenshots/photos for the row's task itself (linked to its Main Task when saved; migration 25)
  const [taskPending, setTaskPending] = useState<PendingFile[]>([]);
  const close = () => { releasePending([...pending, ...taskPending]); setPending([]); setTaskPending([]); setDraft(null); };
  /** files the row's saved report already has (counted against the files-per-report limit) */
  const savedFiles = (d: Draft) => (d.key ? rows.find((r) => r.key === d.key)?.fileCount : undefined) ?? saved(d.date, d.userId)?.fileCount ?? 0;
  const taskName = (t: RowTask) => (t.sub ? `${t.label} — ${t.sub}` : t.label);
  /** Ctrl+V anywhere in the row (while a Main Task is chosen) attaches the screenshot to that task row. */
  function pasteIntoRow(e: React.ClipboardEvent, d: Draft, task: RowTask | undefined) {
    if (!task || saving) return;
    const images = imagesFromPaste(e.nativeEvent);
    if (!images) return;
    e.preventDefault();                               // the page-wide paste handlers leave it alone
    // computed first, then set: a refusal message (toast) must not be raised from inside a React state update
    setTaskPending(withAdded(taskPending, images, { room: Math.max(0, maxFiles - savedFiles(d) - pending.length - taskPending.length), maxFiles, pasted: true, others: pending, say: (message) => toast({ ok: false, message }) }));
  }

  const canEdit = (r: DailyRow) => isAdmin || (Boolean(r.reportId) && r.userId === meId && r.date === today && !r.locked);
  const fromRow = (r: DailyRow): Draft => {
    const t = tasks.find((x) => x.id === r.edit?.taskId);
    return {
      key: r.key, date: r.date, userId: r.userId ?? (people.some((p) => p.id === meId) ? meId : people[0]?.id ?? meId), taskId: t ? t.id : "", priorTaskId: r.edit?.taskId ?? null, taskChanged: false, text: r.dailySubTask,
      status: r.edit?.status ?? t?.status ?? "", progress: String(r.edit?.progress ?? t?.progress_pct ?? ""),
      issues: r.issues, next: r.edit?.nextTask ?? r.nextTask, hours: String((t ? r.edit?.taskHours : null) ?? r.edit?.reportHours ?? r.edit?.taskHours ?? ""),
    };
  };
  /**
   * A new row. My own row for today opens with what I already saved (it stays editable all day); for any other
   * person or day a saved report is never replaced by a new row (see `clash`).
   */
  const blank = (date: string, userId: string): Draft => {
    const existing = userId === meId && date === today ? saved(date, userId) : undefined;
    return existing ? { ...fromRow(existing), key: null } : empty(date, userId);
  };
  /** the person a saved row belongs to (null for a new row) */
  const ownerOf = (d: Draft) => (d.key ? rows.find((r) => r.key === d.key && r.reportId)?.userId ?? null : null);
  /**
   * A new row for a person and day that already has a saved report: not saved; that row is edited instead. A saved
   * row given to someone who already has a report that day: not saved either (one report per person and day).
   */
  const clash = (d: Draft) => (!d.key && !(d.userId === meId && d.date === today) && Boolean(saved(d.date, d.userId)))
    || (Boolean(ownerOf(d)) && ownerOf(d) !== d.userId && Boolean(saved(d.date, d.userId)));
  /** The row creates a new report (no saved report for this person and day yet): files can be chosen before saving. */
  const isNew = (d: Draft) => !(d.key && rows.find((r) => r.key === d.key)?.reportId) && !saved(d.date, d.userId);
  const open = () => { setError(null); setDraft(blank(today, people.some((p) => p.id === meId) ? meId : people[0]?.id ?? meId)); };
  /** members with no saved report on a date (Admin: whose missing report can still be filled in) */
  const missingOn = (date: string) => people.filter((p) => !saved(date, p.id));
  /** Admin: a new row for another member on an existing project day */
  const addFor = (date: string) => { setError(null); setDraft(empty(date, missingOn(date)[0]?.id ?? people[0]?.id ?? meId)); };

  async function save() {
    if (!draft) return;
    const t = tasks.find((x) => x.id === draft.taskId);
    const hours = parseHours(draft.hours);
    if (!hours.ok) { setError(hours.message); return; }
    // the row keeps the task entry it has unless the Main Task was changed or cleared in this edit
    const change = reportItemChange({ priorTaskId: draft.priorTaskId, task: t, changed: draft.taskChanged, status: draft.status, progress: draft.progress });
    setSaving(true);
    const r = await reach(() => saveDailyRow({
      report_id: draft.key ? rows.find((x) => x.key === draft.key)?.reportId ?? null : null,
      project_id: projectId, user_id: draft.userId, report_date: draft.date, update_text: draft.text,
      task_id: change.items[0]?.task_id ?? null, status: change.items[0]?.status_after ?? null, progress: change.items[0]?.progress_after ?? null,
      issues: draft.issues, next_task_text: draft.next, work_hours: hours.value, remove_task_ids: change.remove_task_ids,
    }));
    setSaving(false);
    // nothing was uploaded before this point: if saving failed, the chosen files are still here, unstored
    if (!r.ok) { setError(r.message ?? "Couldn't save the row."); return; }
    toast({ ok: true, message: "Daily update saved" });
    if ((pending.length || taskPending.length) && r.data) {
      // the report exists now: its page attaches the files (progress, reasons, Retry) to exactly this report,
      // the task row's ones to the Main Task saved with it (none chosen: the whole report)
      carryToReport(r.data.id, pending);
      carryToReport(r.data.id, taskPending.map((x) => ({ ...x, taskId: t?.id ?? null, taskLabel: t ? taskName(t) : undefined })));
      setPending([]);
      setTaskPending([]);
      setDraft(null);
      router.push(`/daily-reports/${r.data.id}`);
      return;
    }
    setDraft(null);
    if (draft.date < from) router.push(`?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), from: draft.date })}`);
    else if (fill) router.replace(`?${query}`);   // the overdue report is saved: drop ?fill= so the row isn't offered again
    else router.refresh();
  }

  const editor = (d: Draft) => {
    const mine = tasks.filter((t) => t.assigned_to === d.userId && (!t.done || t.id === d.priorTaskId));
    const task = mine.find((t) => t.id === d.taskId);
    const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
    const box = "w-full rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-ink";
    const cell = "border border-line p-1 align-top bg-steel-wash/60";
    const dayNo = d.date ? projectDayNumber(start, d.date) : null;
    const choice = rowDateChoice(isAdmin, start, today);
    return [
      <tr key="editor" data-testid="daily-row-editor" onPaste={(e) => pasteIntoRow(e, d, task)}>
        <td className={`${cell} text-center whitespace-nowrap align-middle`}>{dayNo ? `Day ${dayNo}` : "—"}</td>
        <td className={cell}>
          {/* the calendar ignores clicks on days outside min–max, so it is offered only when there is a day to choose and the range is spelled out */}
          <input type="date" aria-label="Date" aria-describedby={d.key ? undefined : "daily-row-date-hint"} className={box} value={d.date}
            min={choice.min} max={choice.max} disabled={Boolean(d.key) || choice.fixed}
            onChange={(e) => e.target.value && setDraft(blank(e.target.value, d.userId))} />
          {d.date ? <span className="mt-1 block text-center text-xs text-ink-soft">{sheetDate(d.date)}</span> : null}
          {d.key ? null : (
            <span id="daily-row-date-hint" data-testid="daily-row-date-hint" className="mt-1 block text-center text-xs text-ink-soft">
              {!choice.fixed ? `Pick any day from ${sheetDate(choice.min)} (Day 1) to ${sheetDate(choice.max)} (today). Other days can't be clicked.`
                : isAdmin ? "Only today can be chosen: the project's Day 1 is today or later. Set an earlier project start date to add earlier days."
                : "You add your own row for today; earlier days are locked."}
            </span>
          )}
        </td>
        <td className={`${cell} text-center whitespace-nowrap align-middle`}>{d.date ? weekday(d.date) : ""}</td>
        <td className={cell}>
          <select aria-label="Main Task" className={box} value={d.taskId}
            onChange={(e) => { const t = mine.find((x) => x.id === e.target.value); set({ taskId: e.target.value, taskChanged: true, status: t?.status ?? "", progress: t ? String(t.progress_pct ?? 0) : "" }); }}>
            <option value="">{mine.length ? "Choose a task" : "No open task assigned"}</option>
            {mine.map((t) => <option key={t.id} value={t.id}>{t.sub ? `${t.label} — ${t.sub}` : t.label}</option>)}
          </select>
          <textarea aria-label="Daily Sub Task" rows={4} className={`${box} mt-1`} placeholder={"Work done that day\na. …\nb. …"} value={d.text} onChange={(e) => set({ text: e.target.value })} />
          {task || taskPending.length ? (
            <>
              <PendingFiles variant="task" task={task ? taskName(task) : ""} files={taskPending} onChange={setTaskPending} maxFiles={maxFiles}
                used={savedFiles(d) + pending.length} others={pending} disabled={saving} />
              {!task && taskPending.length ? <p className="mt-1 text-xs text-signal-amber">No Main Task chosen: these will be attached to the whole update.</p> : null}
            </>
          ) : null}
        </td>
        <td className={`${cell} text-center`}>
          {isAdmin ? (
            <>
              <select aria-label="Assigned To" className={box} value={d.userId}
                onChange={(e) => (ownerOf(d)
                  // a saved report given to another member: its text stays; the Main Task list becomes theirs
                  ? set({ userId: e.target.value, taskId: "", taskChanged: false, status: "", progress: "" })
                  : setDraft({ ...blank(d.date, e.target.value), key: d.key }))}>
                {people.some((p) => p.id === d.userId) ? null : <option value={d.userId}>{rows.find((r) => r.key === d.key)?.assignedTo ?? "Former member"}</option>}
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id !== ownerOf(d) && saved(d.date, p.id) ? " (has a report)" : ""}</option>)}
              </select>
              {ownerOf(d) && ownerOf(d) !== d.userId ? <span data-testid="reassign-hint" className="mt-1 block text-[11px] text-signal-amber">Reassigning from {rows.find((r) => r.key === d.key)?.assignedTo}. The change is recorded.</span> : null}
            </>
          ) : <span className="block pt-1.5">{people.find((p) => p.id === d.userId)?.name ?? rows.find((r) => r.key === d.key)?.assignedTo}</span>}
        </td>
        <td className={cell}>
          <input type="text" inputMode="decimal" aria-label="Working Hours" placeholder="e.g. 1.5" className={`${box} text-center`} value={d.hours} onChange={(e) => set({ hours: e.target.value })} />
          <span className="mt-1 block text-center text-[11px] text-ink-soft">{task ? "on this task" : "hours"}</span>
        </td>
        <td className={cell}>
          {task?.done ? <span className="block pt-1.5 text-center">Completed</span> : task ? (
            <>
              <select aria-label="Status" className={box} value={d.status || task.status} onChange={(e) => set({ status: e.target.value })}>
                {[task.status, ...task.choices.filter((s) => s !== task.status)].map((s) => <option key={s} value={s}>{SHEET_STATUS[s] ?? s}</option>)}
              </select>
              {task.is_leaf ? (
                <label className="mt-1 flex items-center gap-1 text-xs text-ink-soft">%
                  <input type="number" min={0} max={100} step={5} aria-label="Progress %" className="h-7 w-14 rounded border border-line bg-panel px-1 text-right text-sm"
                    value={d.progress} onChange={(e) => set({ progress: e.target.value })} />
                </label>
              ) : null}
            </>
          ) : (
            // a status belongs to the Main Task: the field is shown from the start and opens once a task is chosen
            <>
              <select aria-label="Status" className={box} disabled value=""><option value="">{mine.length ? "Choose task" : "No open task"}</option></select>
              <span data-testid="status-hint" className="mt-1 block text-xs text-ink-soft">{mine.length ? "Pick the Main Task first to set its status." : "No open task is assigned to this person here."}</span>
            </>
          )}
        </td>
        <td className={cell}><textarea aria-label="Issues" rows={4} className={box} value={d.issues} onChange={(e) => set({ issues: e.target.value })} /></td>
        <td className={cell}><textarea aria-label="Next Task" rows={4} className={box} value={d.next} onChange={(e) => set({ next: e.target.value })} /></td>
        <td className={`${cell} text-center align-middle text-xs text-ink-soft`}>{savedFiles(d) ? `${savedFiles(d)} saved` : "-"}</td>
        <td className={`${cell} text-center align-middle text-[11px] text-ink-soft`}>{isAdmin ? "Use the Remarks column" : "Given by the Admin"}</td>
      </tr>,
      <tr key="editor-actions">
        <td colSpan={DAILY_HEAD.length} className="border border-line bg-steel-wash/60 px-3 py-2">
          {isNew(d) || pending.length ? (
            <div className="mb-3 space-y-1">
              <p className="text-xs font-semibold">Photos and files</p>
              <PendingFiles files={pending} onChange={setPending} maxFiles={maxFiles} used={savedFiles(d) + taskPending.length} others={taskPending} disabled={saving} compact />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} pending={saving} disabled={clash(d)}>{pending.length + taskPending.length ? `Save row with ${pending.length + taskPending.length === 1 ? "1 file" : `${pending.length + taskPending.length} files`}` : "Save row"}</Button>
            <Button size="sm" variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
            {clash(d) ? <span role="alert" className="text-sm text-signal-red">This person already has a saved report for this day. It is not replaced; cancel and use Edit on that row.</span>
              : !d.key && saved(d.date, d.userId) ? <span className="text-sm text-ink-soft">You already have a row for today; saving updates it.</span>
              : !d.key && d.date < today ? <span className="text-sm text-ink-soft">Filling in the report for {sheetDate(d.date)} on this person's behalf.</span> : null}
            {error ? <span role="alert" className="text-sm text-signal-red">{error}</span> : null}
          </div>
        </td>
      </tr>,
    ];
  };

  const addButton = (variant: "primary" | "secondary") => canAdd ? (
    <Button size="sm" variant={variant} onClick={open} disabled={Boolean(draft)}><Plus size={16} className="mr-1" />Add Daily Update</Button>
  ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {filters}
        <div className="flex gap-2">{actions}{addButton("primary")}</div>
      </div>
      <DailyLogTable rows={rows} remarks={remarks} remarkContext={remarkContext}
        dayAction={(g) => (isAdmin && canAdd && !draft && g[0].date >= start && g[0].date <= today && missingOn(g[0].date).length && g.some((r) => r.reportId) ? (
          <button type="button" data-testid="add-member-report" onClick={() => addFor(g[0].date)} title="Fill in another member's report for this date"
            className={`inline-flex items-center gap-1 text-[11px] font-medium hover:underline ${g[0].offDay ? "text-white" : "text-steel"}`}><UserPlus size={12} aria-hidden />Add report</button>
        ) : null)}
        replaceRow={(r) => (draft?.key === r.key ? <Fragment key={r.key}>{editor(draft)}</Fragment> : null)}
        rowAction={(r) => (canEdit(r) && !draft ? (
          <button type="button" className={`text-xs font-medium hover:underline ${r.offDay ? "text-white/90" : "text-steel"}`} onClick={() => { setError(null); setDraft(fromRow(r)); }}>Edit</button>
        ) : null)}
        lead={draft && !draft.key && order === "desc" ? editor(draft) : null}
        footer={draft && !draft.key && order === "asc" ? editor(draft) : null} />
      {canAdd && !draft ? <button type="button" onClick={open} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line py-2 text-sm text-steel hover:border-steel hover:bg-steel-wash"><Plus size={16} />Add New Row</button> : null}
    </div>
  );
}
