"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveDailyRow } from "@/lib/actions/reports";
import { projectDayNumber, sheetDate, weekday, type DailyRow } from "@/lib/sheet";
import type { TaskStatus } from "@/lib/auth/capabilities";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { DailyLogTable } from "./daily-log-table";

/** An open task or subtask someone can name as the Main Task of their row. */
export type RowTask = { id: string; assigned_to: string; label: string; sub: string | null; status: TaskStatus; choices: TaskStatus[]; is_leaf: boolean; progress_pct: number | null };
type Person = { id: string; name: string };
type Draft = { key: string | null; date: string; userId: string; taskId: string; text: string; status: string; progress: string; issues: string; next: string; remarks: string };

/**
 * The project's Daily Follow Up with "Add Daily Update": the same table for every viewer, plus an editable row.
 * Everyone adds and edits their own row for today; an Admin may also pick another member and an earlier date.
 * The database enforces the same limits (report RLS and triggers), so this only decides what to offer.
 */
export function DailyLogEditor({ projectId, rows, today, start, meId, isAdmin, canAdd, people, tasks, from, query, filters, actions }: {
  projectId: string; rows: DailyRow[]; today: string; start: string; meId: string; isAdmin: boolean; canAdd: boolean;
  people: Person[]; tasks: RowTask[]; from: string; query: string;
  /** the page's filter form and other toolbar buttons, shown in the same toolbar as "Add Daily Update" */
  filters?: React.ReactNode; actions?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = (r: DailyRow) => Boolean(r.reportId) && (isAdmin || (r.userId === meId && r.date === today && !r.locked));
  const fromRow = (r: DailyRow): Draft => {
    const t = tasks.find((x) => x.id === r.edit?.taskId);
    return {
      key: r.key, date: r.date, userId: r.userId ?? meId, taskId: t ? t.id : "", text: r.dailySubTask,
      status: r.edit?.status ?? t?.status ?? "", progress: String(r.edit?.progress ?? t?.progress_pct ?? ""),
      issues: r.issues, next: r.edit?.nextTask ?? r.nextTask, remarks: r.remarks,
    };
  };
  /** A new row; if that person already has a row for that date, it is opened instead (one row per person per day). */
  const blank = (date: string, userId: string): Draft => {
    const existing = rows.find((r) => r.reportId && r.date === date && r.userId === userId);
    return existing ? { ...fromRow(existing), key: null }
      : { key: null, date, userId, taskId: "", text: "", status: "", progress: "", issues: "", next: "", remarks: "" };
  };
  const open = () => { setError(null); setDraft(blank(today, people.some((p) => p.id === meId) ? meId : people[0]?.id ?? meId)); };

  async function save() {
    if (!draft) return;
    const t = tasks.find((x) => x.id === draft.taskId);
    setSaving(true);
    const r = await saveDailyRow({
      project_id: projectId, user_id: draft.userId, report_date: draft.date, task_id: t?.id ?? null, update_text: draft.text,
      status: t ? ((t.choices.includes(draft.status as TaskStatus) ? draft.status : t.status) as TaskStatus) : null,
      progress: t?.is_leaf && draft.progress !== "" ? Math.max(0, Math.min(100, Number(draft.progress))) : null,
      issues: draft.issues, next_task_text: draft.next, remarks: draft.remarks,
    });
    setSaving(false);
    if (!r.ok) { setError(r.message ?? "Couldn't save the row."); return; }
    toast({ ok: true, message: "Daily update saved" });
    setDraft(null);
    if (draft.date < from) router.push(`?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), from: draft.date })}`);
    else router.refresh();
  }

  const editor = (d: Draft) => {
    const mine = tasks.filter((t) => t.assigned_to === d.userId);
    const task = mine.find((t) => t.id === d.taskId);
    const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
    const box = "w-full rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-ink";
    const cell = "border border-line p-1 align-top bg-steel-wash/60";
    const dayNo = d.date ? projectDayNumber(start, d.date) : null;
    return [
      <tr key="editor" data-testid="daily-row-editor">
        <td className={`${cell} text-center whitespace-nowrap align-middle`}>{dayNo ? `Day ${dayNo}` : "—"}</td>
        <td className={cell}>
          <input type="date" aria-label="Date" className={box} value={d.date} min={isAdmin ? start : today} max={today} disabled={Boolean(d.key)}
            title={isAdmin ? undefined : "You add your own row for today; earlier days are locked"}
            onChange={(e) => e.target.value && setDraft(blank(e.target.value, d.userId))} />
          {d.date ? <span className="mt-1 block text-center text-xs text-ink-soft">{sheetDate(d.date)}</span> : null}
        </td>
        <td className={`${cell} text-center whitespace-nowrap align-middle`}>{d.date ? weekday(d.date) : ""}</td>
        <td className={cell}>
          <select aria-label="Main Task" className={box} value={d.taskId}
            onChange={(e) => { const t = mine.find((x) => x.id === e.target.value); set({ taskId: e.target.value, status: t?.status ?? "", progress: t ? String(t.progress_pct ?? 0) : "" }); }}>
            <option value="">{mine.length ? "Choose a task" : "No open task assigned"}</option>
            {mine.map((t) => <option key={t.id} value={t.id}>{t.sub ? `${t.label} — ${t.sub}` : t.label}</option>)}
          </select>
        </td>
        <td className={cell}><textarea aria-label="Daily Sub Task" rows={4} className={box} placeholder={"a. …\nb. …"} value={d.text} onChange={(e) => set({ text: e.target.value })} /></td>
        <td className={`${cell} text-center`}>
          {isAdmin && !d.key ? (
            <select aria-label="Assigned To" className={box} value={d.userId} onChange={(e) => setDraft(blank(d.date, e.target.value))}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <span className="block pt-1.5">{people.find((p) => p.id === d.userId)?.name ?? rows.find((r) => r.key === d.key)?.assignedTo}</span>}
        </td>
        <td className={cell}>
          {task ? (
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
        <td colSpan={10} className="border border-line bg-steel-wash/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} pending={saving}>Save row</Button>
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            {!d.key && rows.some((r) => r.reportId && r.date === d.date && r.userId === d.userId)
              ? <span className="text-sm text-ink-soft">This person already has a row for this day; saving updates it.</span> : null}
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
        footer={draft && !draft.key ? editor(draft) : null} />
      {canAdd && !draft ? <button type="button" onClick={open} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line py-2 text-sm text-steel hover:border-steel hover:bg-steel-wash"><Plus size={16} />Add New Row</button> : null}
    </div>
  );
}
