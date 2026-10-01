"use client";
import { useState } from "react";
import Link from "next/link";
import * as DM from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { TaskNode } from "@/types/domain";
import type { TaskCaps } from "@/lib/auth/capabilities";
import { deleteTask, setArchived, setProgress, setStatus, submitPlan } from "@/lib/actions/tasks";
import { letterOf, slOf } from "@/lib/sheet";
import { fmt } from "@/lib/time";
import { cn, pct } from "@/lib/utils";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { RedReasons } from "./deadline";
import { MarkDoneButton } from "./mark-done";
import { TaskDialog, type Assignee } from "./task-dialog";
import { ExtensionDialog } from "./extension-dialog";
import { MenuItem, MenuLink, ProgressInput } from "./task-tree";

type Props = {
  nodes: TaskNode[];
  caps: Record<string, TaskCaps>;
  projectId: string;
  meId: string;
  assignees: Assignee[];
  canCreate: boolean;
  managerView: boolean;
  basePath: string; // /projects/{id}/tasks
  title: { name: string; prepared: string | null };
};
type DialogState = null | { kind: "new"; parent?: TaskNode } | { kind: "edit"; task: TaskNode } | { kind: "extend"; task: TaskNode };

const HEAD = ["SL", "Task", "Sub Task", "Assign To", "Priority", "Status", "Start Date", "End Date", "Progress", "Remarks"];
const day = (ts: string | null | undefined) => (ts ? fmt(ts, "M/d/yyyy") : "");

/**
 * Project plan in the layout of the workbook's Task list: one row per task (SL from its code), its subtasks
 * listed a., b., c. in the Sub Task cell. Every member sees the whole plan (migration 21); the controls in a
 * row follow the viewer's capabilities, so members work only on tasks assigned to them.
 */
export function ProjectPlan(props: Props) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const managerCaps = { manager: true, titleAndAssignee: true, priority: true, contribution: true, deadline: true, lockContribution: true };
  const engineerCaps = { manager: false, titleAndAssignee: true, priority: true, contribution: true, deadline: false, lockContribution: false };

  return (
    <div>
      {props.canCreate ? (
        <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setDialog({ kind: "new" })}>New task</Button></div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr>
              <th colSpan={HEAD.length + 1} className="bg-steel-dark px-4 py-3 text-center font-semibold text-white">
                <span className="block text-base uppercase tracking-wide">{props.title.name}</span>
                <span className="block font-normal">Project Plan</span>
                {props.title.prepared ? <span className="block font-normal">Prepared: {fmt(props.title.prepared, "dd-MMM-yyyy")}</span> : null}
              </th>
            </tr>
            <tr className="bg-[#efeadf] text-ink">
              {HEAD.map((h) => <th key={h} className="border border-line px-3 py-2 text-center font-semibold">{h}</th>)}
              <th className="border border-line px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {props.nodes.length === 0 ? (
              <tr><td colSpan={HEAD.length + 1} className="px-6 py-10 text-center text-ink-soft">No tasks yet.{props.canCreate ? " Create the first one to start the plan." : ""}</td></tr>
            ) : props.nodes.map((n) => <PlanRow key={n.id} {...props} node={n} onDialog={setDialog} />)}
          </tbody>
        </table>
      </div>
      {dialog?.kind === "new" ? (
        <TaskDialog open onOpenChange={(o) => !o && setDialog(null)} projectId={props.projectId} meId={props.meId} assignees={props.assignees}
          parent={dialog.parent ? { id: dialog.parent.id, code: dialog.parent.code } : null} caps={props.managerView ? managerCaps : engineerCaps} />
      ) : null}
      {dialog?.kind === "edit" ? (
        <TaskDialog open onOpenChange={(o) => !o && setDialog(null)} projectId={props.projectId} meId={props.meId} assignees={props.assignees}
          task={dialog.task} caps={props.caps[dialog.task.id]} />
      ) : null}
      {dialog?.kind === "extend" ? <ExtensionDialog open onOpenChange={(o) => !o && setDialog(null)} task={dialog.task} /> : null}
    </div>
  );
}

function PlanRow({ node: n, caps, meId, basePath, canCreate, onDialog }: Props & { node: TaskNode; onDialog: (d: DialogState) => void }) {
  const c = caps[n.id];
  const { pending, run } = useAction();
  const done = n.status === "Completed";
  const progress = n.is_leaf ? n.progress_pct : n.calculated_progress;
  const overdue = !done && Boolean(n.effective_due_at) && new Date(n.effective_due_at!) < new Date();
  const openSubtasks = n.children.filter((x) => x.status !== "Completed").map((x) => ({ code: x.code, title: x.title }));
  // the database lets a member add a subtask only under a task they own or created
  const canAddSubtask = canCreate && (c?.manager || n.assigned_to === meId || n.created_by === meId);
  const cell = "border border-line px-3 py-2.5 align-middle";

  return (
    <tr aria-busy={pending || undefined} className={cn(done && "text-ink-soft")}>
      <td className={cn(cell, "w-14 bg-steel-dark text-center font-semibold text-white")}>{slOf(n.code)}</td>
      <td className={cn(cell, "min-w-56")}>
        <Link href={`${basePath}/${n.id}`} className="font-medium hover:text-steel hover:underline">{n.title}</Link>
        <div className="text-xs text-ink-faint">{n.code}</div>
        {n.is_red && !done ? <div className="mt-1"><RedReasons reasons={n.reasons} /></div> : null}
      </td>
      <td className={cn(cell, "min-w-64")}>
        {n.children.length ? (
          <ul className="space-y-1.5">
            {n.children.map((s) => <SubtaskLine key={s.id} s={s} c={caps[s.id]} parentAssignee={n.assigned_to} basePath={basePath} />)}
          </ul>
        ) : null}
      </td>
      <td className={cn(cell, "bg-[#efeadf] text-center")}>{n.assignee_name ?? "—"}</td>
      <td className={cn(cell, "text-center")}>{n.priority}</td>
      <td className={cn(cell, "min-w-[9.5rem] text-center", done && "bg-[#dcebd2] text-ink")}>
        {c && !done && c.statuses.some((s) => s !== "Completed") ? (
          <select aria-label={`Status of ${n.code}`} value={n.status} disabled={pending} onChange={(e) => run(() => setStatus(n.id, e.target.value))}
            className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm">
            <option>{n.status}</option>
            {c.statuses.filter((s) => s !== "Completed").map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : n.status}
      </td>
      <td className={cn(cell, "whitespace-nowrap text-center font-medium")}>{day(n.assigned_on)}</td>
      <td className={cn(cell, "whitespace-nowrap text-center font-medium", overdue && "text-signal-red")}
        title={overdue ? "Past the deadline" : undefined}>{day(done ? n.completed_on : n.effective_due_at)}</td>
      <td className={cn(cell, "text-center")}>
        {c?.progress && !done ? (
          <ProgressInput value={n.progress_pct ?? 0} disabled={pending} onCommit={(v) => run(() => setProgress(n.id, v))} label={n.code} />
        ) : pct(progress)}
      </td>
      <td className={cn(cell, "min-w-40 text-ink-soft")}><span className="line-clamp-3 whitespace-pre-wrap">{n.description}</span></td>
      <td className={cn(cell, "w-28")}>
        <div className="flex items-center justify-end gap-1">
          {!done && (c?.manager || c?.isAssignee) ? <MarkDoneButton task={n} openSubtasks={openSubtasks} manager={Boolean(c?.manager)} parentPrompt={null} /> : null}
          <DM.Root>
            <DM.Trigger aria-label={`Actions for ${n.code}`} className="rounded p-1.5 text-ink-soft hover:bg-steel-wash hover:text-steel"><MoreHorizontal size={18} /></DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
                <MenuLink href={`${basePath}/${n.id}`}>Open task</MenuLink>
                {c?.isAssignee && !n.plan_submitted_at && !done ? <MenuItem onSelect={() => run(() => submitPlan(n.id, n.status))}>Submit plan</MenuItem> : null}
                {c && (c.manager || c.titleAndAssignee || c.priority || c.contribution) ? <MenuItem onSelect={() => onDialog({ kind: "edit", task: n })}>Edit</MenuItem> : null}
                {canAddSubtask ? <MenuItem onSelect={() => onDialog({ kind: "new", parent: n })}>Add subtask</MenuItem> : null}
                {n.children.filter((s) => caps[s.id] && (caps[s.id].manager || caps[s.id].titleAndAssignee || caps[s.id].priority || caps[s.id].contribution))
                  .map((s) => <MenuItem key={s.id} onSelect={() => onDialog({ kind: "edit", task: s })}>Edit subtask {letterOf(s.code)}.</MenuItem>)}
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

/** "a. Title" — plus owner (when not the task's owner), status and progress; the owner can change the status here. */
function SubtaskLine({ s, c, parentAssignee, basePath }: { s: TaskNode; c?: TaskCaps; parentAssignee: string; basePath: string }) {
  const { pending, run } = useAction();
  const done = s.status === "Completed";
  return (
    <li aria-busy={pending || undefined}>
      <Link href={`${basePath}/${s.id}`} className={cn("hover:text-steel hover:underline", done && "text-ink-soft line-through decoration-ink-faint")}>
        {letterOf(s.code)}. {s.title}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
        {s.assigned_to !== parentAssignee ? <span>{s.assignee_name}</span> : null}
        {c && !done && c.statuses.some((x) => x !== "Completed") ? (
          <select aria-label={`Status of ${s.code}`} value={s.status} disabled={pending} onChange={(e) => run(() => setStatus(s.id, e.target.value))}
            className="h-6 rounded border border-line bg-panel px-1 text-xs">
            <option>{s.status}</option>
            {c.statuses.filter((x) => x !== "Completed").map((x) => <option key={x}>{x}</option>)}
          </select>
        ) : <span>{s.status}</span>}
        <span>{pct(s.progress_pct)}</span>
      </div>
    </li>
  );
}
