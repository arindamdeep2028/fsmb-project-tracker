"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTask, setArchived, setDeadline, submitPlan } from "@/lib/actions/tasks";
import type { TaskCaps } from "@/lib/auth/capabilities";
import { toLocalInput } from "@/lib/time";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { MarkDoneButton } from "./mark-done";
import { TaskDialog, type Assignee, type EditableTask } from "./task-dialog";
import { ExtensionDialog } from "./extension-dialog";

export function TaskDetailActions({ task, caps, openSubtasks, parentPrompt, assignees, meId, projectId, isParent }: {
  task: EditableTask & { code: string; status: string; plan_submitted_at: string | null; effective_due_at: string | null; archived: boolean };
  caps: TaskCaps; openSubtasks: { code: string; title: string }[]; parentPrompt: { id: string; code: string; title: string } | null;
  assignees: Assignee[]; meId: string; projectId: string; isParent: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [extend, setExtend] = useState(false);
  const [due, setDue] = useState(toLocalInput(task.planned_due_at));
  const { pending, run } = useAction();
  const router = useRouter();
  const done = task.status === "Completed";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!done && (caps.manager || caps.isAssignee) ? <MarkDoneButton task={task} openSubtasks={openSubtasks} manager={caps.manager} parentPrompt={parentPrompt} size="md" /> : null}
        {caps.isAssignee && !task.plan_submitted_at && !done ? <Button variant="secondary" pending={pending} onClick={() => run(() => submitPlan(task.id, task.status))}>Submit plan</Button> : null}
        {caps.manager || caps.titleAndAssignee || caps.priority || caps.contribution ? <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button> : null}
        {caps.deadline && !done ? <Button variant="secondary" onClick={() => setExtend(true)}>Grant extension</Button> : null}
        {caps.archive ? <Button variant="ghost" pending={pending} onClick={() => run(() => setArchived(task.id, !task.archived))}>{task.archived ? "Restore" : "Archive"}</Button> : null}
        {caps.remove ? (
          <Button variant="danger" pending={pending} onClick={() => confirm(`Delete ${task.code}${isParent ? " and its subtasks" : ""}? This can't be undone.`)
            && run(() => deleteTask(task.id), () => router.push(`/projects/${projectId}/tasks`))}>Delete</Button>
        ) : null}
      </div>
      {caps.deadline && !done ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setDeadline(task.id, due || null)); }}>
          <label className="text-sm">Set deadline (Dhaka time)<Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 w-60" /></label>
          <Button type="submit" variant="secondary" size="sm" pending={pending}>{due ? "Save deadline" : "Use rule deadline"}</Button>
        </form>
      ) : null}
      {edit ? <TaskDialog open onOpenChange={setEdit} projectId={projectId} task={task} caps={caps} assignees={assignees} meId={meId} /> : null}
      {extend ? <ExtensionDialog open onOpenChange={setExtend} task={task} /> : null}
    </div>
  );
}
