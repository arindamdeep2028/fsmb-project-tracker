"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ExternalLink, MoreHorizontal, Plus } from "lucide-react";
import type { TaskNode } from "@/types/domain";
import { cellCaps, type TaskCaps } from "@/lib/auth/capabilities";
import { createTask, deleteTask, saveCell, setArchived, setEndDate, setStatus, submitPlan } from "@/lib/actions/tasks";
import { dhakaDateOf, letterOf, sheetDay, slOf } from "@/lib/sheet";
import { fmt } from "@/lib/time";
import { cn, pct } from "@/lib/utils";
import { useAction, useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { RedReasons } from "./deadline";
import { MarkDoneButton } from "./mark-done";
import { TaskDialog, type Assignee } from "./task-dialog";
import { ExtensionDialog } from "./extension-dialog";
import { MenuItem, MenuLink, ProgressInput } from "./task-tree";
import { DateCell, EditCell, PriorityBadge, PrioritySelect, SaveMark, onSheetKeyDownCapture, useCellSave, type Priority } from "./cells";

type Props = {
  nodes: TaskNode[];
  caps: Record<string, TaskCaps>;
  projectId: string;
  meId: string;
  /** the viewer is an Admin (they edit every cell, like a project manager) */
  isAdmin?: boolean;
  assignees: Assignee[];
  canCreate: boolean;
  managerView: boolean;
  basePath: string; // /projects/{id}/tasks
  title: { name: string; prepared: string | null };
  /** filtered view: tasks shown only because a subtask matches (greyed, not counted) */
  context?: string[];
};
type DialogState = null | { kind: "edit"; task: TaskNode } | { kind: "extend"; task: TaskNode };

const HEAD = ["SL", "Task", "Sub Task", "Assign To", "Priority", "Status", "Start Date", "End Date", "Progress", "Remarks"];
// Fixed column widths (px): the grid is identical for every viewer, whatever controls their permissions enable.
const WIDTHS = [44, 200, 300, 116, 104, 132, 88, 124, 92, 180, 112];
const READ_ONLY = "Only members of this project can change this";
const cell = "border border-line px-2 py-2 align-top break-words";

/**
 * Project plan in the layout of the workbook's Task list, edited like a spreadsheet: one row per task (SL from its
 * code), its subtasks a., b., c. in the Sub Task cell. Cells save on their own (Enter or click away; Esc cancels;
 * Ctrl+Enter in any editable cell goes back to the start of the cell, nothing saved). New tasks are typed into the last row and new subtasks
 * under their task, with no dialog. Every member sees the whole plan (migration 21); what a viewer may edit follows
 * their role (cellCaps / taskCaps), and the database checks every change again.
 */
export function ProjectPlan(props: Props) {
  const [dialog, setDialog] = useState<DialogState>(null);
  // who a task can go to: managers → the project's current members (an Admin who is not a member is not one of them);
  // engineers → themselves or an engineer member
  const options = props.managerView || props.assignees.some((a) => a.user_id === props.meId)
    ? props.assignees : [{ user_id: props.meId, full_name: "Me" }, ...props.assignees];

  return (
    <div>
      <p className="mb-2 text-sm text-ink-soft">
        Click a cell to edit it. Changes save on their own (Enter or click away; Esc cancels; Shift+Enter adds a line in Remarks).
        {props.canCreate ? " Type a new task into the last row, or a subtask under its task." : ""}
      </p>
      {/* relative: absolutely placed bits inside (screen-reader labels, save marks) stay clipped by this box on a phone */}
      <div className="relative overflow-x-auto rounded-lg border border-line bg-panel" data-sheet="responsibilities" onKeyDownCapture={onSheetKeyDownCapture}>
        <table className="w-full min-w-[1592px] table-fixed border-collapse text-sm" data-testid="plan">
          <colgroup>{WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              <th colSpan={HEAD.length + 1} className="bg-steel-dark px-4 py-3 text-center font-semibold text-white">
                <span className="block text-base uppercase tracking-wide">{props.title.name}</span>
                <span className="block font-normal">Project Plan</span>
                {props.title.prepared ? <span className="block font-normal">Prepared: {fmt(props.title.prepared, "dd-MMM-yyyy")}</span> : null}
              </th>
            </tr>
            <tr className="bg-[#efeadf] text-ink">
              {HEAD.map((h) => <th key={h} className="border border-line px-2 py-2 text-center font-semibold">{h}</th>)}
              <th className="border border-line px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {props.nodes.length === 0 && !props.canCreate ? (
              <tr><td colSpan={HEAD.length + 1} className="px-6 py-10 text-center text-ink-soft">No tasks yet.</td></tr>
            ) : props.nodes.map((n) => <PlanRow key={n.id} {...props} options={options} node={n} onDialog={setDialog} />)}
            {props.canCreate ? <NewTaskRow projectId={props.projectId} meId={props.meId} options={options} managerView={props.managerView} first={props.nodes.length === 0} /> : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === "edit" ? (
        <TaskDialog open onOpenChange={(o) => !o && setDialog(null)} projectId={props.projectId} meId={props.meId} assignees={props.assignees}
          task={dialog.task} caps={props.caps[dialog.task.id]} />
      ) : null}
      {dialog?.kind === "extend" ? <ExtensionDialog open onOpenChange={(o) => !o && setDialog(null)} task={dialog.task} /> : null}
    </div>
  );
}

/** Status dropdown; every user who may change the status may also move a Completed task back to any other status. */
function StatusCell({ n, statuses, small }: { n: TaskNode; statuses: string[]; small?: boolean }) {
  const { state, message, run } = useCellSave();
  const done = n.status === "Completed";
  const editable = statuses.length > 0;
  if (done && !editable) return <span className={small ? "text-xs" : undefined}>{n.status}</span>;
  return (
    <div className="relative">
      <select aria-label={`Status of ${n.code}`} value={n.status} disabled={!editable || state === "saving"} title={editable ? (done ? "Completed: choose a status to reopen it" : undefined) : READ_ONLY}
        data-col={small ? "sub-status" : "status"} data-testid="status-select"
        onChange={(e) => void run(() => setStatus(n.id, e.target.value))}
        className={cn("w-full rounded-md border border-line bg-panel px-1.5 disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink",
          small ? "h-6 px-1 text-xs" : "h-8 text-sm", done && "bg-[#dcebd2]")}>
        <option>{n.status}</option>
        {statuses.filter((s) => s !== n.status).map((s) => <option key={s}>{s}</option>)}
      </select>
      <SaveMark state={state} message={message} />
    </div>
  );
}

function OwnerCell({ n, options, editable, col, small }: { n: TaskNode; options: Assignee[]; editable: boolean; col: string; small?: boolean }) {
  const { state, message, run } = useCellSave();
  if (!editable) return <span className={small ? "text-xs" : undefined}>{n.assignee_name ?? "—"}</span>;
  const list = options.some((a) => a.user_id === n.assigned_to) ? options : [{ user_id: n.assigned_to, full_name: n.assignee_name ?? "Current owner" }, ...options];
  return (
    <div className="relative">
      <select aria-label={`Owner of ${n.code}`} value={n.assigned_to} data-col={col} disabled={state === "saving"}
        onChange={(e) => void run(() => saveCell(n.id, { assigned_to: e.target.value }))}
        className={cn("w-full rounded-md border border-transparent bg-transparent px-1 hover:border-line focus:border-steel", small ? "h-6 text-xs" : "h-8 text-sm")}>
        {list.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}
      </select>
      <SaveMark state={state} message={message} />
    </div>
  );
}

function PriorityCell({ n, editable, col }: { n: TaskNode; editable: boolean; col: string }) {
  const { state, message, run } = useCellSave();
  if (!editable) return <PriorityBadge priority={n.priority} />;
  return (
    <div className="relative">
      <PrioritySelect value={n.priority} label={`Priority of ${n.code}`} col={col} disabled={state === "saving"}
        onChange={(v) => void run(() => saveCell(n.id, { priority: v }))} />
      <SaveMark state={state} message={message} />
    </div>
  );
}

function PlanRow({ node: n, caps, meId, basePath, canCreate, onDialog, context, options }: Props & {
  node: TaskNode; onDialog: (d: DialogState) => void; options: Assignee[];
}) {
  const onlyContext = Boolean(context?.includes(n.id));
  const c = caps[n.id];
  const cc = cellCaps(c, { status: n.status, isLeaf: n.is_leaf });
  const { pending, run } = useAction();
  const done = n.status === "Completed";
  const progress = n.is_leaf ? n.progress_pct : n.calculated_progress;
  const overdue = !done && Boolean(n.effective_due_at) && new Date(n.effective_due_at!) < new Date();
  const openSubtasks = n.children.filter((x) => x.status !== "Completed").map((x) => ({ code: x.code, title: x.title }));
  // the database lets a member add a subtask only under a task they own or created
  const canAddSubtask = canCreate && (c?.manager || n.assigned_to === meId || n.created_by === meId);
  // Mark Done is a status change: anyone who may change the status (taskCaps.statuses)
  const canComplete = Boolean(c?.statuses.includes("Completed"));

  return (
    <tr aria-busy={pending || undefined} className={cn(done && "text-ink-soft")} data-context={onlyContext || undefined} data-testid="plan-row" data-task={n.id}>
      <td className={cn(cell, "bg-steel-dark text-center font-semibold text-white")}>{slOf(n.code)}</td>
      <td className={cell}>
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            {cc.title ? (
              <EditCell value={n.title} label={`Name of ${n.code}`} col="title" required maxLength={300} multiline testId="task-title"
                onSave={(v) => saveCell(n.id, { title: v.replace(/\s*\n\s*/g, " ") })} className="font-medium" />
            ) : (
              <Link href={`${basePath}/${n.id}`} className={cn("font-medium hover:text-steel hover:underline", onlyContext && "text-ink-faint")}>{n.title}</Link>
            )}
            <div className="px-1.5 text-xs text-ink-faint">{n.code}{onlyContext ? " · shown for its matching subtask" : ""}</div>
            {n.is_red && !done ? <div className="mt-1"><RedReasons reasons={n.reasons} /></div> : null}
          </div>
          {cc.title ? <Link href={`${basePath}/${n.id}`} title={`Open ${n.code}`} aria-label={`Open ${n.code}`} className="shrink-0 pt-1.5 text-ink-faint hover:text-steel"><ExternalLink size={13} /></Link> : null}
        </div>
      </td>
      <td className={cell}>
        {n.children.length ? (
          <ul className="space-y-2">
            {n.children.map((s) => <SubtaskLine key={s.id} s={s} c={caps[s.id]} parentAssignee={n.assigned_to} basePath={basePath} options={options} />)}
          </ul>
        ) : null}
        {canAddSubtask && !done ? <AddSubtask parent={n} meId={meId} options={options} /> : null}
      </td>
      <td className={cn(cell, "bg-[#efeadf] text-center")}><OwnerCell n={n} options={options} editable={cc.assignee} col="owner" /></td>
      <td className={cn(cell, "text-center")}><PriorityCell n={n} editable={cc.priority} col="priority" /></td>
      <td className={cn(cell, "text-center", done && "bg-[#dcebd2] text-ink")}><StatusCell n={n} statuses={cc.statuses} /></td>
      <td className={cn(cell, "whitespace-nowrap text-center font-medium")}>{sheetDay(n.assigned_on)}</td>
      <td className={cn(cell, "whitespace-nowrap text-center font-medium", overdue && "text-signal-red")} title={done ? "Completed on" : overdue ? "Past the deadline" : undefined}>
        {cc.endDate ? (
          <DateCell value={dhakaDateOf(n.effective_due_at)} label={`End date of ${n.code}`} col="end" testId="end-date" overdue={overdue}
            onSave={(d) => setEndDate(n.id, d)} />
        ) : <span data-testid="end-date-text">{sheetDay(done ? n.completed_on : n.effective_due_at)}</span>}
      </td>
      <td className={cn(cell, "text-center")}>
        {n.is_leaf && !done ? (
          <span className="inline-block" title={cc.progress ? undefined : READ_ONLY}>
            <ProgressInput value={n.progress_pct ?? 0} disabled={pending || !cc.progress} onCommit={(v) => run(() => saveCell(n.id, { progress_pct: v }))} label={n.code} />
          </span>
        ) : <span data-testid="row-progress" title={n.is_leaf ? undefined : "Calculated from its subtasks"}>{pct(progress)}</span>}
      </td>
      <td className={cn(cell, "text-ink-soft")}>
        {cc.remarks ? (
          <EditCell value={n.description ?? ""} label={`Remarks of ${n.code}`} col="remarks" multiline placeholder="-" testId="remarks"
            onSave={(v) => saveCell(n.id, { description: v })} />
        ) : <span className="line-clamp-4 whitespace-pre-wrap">{n.description}</span>}
      </td>
      <td className={cell}>
        <div className="flex items-center justify-end gap-1">
          {done ? null : canComplete
            ? <MarkDoneButton task={n} openSubtasks={openSubtasks} manager={Boolean(c?.manager)} parentPrompt={null} />
            : <Button size="sm" variant="secondary" disabled title={READ_ONLY}>Mark Done</Button>}
          <DM.Root>
            <DM.Trigger aria-label={`Actions for ${n.code}`} className="rounded p-1.5 text-ink-soft hover:bg-steel-wash hover:text-steel"><MoreHorizontal size={18} /></DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
                <MenuLink href={`${basePath}/${n.id}`}>Open task</MenuLink>
                {c?.isAssignee && !n.plan_submitted_at && !done ? <MenuItem onSelect={() => run(() => submitPlan(n.id, n.status))}>Submit plan</MenuItem> : null}
                {c && (c.manager || c.titleAndAssignee || c.priority || c.contribution) ? <MenuItem onSelect={() => onDialog({ kind: "edit", task: n })}>Edit details (share, owner…)</MenuItem> : null}
                {n.children.filter((s) => caps[s.id] && (caps[s.id].manager || caps[s.id].titleAndAssignee || caps[s.id].priority || caps[s.id].contribution))
                  .map((s) => <MenuItem key={s.id} onSelect={() => onDialog({ kind: "edit", task: s })}>Edit subtask {letterOf(s.code)}. details</MenuItem>)}
                {c?.deadline && !done ? <MenuItem onSelect={() => onDialog({ kind: "extend", task: n })}>Grant extension</MenuItem> : null}
                {c?.archive ? <MenuItem onSelect={() => run(() => setArchived(n.id, true))}>Archive</MenuItem> : null}
                {c?.remove ? (
                  <MenuItem danger onSelect={() => { if (confirm(`Delete ${n.code}${n.children.length ? " and its subtasks" : ""}? This can't be undone.`)) run(() => deleteTask(n.id)); }}>Delete</MenuItem>
                ) : null}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        </div>
      </td>
    </tr>
  );
}

/** "a. Title" with its owner, priority, status, deadline and progress; every part editable in place where allowed. */
function SubtaskLine({ s, c, parentAssignee, basePath, options }: {
  s: TaskNode; c?: TaskCaps; parentAssignee: string; basePath: string; options: Assignee[];
}) {
  const { pending, run } = useAction();
  const cc = cellCaps(c, { status: s.status, isLeaf: true });
  const done = s.status === "Completed";
  const overdue = !done && Boolean(s.effective_due_at) && new Date(s.effective_due_at!) < new Date();
  return (
    <li aria-busy={pending || undefined} data-testid="subtask" data-task={s.id} className="rounded border border-line-soft bg-paper/40 p-1">
      <div className="flex items-start gap-1">
        <span className="shrink-0 pt-1 text-[13px] font-semibold text-ink-soft">{letterOf(s.code)}.</span>
        <div className="min-w-0 flex-1">
          {cc.title ? (
            <EditCell value={s.title} label={`Name of ${s.code}`} col="sub-title" required maxLength={300} multiline testId="subtask-title"
              onSave={(v) => saveCell(s.id, { title: v.replace(/\s*\n\s*/g, " ") })} className={cn(done && "line-through decoration-ink-faint")} />
          ) : (
            <Link href={`${basePath}/${s.id}`} className={cn("block pt-1 text-[13px] hover:text-steel hover:underline", done && "text-ink-soft line-through decoration-ink-faint")}>{s.title}</Link>
          )}
        </div>
        <Link href={`${basePath}/${s.id}`} title={`Open ${s.code}`} aria-label={`Open ${s.code}`} className="shrink-0 pt-1.5 text-ink-faint hover:text-steel"><ExternalLink size={12} /></Link>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-ink-soft">
        <div className="col-span-2">
          {cc.assignee ? <OwnerCell n={s} options={options} editable col="sub-owner" small />
            : s.assigned_to !== parentAssignee ? <span>{s.assignee_name}</span> : null}
        </div>
        <StatusCell n={s} statuses={cc.statuses} small />
        {cc.priority ? <PriorityCell n={s} editable col="sub-priority" /> : <span className="text-center"><PriorityBadge priority={s.priority} /></span>}
        <div className={cn("flex items-center gap-1", overdue && "text-signal-red")}>
          <span>Due</span>
          {cc.endDate ? (
            <DateCell value={dhakaDateOf(s.effective_due_at)} label={`End date of ${s.code}`} col="sub-end" overdue={overdue} onSave={(d) => setEndDate(s.id, d)} />
          ) : <span>{sheetDay(done ? s.completed_on : s.effective_due_at) || "-"}</span>}
        </div>
        <div className="flex items-center justify-end">
          {cc.progress
            ? <ProgressInput value={s.progress_pct ?? 0} disabled={pending} onCommit={(v) => run(() => saveCell(s.id, { progress_pct: v }))} label={s.code} />
            : <span>{pct(s.progress_pct)}</span>}
        </div>
      </div>
    </li>
  );
}

/** Type a subtask under its task and press Enter (or Add): it is created at once; the field stays for the next one. */
function AddSubtask({ parent, meId, options }: { parent: TaskNode; meId: string; options: Assignee[] }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const mark = useCellSave();
  // the subtask goes to the task's owner when the viewer may assign to them, otherwise to the viewer
  const owner = options.some((a) => a.user_id === parent.assigned_to) ? parent.assigned_to
    : options.some((a) => a.user_id === meId) ? meId : options[0]?.user_id ?? meId;
  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    let r: { ok: boolean; message?: string } = { ok: false };
    await mark.run(async () => {
      r = await createTask({ project_id: parent.project_id, parent_id: parent.id, title: t, priority: "Normal", assigned_to: owner })
        .catch(() => ({ ok: false as const, message: "Couldn't reach the server. Try again." }));
      return r;
    });
    setBusy(false);
    toast({ ok: r.ok, message: r.message ?? (r.ok ? "Subtask added" : "Couldn't add the subtask") });
    if (r.ok) { setTitle(""); requestAnimationFrame(() => ref.current?.focus()); }
  }
  return (
    <div className="relative mt-1.5 flex items-center gap-1">
      <input ref={ref} value={title} onChange={(e) => { setTitle(e.target.value); if (mark.state === "error") mark.clear(); }} placeholder="+ Add subtask…"
        aria-label={`New subtask of ${parent.code}`} data-testid="add-subtask" maxLength={300} disabled={busy} aria-invalid={mark.state === "error" || undefined}
        onKeyDown={(e) => {
          // Enter adds it; Esc cancels (clears the text and leaves the field); Ctrl+Enter does nothing here
          if (e.key === "Enter") { e.preventDefault(); if (!e.ctrlKey && !e.metaKey && !e.altKey) void add(); }
          if (e.key === "Escape") { e.preventDefault(); setTitle(""); mark.clear(); e.currentTarget.blur(); }
        }}
        className={cn("h-7 min-w-0 flex-1 rounded border border-dashed bg-transparent px-1.5 pr-4 text-[13px] placeholder:text-ink-faint focus:border-steel focus:bg-[#fffdf3] focus:outline-none",
          mark.state === "error" ? "border-[#b3261e] bg-[#fbeceb]" : "border-line")} />
      <SaveMark state={mark.state} message={mark.message} />
      {title.trim() ? <Button size="sm" type="button" pending={busy} onClick={() => void add()}>Add</Button> : null}
    </div>
  );
}

/** The last row of the plan: type a new task (name, owner, priority, end date for managers, remarks) and press Enter. */
function NewTaskRow({ projectId, meId, options, managerView, first }: { projectId: string; meId: string; options: Assignee[]; managerView: boolean; first: boolean }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  // me when I can own it, otherwise the first person it can go to
  const [owner, setOwner] = useState(options.some((a) => a.user_id === meId) ? meId : options[0]?.user_id ?? meId);
  const [priority, setPriority] = useState<Priority>("Normal");
  const [end, setEnd] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const mark = useCellSave();

  async function add() {
    const t = title.trim();
    if (!t) { setError("Type the task name first"); ref.current?.focus(); return; }
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await mark.run(async () => {
      const r = await createTask({ project_id: projectId, parent_id: null, title: t, description: remarks, priority, assigned_to: owner })
        .catch(() => ({ ok: false as const, message: "Couldn't reach the server. Try again.", data: undefined }));
      if (!r.ok) { setError(r.message ?? "Couldn't add the task"); return r; }
      // the end date goes through the same rule as the End Date cell (office closing time of that day)
      const due = managerView && end && r.data ? await setEndDate(r.data.id, end).catch(() => ({ ok: false as const, message: "Couldn't reach the server." })) : null;
      toast(due && !due.ok ? { ok: false, message: `${r.message}, but its end date wasn't saved: ${due.message}` } : { ok: true, message: r.message ?? "Task added" });
      setTitle(""); setRemarks(""); setEnd("");
      return { ok: true };
    });
    setBusy(false);
    if (ok) requestAnimationFrame(() => ref.current?.focus());
  }
  /** Esc: cancel the row being typed (clear it and leave it). */
  function cancel(el: HTMLElement) { setTitle(""); setRemarks(""); setEnd(""); setError(null); mark.clear(); el.blur(); }
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(e.currentTarget); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void add(); }
  };
  /** The task name is the Task column: Ctrl+Enter takes the caret to the start of the text (nothing is added). */
  const onTitleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.setSelectionRange(0, 0); e.currentTarget.scrollLeft = 0; return;
    }
    onKey(e);
  };
  const box = "h-8 w-full rounded border border-dashed border-line bg-transparent px-1.5 text-[13px] placeholder:text-ink-faint focus:border-steel focus:bg-[#fffdf3] focus:outline-none";

  return (
    <tr data-testid="new-task-row" className="bg-[#fbfaf4]">
      <td className={cn(cell, "text-center text-ink-faint")}><Plus size={14} className="mx-auto" aria-hidden /></td>
      <td className={cell} colSpan={2}>
        <div className="relative">
          <input ref={ref} value={title} onChange={(e) => { setTitle(e.target.value); setError(null); if (mark.state === "error") mark.clear(); }} onKeyDown={onTitleKey}
            maxLength={300} disabled={busy} aria-invalid={Boolean(error) || undefined}
            placeholder={first ? "Type the first task and press Enter…" : "Type a new task and press Enter…"} aria-label="New task name" data-testid="new-task-title"
            className={cn(box, "pr-4", error && "border-[#b3261e] bg-[#fbeceb]")} />
          <SaveMark state={mark.state} message={error ?? mark.message} />
        </div>
        {error ? <p className="mt-1 text-xs text-[#b3261e]" role="alert">{error}</p> : <p className="mt-1 text-[11px] text-ink-faint">Add subtasks under it once it is created.</p>}
      </td>
      <td className={cell}>
        <select aria-label="Owner of the new task" value={owner} onChange={(e) => setOwner(e.target.value)} onKeyDown={onKey} className={box} data-testid="new-task-owner">
          {options.map((a) => <option key={a.user_id} value={a.user_id}>{a.user_id === meId ? `${a.full_name} (me)` : a.full_name}</option>)}
        </select>
      </td>
      <td className={cell}>
        <PrioritySelect value={priority} label="Priority of the new task" onChange={setPriority} />
      </td>
      <td className={cn(cell, "text-center text-xs text-ink-faint")}>Not started</td>
      <td className={cn(cell, "text-center text-xs text-ink-faint")}>Today</td>
      <td className={cell}>
        {managerView ? <input type="date" aria-label="End date of the new task" value={end} onChange={(e) => setEnd(e.target.value)} onKeyDown={onKey} className={box} />
          : <span className="block pt-1.5 text-center text-xs text-ink-faint" title="Set by a project manager">Rule deadline</span>}
      </td>
      <td className={cn(cell, "text-center text-xs text-ink-faint")}>0%</td>
      <td className={cell}>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} onKeyDown={onKey} placeholder="Remarks" aria-label="Remarks of the new task" maxLength={5000} className={box} />
      </td>
      <td className={cell}>
        <Button size="sm" type="button" pending={busy} onClick={() => void add()} data-testid="new-task-add"><Plus size={14} className="mr-0.5" />Add</Button>
      </td>
    </tr>
  );
}
