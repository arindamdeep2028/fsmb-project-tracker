import type { TaskStatus } from "@/lib/auth/capabilities";

/**
 * What a daily report's editor sends for its Main Task. A report keeps the task entries it already has:
 * an entry is removed only when the user changed or cleared the Main Task themselves (`changed`), never
 * because the task is missing from the list (completed, reassigned or archived since) or the list was empty.
 */
export type ReportTaskOption = {
  id: string;
  status: TaskStatus;
  /** statuses the user may move it to */
  choices: TaskStatus[];
  is_leaf: boolean;
  /** already Completed: shown so the entry stays visible, but nothing more is applied to the task */
  done: boolean;
};
export type ReportItemInput = { task_id: string; status_after: TaskStatus; progress_after: number | null; note: null };

export function reportItemChange(o: {
  /** task of the entry the report already has, if any */
  priorTaskId: string | null;
  /** the Main Task now chosen (undefined: none, or not in the list) */
  task: ReportTaskOption | undefined;
  /** the user picked a different Main Task, or cleared it, in this edit */
  changed: boolean;
  status: string;
  progress: string;
}): { items: ReportItemInput[]; remove_task_ids: string[] } {
  const items: ReportItemInput[] = o.task && !o.task.done ? [{
    task_id: o.task.id,
    status_after: (o.task.choices.includes(o.status as TaskStatus) ? o.status : o.task.status) as TaskStatus,
    progress_after: o.task.is_leaf && o.progress !== "" && Number.isFinite(Number(o.progress)) ? Math.max(0, Math.min(100, Number(o.progress))) : null,
    note: null,
  }] : [];
  const remove_task_ids = o.changed && o.priorTaskId && o.priorTaskId !== (o.task?.id ?? null) ? [o.priorTaskId] : [];
  return { items, remove_task_ids };
}
