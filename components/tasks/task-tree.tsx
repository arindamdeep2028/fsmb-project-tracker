"use client";
import { useState } from "react";
import Link from "next/link";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import type { TaskNode } from "@/types/domain";
import type { TaskCaps } from "@/lib/auth/capabilities";
import { deleteTask, setArchived, setProgress, setStatus, submitPlan } from "@/lib/actions/tasks";
import { deadlineSignal } from "@/lib/labels";
import { cn, pct } from "@/lib/utils";
import { useAction } from "@/components/toast";
import { Badge, Meter } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DeadlineChip, RedReasons } from "./deadline";
import { MarkDoneButton } from "./mark-done";
import { TaskDialog, type Assignee } from "./task-dialog";
import { ExtensionDialog } from "./extension-dialog";

type Props = {
  nodes: TaskNode[];
  caps: Record<string, TaskCaps>;
  projectId: string;
  meId: string;
  assignees: Assignee[];
  canCreate: boolean;
  managerView: boolean;
  basePath: string; // /projects/{id}/tasks
};

/** Responsibilities tree: parents with calculated progress, subtasks beneath, the signal rail on every row. */
export function TaskTree(props: Props) {
  const [dialog, setDialog] = useState<null | { kind: "new"; parent?: TaskNode } | { kind: "edit"; task: TaskNode } | { kind: "extend"; task: TaskNode }>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const managerCaps = { manager: true, titleAndAssignee: true, priority: true, contribution: true, deadline: true, lockContribution: true };
  const engineerCaps = { manager: false, titleAndAssignee: true, priority: true, contribution: true, deadline: false, lockContribution: false };

  return (
    <div>
      {props.canCreate ? (
        <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setDialog({ kind: "new" })}>New task</Button></div>
      ) : null}
      {props.nodes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-ink-soft">No tasks yet.{props.canCreate ? " Create the first one to start tracking responsibilities." : ""}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_9rem_10rem_8rem] gap-3 border-b border-line px-4 py-2 text-sm text-ink-soft lg:grid">
            <span>Task</span><span>Status</span><span>Progress</span><span>Deadline</span><span className="sr-only">Actions</span>
          </div>
          {props.nodes.map((n) => (
            <div key={n.id}>
              <Row {...props} node={n} parent={null} onDialog={setDialog}
                collapsed={collapsed[n.id]} onToggle={n.children.length ? () => setCollapsed((c) => ({ ...c, [n.id]: !c[n.id] })) : undefined} />
              {!collapsed[n.id] && n.children.map((c) => <Row key={c.id} {...props} node={c} parent={n} onDialog={setDialog} />)}
            </div>
          ))}
        </div>
      )}
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

function Row({ node: n, parent, caps, meId, basePath, onDialog, collapsed, onToggle, canCreate }: Props & {
  node: TaskNode; parent: TaskNode | null; collapsed?: boolean; onToggle?: () => void;
  onDialog: (d: { kind: "new"; parent?: TaskNode } | { kind: "edit"; task: TaskNode } | { kind: "extend"; task: TaskNode }) => void;
}) {
  const c = caps[n.id];
  const { pending, run } = useAction();
  const done = n.status === "Completed";
  const signal = done ? "done" : deadlineSignal(n.deadline_status, n.is_red);
  const openSubtasks = n.children.filter((x) => x.status !== "Completed").map((x) => ({ code: x.code, title: x.title }));
  const parentPrompt = parent && parent.status !== "Completed" && (parent.assigned_to === meId || c?.manager)
    && parent.children.every((x) => x.id === n.id || x.status === "Completed") ? { id: parent.id, code: parent.code, title: parent.title } : null;
  const canComplete = !done && (c?.manager || c?.isAssignee);
  const progress = n.is_leaf ? n.progress_pct : n.calculated_progress;

  return (
    <div className={cn("rail grid grid-cols-1 gap-2 border-b border-line-soft py-3 pl-5 pr-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_9.5rem_9rem_10rem_8rem] lg:items-center lg:gap-3",
      `rail-${signal}`, parent && "bg-paper/60 lg:pl-10", done && "text-ink-soft")} aria-busy={pending || undefined}>
      <div className="min-w-0">
        <div className="flex items-start gap-1.5">
          {onToggle ? (
            <button onClick={onToggle} aria-label={collapsed ? `Show subtasks of ${n.code}` : `Hide subtasks of ${n.code}`} className="mt-0.5 text-ink-faint hover:text-ink">
              <ChevronRight size={16} className={cn("transition-transform", !collapsed && "rotate-90")} />
            </button>
          ) : null}
          <div className="min-w-0">
            <Link href={`${basePath}/${n.id}`} className="font-medium hover:text-steel hover:underline">
              <span className="mr-1.5 text-ink-soft">{n.code}</span>{n.title}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
              <span>{n.assignee_name ?? "Unassigned"}</span>
              {n.priority !== "Normal" ? <Badge signal={n.priority === "Important" || n.priority === "High" ? "amber" : "neutral"}>{n.priority}</Badge> : null}
              <span>Share {pct(n.effective_weight, 0)}</span>
              {n.contribution_locked ? <span>Share locked</span> : null}
              {!n.plan_submitted_at && !done && n.status === "Not started" ? <span>Plan due</span> : null}
              {n.status === "Blocked" && n.blocker_note ? <span className="text-signal-red">Blocked: {n.blocker_note}</span> : null}
            </div>
            {n.is_red ? <div className="mt-1"><RedReasons reasons={n.reasons} /></div> : null}
          </div>
        </div>
      </div>

      <div>
        {c && c.statuses.filter((s) => s !== "Completed").length > 0 && !done ? (
          <select aria-label={`Status of ${n.code}`} value={n.status} disabled={pending}
            onChange={(e) => run(() => setStatus(n.id, e.target.value))}
            className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm">
            <option>{n.status}</option>
            {c.statuses.filter((s) => s !== "Completed").map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : <span className="text-sm">{n.status}</span>}
      </div>

      <div className="flex items-center gap-2">
        {c?.progress && !done ? (
          <ProgressInput value={n.progress_pct ?? 0} disabled={pending} onCommit={(v) => run(() => setProgress(n.id, v))} label={n.code} />
        ) : (
          <><Meter value={progress} className="w-20" label={`${n.code} progress`} /><span className="text-sm">{pct(progress)}</span></>
        )}
      </div>

      <div><DeadlineChip due={n.effective_due_at} status={n.deadline_status} isRed={n.is_red} /></div>

      <div className="flex items-center gap-2 lg:justify-end">
        {canComplete ? <MarkDoneButton task={n} openSubtasks={openSubtasks} manager={Boolean(c?.manager)} parentPrompt={parentPrompt} /> : null}
        <DM.Root>
          <DM.Trigger aria-label={`Actions for ${n.code}`} className="rounded p-1.5 text-ink-soft hover:bg-steel-wash hover:text-steel"><MoreHorizontal size={18} /></DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
              <MenuLink href={`${basePath}/${n.id}`}>Open task</MenuLink>
              {c?.isAssignee && !n.plan_submitted_at && !done ? <MenuItem onSelect={() => run(() => submitPlan(n.id, n.status))}>Submit plan</MenuItem> : null}
              {c && (c.manager || c.titleAndAssignee || c.priority || c.contribution) ? <MenuItem onSelect={() => onDialog({ kind: "edit", task: n })}>Edit</MenuItem> : null}
              {!parent && canCreate ? <MenuItem onSelect={() => onDialog({ kind: "new", parent: n })}>Add subtask</MenuItem> : null}
              {c?.deadline && !done ? <MenuItem onSelect={() => onDialog({ kind: "extend", task: n })}>Grant extension</MenuItem> : null}
              {c?.archive ? <MenuItem onSelect={() => run(() => setArchived(n.id, true))}>Archive</MenuItem> : null}
              {c?.remove ? (
                <MenuItem danger onSelect={() => { if (confirm(`Delete ${n.code}${n.children.length ? " and its subtasks" : ""}? This can't be undone.`)) run(() => deleteTask(n.id)); }}>Delete</MenuItem>
              ) : null}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
    </div>
  );
}

function ProgressInput({ value, onCommit, disabled, label }: { value: number; onCommit: (v: number) => void; disabled?: boolean; label: string }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== value) onCommit(n); else setV(String(value));
  };
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">Progress of {label}</span>
      <input type="number" min={0} max={100} step={5} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-8 w-16 rounded-md border border-line bg-panel px-2 text-right" />%
    </label>
  );
}

function MenuItem({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return <DM.Item onSelect={onSelect} className={cn("cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash", danger && "text-signal-red")}>{children}</DM.Item>;
}
function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <DM.Item asChild><Link href={href} className="block rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash">{children}</Link></DM.Item>;
}
