"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveDailyRow } from "@/lib/actions/reports";
import { DAILY_HEAD, projectDayNumber, rowDateChoice, sheetDate, weekday, type DailyRow, type ReportOrder } from "@/lib/sheet";
import type { TaskStatus } from "@/lib/auth/capabilities";
import { reportItemChange } from "@/lib/report-items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { DailyLogTable } from "./daily-log-table";

/** An open task or subtask someone can name as the Main Task of their row. */
export type RowTask = { id: string; assigned_to: string; label: string; sub: string | null; status: TaskStatus; choices: TaskStatus[]; is_leaf: boolean; progress_pct: number | null; done: boolean };
type Person = { id: string; name: string };
/** `priorTaskId`: the task entry the saved row already has; `taskChanged`: the user picked another Main Task or cleared it. */
type Draft = { key: string | null; date: string; userId: string; taskId: string; priorTaskId: string | null; taskChanged: boolean; text: string; status: string; progress: string; issues: string; next: string; remarks: string };

/**
 * The project's Daily Reports sheet with "Add Daily Update": the same table for every viewer, plus an editable row.
 * Everyone adds and edits their own row for today; earlier days are read-only. Only an Admin may pick another
 * member and an earlier date, which is how an overdue report is filled in (`fill` opens that row ready to write).
 * The server action and the database enforce the same limits (report RLS and triggers); this only decides what to offer.
 */
export function DailyLogEditor({ projectId, rows, today, start, meId, isAdmin, canAdd, people, tasks, from, query, order, fill, filters, actions }: {
  projectId: string; rows: DailyRow[]; today: string; start: string; meId: string; isAdmin: boolean; canAdd: boolean;
  people: Person[]; tasks: RowTask[]; from: string; query: string;
  /** newest date first (the new row is offered above the list) or oldest first (below it) */
  order: ReportOrder;
  /** Admin: an overdue report to fill in, opened as a new row for that person and date */
  fill?: { date: string; userId: string } | null;
  /** the page's filter form and other toolbar buttons, shown in the same toolbar as "Add Daily Update" */
  filters?: React.ReactNode; actions?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const saved = (date: string, userId: string) => rows.find((r) => r.reportId && r.date === date && r.userId === userId);
  const empty = (date: string, userId: string): Draft => ({ key: null, date, userId, taskId: "", priorTaskId: null, taskChanged: false, text: "", status: "", progress: "", issues: "", next: "", remarks: "" });
  const [draft, setDraft] = useState<Draft | null>(() => (fill && isAdmin && !saved(fill.date, fill.userId) ? empty(fill.date, fill.userId) : null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = (r: DailyRow) => Boolean(r.reportId) && (isAdmin || (r.userId === meId && r.date === today && !r.locked));
  const fromRow = (r: DailyRow): Draft => {
    const t = tasks.find((x) => x.id === r.edit?.taskId);
    return {
      key: r.key, date: r.date, userId: r.userId ?? meId, taskId: t ? t.id : "", priorTaskId: r.edit?.taskId ?? null, taskChanged: false, text: r.dailySubTask,
      status: r.edit?.status ?? t?.status ?? "", progress: String(r.edit?.progress ?? t?.progress_pct ?? ""),
      issues: r.issues, next: r.edit?.nextTask ?? r.nextTask, remarks: r.remarks,
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
  /** A new row for a person and day that already has a saved report: not saved; that row is edited instead. */
  const clash = (d: Draft) => !d.key && !(d.userId === meId && d.date === today) && Boolean(saved(d.date, d.userId));
  const open = () => { setError(null); setDraft(blank(today, people.some((p) => p.id === meId) ? meId : people[0]?.id ?? meId)); };

  async function save() {
    if (!draft) return;
    const t = tasks.find((x) => x.id === draft.taskId);
    // the row keeps the task entry it has unless the Main Task was changed or cleared in this edit
    const change = reportItemChange({ priorTaskId: draft.priorTaskId, task: t, changed: draft.taskChanged, status: draft.status, progress: draft.progress });
    setSaving(true);
    const r = await saveDailyRow({
      report_id: draft.key ? rows.find((x) => x.key === draft.key)?.reportId ?? null : null,
      project_id: projectId, user_id: draft.userId, report_date: draft.date, update_text: draft.text,
      task_id: change.items[0]?.task_id ?? null, status: change.items[0]?.status_after ?? null, progress: change.items[0]?.progress_after ?? null,
      issues: draft.issues, next_task_text: draft.next, remarks: draft.remarks, remove_task_ids: change.remove_task_ids,
    });
    setSaving(false);
    if (!r.ok) { setError(r.message ?? "Couldn't save the row."); return; }
    toast({ ok: true, message: "Daily update saved" });
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
      <tr key="editor" data-testid="daily-row-editor">
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
        </td>
        <td className={`${cell} text-center`}>
          {isAdmin && !d.key ? (
            <select aria-label="Assigned To" className={box} value={d.userId} onChange={(e) => setDraft(blank(d.date, e.target.value))}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <span className="block pt-1.5">{people.find((p) => p.id === d.userId)?.name ?? rows.find((r) => r.key === d.key)?.assignedTo}</span>}
        </td>
        <td className={cell}>
          {task?.done ? <span className="block pt-1.5 text-center">Completed</span> : task ? (
            <>
              <select aria-label="Status" className={box} value={d.status || task.status} onChange={(e) => set({ status: e.target.value })}>
                {[task.status, ...task.choices.filter((s) => s !== task.status)].map((s) => <option key={s}>{s}</option>)}
              </select>
              {task.is_leaf ? (
                <label className="mt-1 flex items-center gap-1 text-xs text-ink-soft">%
                  <input type="number" min={0} max={100} step={5} aria-label="Progress %" className="h-7 w-14 rounded border border-line bg-panel px-1 text-right text-sm"
                    value={d.progress} onChange={(e) => set({ progress: e.target.value })} />
                </label>
              ) : null}
            </>
          ) : <span className="block pt-1.5 text-center text-ink-faint">—</span>}
        </td>
        <td className={cell}><textarea aria-label="Issues" rows={4} className={box} value={d.issues} onChange={(e) => set({ issues: e.target.value })} /></td>
        <td className={cell}><textarea aria-label="Next Task" rows={4} className={box} value={d.next} onChange={(e) => set({ next: e.target.value })} /></td>
        <td className={cell}><textarea aria-label="Remarks" rows={4} className={box} value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} /></td>
      </tr>,
      <tr key="editor-actions">
        <td colSpan={DAILY_HEAD.length} className="border border-line bg-steel-wash/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} pending={saving} disabled={clash(d)}>Save row</Button>
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
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
      <DailyLogTable rows={rows}
        replaceRow={(r) => (draft?.key === r.key ? <Fragment key={r.key}>{editor(draft)}</Fragment> : null)}
        rowAction={(r) => (canEdit(r) && !draft ? (
          <button type="button" className="text-xs text-steel hover:underline" onClick={() => { setError(null); setDraft(fromRow(r)); }}>Edit</button>
        ) : null)}
        lead={draft && !draft.key && order === "desc" ? editor(draft) : null}
        footer={draft && !draft.key && order === "asc" ? editor(draft) : null} />
      {canAdd && !draft ? <button type="button" onClick={open} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line py-2 text-sm text-steel hover:border-steel hover:bg-steel-wash"><Plus size={16} />Add New Row</button> : null}
    </div>
  );
}
