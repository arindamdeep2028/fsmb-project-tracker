"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Download, ExternalLink, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  addTaskAssignee, addTasklistRowAssignee, addTasklistRows, removeTaskAssignee, removeTasklistRow, removeTasklistRowAssignee,
  saveTasklistCategory, saveTasklistComment, updateTasklistRow, updateTasklistTask,
} from "@/lib/actions/tasklist";
import { PRIORITY_TONE, STATUS_TONE } from "@/lib/sheet";
import {
  CATEGORIES, CATEGORY_TONE, TASKLIST_STATUSES, categoryLabel, personTone, tasklistStatus,
  type Category, type SheetRow, type TasklistRow, type TasklistTask,
} from "@/lib/tasklist";
import { PRIORITIES } from "@/lib/labels";
import { downloadXlsx } from "@/lib/xlsx";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import type { ActionResult } from "@/lib/errors";
import type { TasklistRowPatch, TasklistTaskPatch } from "@/lib/validation";

type Person = { id: string; name: string };
type Status = NonNullable<TasklistTaskPatch["status"]>;
/** Run a save; `show`: values to show at once, by key, until page data loaded after the save arrives. */
type Save = (fn: () => Promise<ActionResult>, show?: Record<string, unknown>) => Promise<boolean>;

const WIDTHS = [440, 240, 140, 240, 120];
const HEAD = ["Task", "Assigned Person", "Status", "Comments", "Priority"];
/** The Excel file adds a Category column after Task. */
const EXPORT_HEAD = ["Task", "Category", "Assigned Person", "Status", "Comments", "Priority"];
const EXPORT_WIDTHS = [440, 110, 240, 140, 240, 120];
const COUNTS = ["1", "5", "10", "20"];
const MAX_ADD = 50;

function Chip({ person, onRemove, owner }: { person: Person; onRemove?: () => void; owner?: boolean }) {
  const [bg, fg] = personTone(person.id);
  return (
    <span data-testid="assignee-chip" title={owner ? `${person.name} (owner)` : person.name}
      className="inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: bg, color: fg }}>
      <span className="truncate">{person.name}</span>
      {onRemove ? <button type="button" aria-label={`Remove ${person.name}`} onClick={onRemove} className="rounded opacity-75 hover:opacity-100"><X size={12} /></button> : null}
    </span>
  );
}

function Pill({ tone, children }: { tone: [string, string] | undefined; children: React.ReactNode }) {
  const [bg, fg] = tone ?? ["#e9efe9", "#26332b"];
  return <span className="inline-block min-w-[6rem] rounded-md px-2 py-0.5 text-center text-xs font-semibold" style={{ background: bg, color: fg }}>{children}</span>;
}

/**
 * A sheet cell you type into: saves when you press Enter or leave the cell, Esc puts the saved text back. While a
 * save is refused the text stays (marked red) so nothing typed is lost; the next edit or Esc clears the mark.
 */
function CellText({ value, label, placeholder, maxLength, onSave, autoFocus, required, testId }: {
  value: string; label: string; placeholder?: string; maxLength: number; onSave: (v: string) => Promise<boolean>;
  autoFocus?: boolean; required?: boolean; testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!focused && !bad) setDraft(value); }, [value, focused, bad]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  async function commit() {
    const v = draft.trim();
    if (v === value.trim()) { setDraft(value); setBad(false); return; }
    if (required && !v) { setDraft(value); setBad(false); return; }
    const ok = await onSave(v);
    setBad(!ok);
  }
  return (
    <textarea ref={ref} rows={1} aria-label={label} placeholder={placeholder} maxLength={maxLength} value={draft} data-testid={testId}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); void commit(); }}
      onChange={(e) => { setDraft(e.target.value); setBad(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { setDraft(value); setBad(false); requestAnimationFrame(() => ref.current?.blur()); }
      }}
      className={`block min-h-7 w-full resize-none rounded border bg-transparent px-1.5 py-1 text-[13px] leading-snug [field-sizing:content]
        placeholder:italic placeholder:text-ink-faint hover:border-line focus:border-steel focus:bg-panel focus:outline-none
        ${bad ? "border-[#b3261e] bg-[#fbeceb]" : "border-transparent"}`} />
  );
}

/** Status: Pending, On-Going, Halted, Done, in that order (Blocked is shown as Halted; the stored value is unchanged). */
function StatusSelect({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const [bg, fg] = STATUS_TONE[value] ?? ["#e9efe9", "#26332b"];
  const options: string[] = [...TASKLIST_STATUSES];
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full rounded-md border-0 px-1 text-center text-xs font-semibold" style={{ background: bg, color: fg }}>
      {/* a task still in another status (e.g. Plan submitted) shows it, so nothing changes until a status is chosen */}
      {[...(options.includes(value) ? [] : [value]), ...options].map((x) => <option key={x} value={x} style={{ background: "#fff", color: "#26332b" }}>{tasklistStatus(x)}</option>)}
    </select>
  );
}

/** General Task / Urgent Task (separate from Priority). */
function CategorySelect({ value, label, onChange }: { value: Category; label: string; onChange: (v: Category) => void }) {
  const [bg, fg] = CATEGORY_TONE[value] ?? CATEGORY_TONE.General;
  return (
    <select aria-label={label} title="Task category" value={value} onChange={(e) => onChange(e.target.value as Category)} data-testid="category"
      className="mt-0.5 h-6 w-[6.5rem] shrink-0 rounded border-0 px-1 text-[11px] font-semibold" style={{ background: bg, color: fg }}>
      {CATEGORIES.map((c) => <option key={c} value={c} style={{ background: "#fff", color: "#26332b" }}>{categoryLabel(c)}</option>)}
    </select>
  );
}

function CategoryPill({ value }: { value: Category }) {
  const [bg, fg] = CATEGORY_TONE[value] ?? CATEGORY_TONE.General;
  return <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{categoryLabel(value)}</span>;
}

function PrioritySelect({ value, label, onChange }: { value: string; label: string; onChange: (v: (typeof PRIORITIES)[number]) => void }) {
  const [bg, fg] = PRIORITY_TONE[value] ?? ["#e9efe9", "#26332b"];
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as (typeof PRIORITIES)[number])}
      className="h-7 w-full rounded-md border-0 px-1 text-center text-xs font-semibold" style={{ background: bg, color: fg }}>
      {PRIORITIES.map((x) => <option key={x} value={x} style={{ background: "#fff", color: "#26332b" }}>{x}</option>)}
    </select>
  );
}

/** Assigned Person chips with add/remove. `owner`: a task's owner (from Responsibilities), shown first, not removable here. */
function PeopleCell({ name, owner, extra, people, editable, onAdd, onRemove }: {
  name: string; owner?: Person; extra: Person[]; people: Person[]; editable: boolean;
  onAdd: (userId: string) => void; onRemove: (userId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const candidates = people.filter((p) => p.id !== owner?.id && !extra.some((x) => x.id === p.id));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {owner ? <Chip person={owner} owner /> : null}
      {extra.map((p) => <Chip key={p.id} person={p} onRemove={editable ? () => onRemove(p.id) : undefined} />)}
      {!owner && !extra.length && !editable ? <span className="text-[13px] text-ink-faint">-</span> : null}
      {editable && candidates.length ? (adding ? (
        <select autoFocus aria-label="Add a person" className="h-7 max-w-[9rem] rounded border border-line bg-panel px-1 text-xs" defaultValue=""
          onBlur={() => setAdding(false)}
          onChange={(e) => { const id = e.target.value; setAdding(false); if (id) onAdd(id); }}>
          <option value="">Add person…</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <button type="button" aria-label={`Add a person to ${name}`} onClick={() => setAdding(true)}
          className="rounded-full border border-line p-0.5 text-ink-faint hover:border-steel hover:text-steel"><Plus size={13} /></button>
      )) : null}
    </div>
  );
}

/** One load of the page's data; `loadedAt`: server time just before it was read. */
export type TasklistData = {
  loadedAt: string;
  rows: TasklistRow[];
  /** the headings a Tasklist row can go under */
  phases: { id: string; label: string }[];
  /** extra assigned people per task, and the people of each Tasklist row (by row id) */
  assignees: Record<string, Person[]>;
  comments: Record<string, string>;
  /** General / Urgent of each existing task (missing = General) */
  categories: Record<string, Category>;
};

/**
 * A value changed here, shown in place of the loaded one until page data loaded after the save arrives.
 * `at`: server time of the save (Infinity while it is still on its way); `seq`: which save set it.
 */
type Local = { v: unknown; at: number; seq: number };
/** How many times a load older than the latest save is thrown away and asked for again before it is used anyway. */
const STALE_RETRIES = 3;

/**
 * The project's Tasklist, laid out like the team's Google Sheet: a dark header, phase headings, then each task with
 * its Assigned Person chips, Status, Comments and Priority (no percentage column), followed by rows added here with
 * "Add rows". Every member of the project edits it (cells save on their own; the bar above shows the save state);
 * the database checks every change again.
 *
 * Saved values never flicker back: a change shows at once and stays until page data loaded after its save comes in,
 * and page data whose load started before the latest save (a refresh still on its way) is not shown; a fresh load is
 * asked for instead.
 */
export function Tasklist({ projectId, projectName, data, people, canEdit, archived, canExport }: {
  projectId: string; projectName: string; data: TasklistData; people: Person[];
  canEdit: boolean; archived: boolean; canExport: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [snap, setSnap] = useState(data);
  const [local, setLocal] = useState<Record<string, Local>>({});
  const lastSave = useRef(0);
  const staleTries = useRef(0);
  const seq = useRef(0);
  const [pending, setPending] = useState(0);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [count, setCount] = useState("1");
  const [custom, setCustom] = useState("3");
  const [category, setCategory] = useState<Category>("General");
  const [adding, setAdding] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // take new page data only if it was loaded after the latest save; drop the local values it now contains
  useEffect(() => {
    const t = Date.parse(data.loadedAt);
    if (t < lastSave.current && staleTries.current < STALE_RETRIES) { staleTries.current++; router.refresh(); return; }
    staleTries.current = 0;
    setSnap(data);
    setLocal((o) => Object.fromEntries(Object.entries(o).filter(([, e]) => e.at > t)));
  }, [data, router]);

  const val = <T,>(key: string, loaded: T): T => (key in local ? (local[key].v as T) : loaded);
  const savedAtOf = (r: ActionResult) => (r.ok ? Date.parse(((r.data ?? {}) as { at?: string }).at ?? "") || 0 : 0);

  /** Run a save; `show`: the values to show at once (by key) while it is on its way and until newer data arrives. */
  const save: Save = async (fn, show = {}) => {
    const mine = ++seq.current;
    const keys = Object.keys(show);
    if (keys.length) setLocal((o) => ({ ...o, ...Object.fromEntries(keys.map((k) => [k, { v: show[k], at: Infinity, seq: mine }])) }));
    setPending((n) => n + 1);
    const r = await fn().catch(() => ({ ok: false as const, message: "Couldn't reach the server. Try again." }));
    setPending((n) => n - 1);
    const at = savedAtOf(r);
    if (r.ok) lastSave.current = Math.max(lastSave.current, at);
    if (keys.length) {
      setLocal((o) => {
        const n = { ...o };
        for (const k of keys) {
          if (n[k]?.seq !== mine) continue;                     // a later change of the same cell owns it now
          if (r.ok) n[k] = { ...n[k], at }; else delete n[k];   // refused: the saved value shows again
        }
        return n;
      });
    }
    if (r.ok) { setState({ ok: true, message: "All changes saved" }); router.refresh(); }
    else { setState({ ok: false, message: r.message }); toast({ ok: false, message: r.message }); }
    return r.ok;
  };

  async function addRows(n: number, phaseId: string | null, cat: Category) {
    if (!(n >= 1 && n <= MAX_ADD) || !Number.isInteger(n)) { toast({ ok: false, message: `Add 1 to ${MAX_ADD} rows at a time` }); return; }
    setAdding(true);
    setPending((x) => x + 1);
    const r = await addTasklistRows({ project_id: projectId, count: n, phase_id: phaseId, category: cat })
      .catch(() => ({ ok: false as const, message: "Couldn't reach the server. Try again." }));
    setPending((x) => x - 1);
    setAdding(false);
    toast({ ok: r.ok, message: r.message ?? (r.ok ? "Rows added" : "Couldn't add rows") });
    setState(r.ok ? { ok: true, message: "All changes saved" } : { ok: false, message: r.message ?? "Couldn't add rows" });
    if (r.ok) {
      lastSave.current = Math.max(lastSave.current, savedAtOf(r));
      setFocusRow(r.data?.ids?.[0] ?? null);
      router.refresh();
    }
  }

  // what is shown: the loaded data with the local values on top (removed rows left out)
  const people_ = (id: string) => val(`p:${id}`, snap.assignees[id] ?? []);
  const rows: TasklistRow[] = snap.rows.flatMap((r): TasklistRow[] => {
    if (r.kind === "phase") return [r];
    if (r.kind === "row") {
      const x = r.row, k = `r:${x.id}:`;
      if (val(`x:${x.id}`, false)) return [];
      return [{ ...r, row: { ...x, title: val(k + "title", x.title), status: val(k + "status", x.status), priority: val(k + "priority", x.priority),
        comment: val(k + "comment", x.comment), phaseId: val(k + "phase", x.phaseId), category: val(k + "category", x.category) } }];
    }
    const t = r.task, k = `t:${t.id}:`;
    return [{ ...r, task: { ...t, title: val(k + "title", t.title), status: val(k + "status", t.status), priority: val(k + "priority", t.priority) } }];
  });
  const commentOf = (id: string) => val(`c:${id}`, snap.comments[id] ?? "");
  const categoryOf = (id: string) => val<Category>(`g:${id}`, snap.categories[id] ?? "General");

  async function exportExcel() {
    setExporting(true);
    try {
      const out: (string | null)[][] = [];
      const heads: number[] = [];
      for (const r of rows) {
        if (r.kind === "phase") { heads.push(out.length); out.push([r.label, null, null, null, null, null]); continue; }
        if (r.kind === "row") {
          const x = r.row;
          out.push([x.title || "-", categoryLabel(x.category), people_(x.id).map((p) => p.name).join(", "), tasklistStatus(x.status), x.comment || "-", x.priority]);
          continue;
        }
        const t = r.task;
        const names = [t.assignee_name ?? "", ...people_(t.id).map((p) => p.name)].filter(Boolean).join(", ");
        out.push([`${r.no}. ${t.title}`, categoryLabel(categoryOf(t.id)), names, tasklistStatus(t.status), commentOf(t.id) || "-", t.priority]);
      }
      await downloadXlsx(`${projectName.replace(/[^\w-]+/g, "-")}-tasklist`, [{
        name: "Tasklist", title: projectName,
        columns: EXPORT_HEAD.map((header, i) => ({ header, width: EXPORT_WIDTHS[i], kind: i === 3 ? "status" : i === 5 ? "priority" : "text", align: i === 1 || i === 3 || i === 5 ? "center" : "left" })),
        rows: out, headerFill: "#34483c",
        rowStyle: (i) => (heads.includes(i) ? { fill: "#dfe8e0", color: "#26332b", bold: true } : undefined),
      }]);
    } catch { toast({ ok: false, message: "The Excel file couldn't be made. Try again." }); }
    setExporting(false);
  }

  /** Add or remove a person on a task or row, showing the new list at once. */
  const peopleOps = (id: string, add: (userId: string) => Promise<ActionResult>, remove: (userId: string) => Promise<ActionResult>) => ({
    onAdd: (userId: string) => {
      const p = people.find((x) => x.id === userId);
      if (p) void save(() => add(userId), { [`p:${id}`]: [...people_(id), p] });
    },
    onRemove: (userId: string) => void save(() => remove(userId), { [`p:${id}`]: people_(id).filter((x) => x.id !== userId) }),
  });

  const n = count === "custom" ? Number(custom) : Number(count);
  const cell = "border border-line px-2 py-1 align-middle";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
          <span>
            {archived ? "This project is archived, so its Tasklist is read-only."
              : canEdit ? "Click a cell to edit it. Changes save on their own (Enter or click away; Esc cancels)."
                : "Only members of this project can edit its Tasklist."}
          </span>
          {canEdit ? (
            <span data-testid="save-status" aria-live="polite"
              className={`inline-flex items-center gap-1 text-xs font-semibold ${pending ? "text-ink-soft" : state?.ok === false ? "text-[#b3261e]" : "text-[#1d6b40]"}`}>
              {pending ? <><Loader2 size={13} className="animate-spin" />Saving…</>
                : state?.ok === false ? <><AlertCircle size={13} />Not saved: {state.message}</>
                  : state ? <><Check size={13} />{state.message}</> : null}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <form data-testid="add-rows-form" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1"
              onSubmit={(e) => { e.preventDefault(); void addRows(n, null, category); }}>
              <span className="text-sm font-semibold text-ink">Add</span>
              <select aria-label="How many rows" value={count} onChange={(e) => setCount(e.target.value)} className="h-8 rounded border border-line bg-panel px-1 text-sm">
                {COUNTS.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="custom">Custom…</option>
              </select>
              {count === "custom" ? (
                <input aria-label="Number of rows" type="number" min={1} max={MAX_ADD} step={1} value={custom} onChange={(e) => setCustom(e.target.value)}
                  className="h-8 w-16 rounded border border-line bg-panel px-1.5 text-sm" />
              ) : null}
              <span className="text-sm text-ink-soft">{n === 1 ? "row" : "rows"} as</span>
              <select aria-label="Category of the new rows" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="h-8 rounded border border-line bg-panel px-1 text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
              <Button size="sm" type="submit" pending={adding} data-testid="add-rows"><Plus size={15} className="mr-1" />Add row{n === 1 ? "" : "s"}</Button>
            </form>
          ) : null}
          {canExport ? <Button variant="secondary" size="sm" onClick={exportExcel} pending={exporting}><Download size={16} className="mr-1" />Export Excel</Button> : null}
        </div>
      </div>
      <div className="max-h-[calc(100vh-13rem)] overflow-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[1180px] table-fixed border-collapse text-sm" data-testid="tasklist">
          <colgroup>{WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-steel text-white">{HEAD.map((h) => <th key={h} className="border border-steel-dark px-2.5 py-2 text-center font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-soft">{canEdit ? "No tasks yet. Use Add rows above to start the list." : "No tasks yet."}</td></tr>
            ) : rows.map((r) => {
              if (r.kind === "phase") {
                return (
                  <tr key={r.key} data-testid="tasklist-phase" data-phase={r.taskId ?? ""} className="bg-[#dfe8e0]">
                    <td colSpan={5} className="border border-line px-2.5 py-1.5 font-semibold text-ink">
                      <div className="flex items-center gap-2">
                        <span>{r.label}</span><span className="text-xs font-normal text-ink-soft">{r.count} {r.count === 1 ? "task" : "tasks"}</span>
                        {canEdit ? (
                          <button type="button" data-testid="phase-add-row" disabled={adding} onClick={() => void addRows(1, r.taskId, "General")}
                            className="ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold text-steel hover:bg-white/60">
                            <Plus size={13} />Add row
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }
              if (r.kind === "row") {
                const x = r.row;
                return <SheetLine key={r.key} row={x} projectId={projectId} people={people} extra={people_(x.id)}
                  canEdit={canEdit} save={save} autoFocus={focusRow === x.id} cell={cell}
                  ops={peopleOps(x.id, (u) => addTasklistRowAssignee({ row_id: x.id, user_id: u, project_id: projectId }),
                    (u) => removeTasklistRowAssignee({ row_id: x.id, user_id: u, project_id: projectId }))} />;
              }
              const t = r.task;
              return <TaskLine key={r.key} no={r.no} task={t} projectId={projectId} people={people} extra={people_(t.id)}
                comment={commentOf(t.id)} category={categoryOf(t.id)} canEdit={canEdit} save={save} cell={cell}
                ops={peopleOps(t.id, (u) => addTaskAssignee({ task_id: t.id, user_id: u, project_id: projectId }),
                  (u) => removeTaskAssignee({ task_id: t.id, user_id: u, project_id: projectId }))} />;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type PeopleOps = { onAdd: (userId: string) => void; onRemove: (userId: string) => void };

/** A real task of the project: name, people, status, comment and priority; its phase is its place in the task tree. */
function TaskLine({ no, task: t, projectId, people, extra, comment, category, canEdit, save, cell, ops }: {
  no: string; task: TasklistTask; projectId: string; people: Person[]; extra: Person[]; comment: string; category: Category;
  canEdit: boolean; save: Save; cell: string; ops: PeopleOps;
}) {
  const owner: Person = { id: t.assigned_to, name: t.assignee_name ?? "Unassigned" };
  const patch = (p: TasklistTaskPatch) => save(() => updateTasklistTask({ task_id: t.id, project_id: projectId, patch: p }),
    Object.fromEntries(Object.entries(p).map(([k, v]) => [`t:${t.id}:${k}`, v])));
  return (
    <tr data-testid="tasklist-row" data-task={t.id} className="hover:bg-paper/60">
      <td className={cell}>
        <div className="flex items-start gap-1">
          <span className="shrink-0 pt-1 text-[13px] font-semibold text-ink-soft">{no}.</span>
          {canEdit ? (
            <CellText value={t.title} label={`Name of ${t.code}`} maxLength={300} required testId="task-title"
              onSave={(v) => patch({ title: v })} />
          ) : <span className="min-w-0 flex-1 pt-1 text-[13px]">{t.title}</span>}
          {canEdit ? (
            <CategorySelect value={category} label={`Category of ${t.title}`}
              onChange={(v) => void save(() => saveTasklistCategory({ task_id: t.id, category: v, project_id: projectId }), { [`g:${t.id}`]: v })} />
          ) : <CategoryPill value={category} />}
          <Link href={`/projects/${projectId}/tasks/${t.id}`} title={`Open ${t.code}`} aria-label={`Open ${t.code}`}
            className="shrink-0 pt-1 text-ink-faint hover:text-steel"><ExternalLink size={13} /></Link>
        </div>
      </td>
      <td className={cell}>
        <PeopleCell name={t.title} owner={owner} extra={extra} people={people} editable={canEdit} onAdd={ops.onAdd} onRemove={ops.onRemove} />
      </td>
      <td className={`${cell} text-center`}>
        {canEdit ? <StatusSelect value={t.status} label={`Status of ${t.title}`} onChange={(v) => void patch({ status: v as Status })} />
          : <Pill tone={STATUS_TONE[t.status]}>{tasklistStatus(t.status)}</Pill>}
      </td>
      <td className={cell}>
        {canEdit ? (
          <CellText value={comment} label={`Comment on ${t.title}`} placeholder="-" maxLength={500} testId="task-comment"
            onSave={(v) => save(() => saveTasklistComment({ task_id: t.id, body: v, project_id: projectId }), { [`c:${t.id}`]: v })} />
        ) : <span className="text-[13px]">{comment || "-"}</span>}
      </td>
      <td className={`${cell} text-center`}>
        {canEdit ? <PrioritySelect value={t.priority} label={`Priority of ${t.title}`} onChange={(v) => void patch({ priority: v })} />
          : <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>}
      </td>
    </tr>
  );
}

/** A row added on the Tasklist: every cell editable, including its phase; removable while it was never filled in. */
function SheetLine({ row: x, projectId, people, extra, canEdit, save, autoFocus, cell, ops }: {
  row: SheetRow; projectId: string; people: Person[]; extra: Person[];
  canEdit: boolean; save: Save; autoFocus: boolean; cell: string; ops: PeopleOps;
}) {
  const label = x.title || "new row";
  const key = (k: string) => (k === "phase_task_id" ? `r:${x.id}:phase` : `r:${x.id}:${k}`);
  const patch = (p: TasklistRowPatch) => save(() => updateTasklistRow({ row_id: x.id, project_id: projectId, patch: p }),
    Object.fromEntries(Object.entries(p).map(([k, v]) => [key(k), v])));
  const blank = !x.title && !x.comment && !extra.length;
  return (
    <tr data-testid="tasklist-sheet-row" data-row={x.id} className="hover:bg-paper/60">
      <td className={cell}>
        <div className="flex items-start gap-1">
          {canEdit ? (
            <>
              <CellText value={x.title} label={`Name of ${label}`} placeholder="Type a task name…" maxLength={300} autoFocus={autoFocus} testId="row-title"
                onSave={(v) => patch({ title: v })} />
              <CategorySelect value={x.category} label={`Category of ${label}`} onChange={(v) => void patch({ category: v })} />
              {blank ? (
                <button type="button" title="Remove this empty row" aria-label={`Remove ${label}`} data-testid="remove-row"
                  onClick={() => void save(() => removeTasklistRow({ row_id: x.id, project_id: projectId }), { [`x:${x.id}`]: true })}
                  className="mt-1 shrink-0 text-ink-faint hover:text-[#b3261e]"><Trash2 size={13} /></button>
              ) : null}
            </>
          ) : <><span className="min-w-0 flex-1 pt-1 text-[13px]">{x.title || <span className="text-ink-faint">-</span>}</span><CategoryPill value={x.category} /></>}
        </div>
      </td>
      <td className={cell}>
        <PeopleCell name={label} extra={extra} people={people} editable={canEdit} onAdd={ops.onAdd} onRemove={ops.onRemove} />
      </td>
      <td className={`${cell} text-center`}>
        {canEdit ? <StatusSelect value={x.status} label={`Status of ${label}`} onChange={(v) => void patch({ status: v as Status })} />
          : <Pill tone={STATUS_TONE[x.status]}>{tasklistStatus(x.status)}</Pill>}
      </td>
      <td className={cell}>
        {canEdit ? (
          <CellText value={x.comment} label={`Comment on ${label}`} placeholder="-" maxLength={500} testId="row-comment"
            onSave={(v) => patch({ comment: v })} />
        ) : <span className="text-[13px]">{x.comment || "-"}</span>}
      </td>
      <td className={`${cell} text-center`}>
        {canEdit ? <PrioritySelect value={x.priority} label={`Priority of ${label}`} onChange={(v) => void patch({ priority: v })} />
          : <Pill tone={PRIORITY_TONE[x.priority]}>{x.priority}</Pill>}
      </td>
    </tr>
  );
}
