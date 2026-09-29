"use client";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { completeTask } from "@/lib/actions/tasks";
import { useToast } from "@/components/toast";

type Open = { code: string; title: string };

/**
 * Mark Done → Completed (v2 §8). If subtasks are still open the confirm lists them, and only a manager
 * can go ahead. After the last open subtask completes, the parent's assignee is asked to complete the parent.
 */
export function MarkDoneButton({ task, openSubtasks, manager, parentPrompt, size = "sm" }: {
  task: { id: string; code: string };
  openSubtasks: Open[];
  manager: boolean;
  parentPrompt?: { id: string; code: string; title: string } | null;
  size?: "sm" | "md";
}) {
  const [confirm, setConfirm] = useState(false);
  const [askParent, setAskParent] = useState(false);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const blocked = openSubtasks.length > 0 && !manager;

  async function run(id: string, then?: () => void) {
    setPending(true);
    const r = await completeTask(id);
    setPending(false);
    toast({ ok: r.ok, message: r.message });
    if (r.ok) then?.();
  }

  return (
    <>
      <Button size={size} variant="secondary" disabled={blocked} title={blocked ? "Complete the open subtasks first" : undefined}
        onClick={() => (openSubtasks.length ? setConfirm(true) : run(task.id, () => parentPrompt && setAskParent(true)))} pending={pending}>
        Mark Done
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={`Complete ${task.code} with open subtasks?`} description="These subtasks stay open. Only a PM, Department Head or Admin can do this.">
          <ul className="mb-4 space-y-1 text-sm">{openSubtasks.map((s) => <li key={s.code}><span className="font-medium">{s.code}</span> {s.title}</li>)}</ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep open</Button>
            <Button onClick={() => run(task.id, () => setConfirm(false))} pending={pending}>Complete {task.code}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {parentPrompt ? (
        <Dialog open={askParent} onOpenChange={setAskParent}>
          <DialogContent title={`All subtasks of ${parentPrompt.code} are done`} description={parentPrompt.title}>
            <p className="mb-4 text-sm text-ink-soft">Complete the parent task now? It won't complete on its own.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAskParent(false)}>Not yet</Button>
              <Button onClick={() => run(parentPrompt.id, () => setAskParent(false))} pending={pending}>Complete {parentPrompt.code}</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
