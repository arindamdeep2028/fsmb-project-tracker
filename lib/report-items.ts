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

/**
 * One choosable entry of the daily update: a task or a subtask of mine. `top`: the task it belongs to (itself for
 * a task), whose progress Responsibilities shows (a task with subtasks: the weighted roll-up of its subtasks).
 */
export type StepOption = ReportTaskOption & {
  label: string; sub: string | null; progress_pct: number | null;
  top: { id: string; label: string; progress: number | null };
};
/** Step 2 of the daily update: a task, with the step 3 choices under it. */
export type StepTask<T extends StepOption = StepOption> = {
  id: string; label: string; progress: number | null;
  /** the task itself, when it is mine */
  own: T | null;
  /** my subtasks of it */
  subtasks: T[];
};
/** A step 3 choice: a subtask, or the task itself ("no subtask"). */
export type StepChoice<T extends StepOption = StepOption> = { option: T; text: string; whole: boolean };

/** Groups my tasks and subtasks of one project by task, in the order given (the code order). */
export function taskSteps<T extends StepOption>(options: T[]): StepTask<T>[] {
  const out = new Map<string, StepTask<T>>();
  for (const o of options) {
    const g = out.get(o.top.id) ?? { id: o.top.id, label: o.top.label, progress: o.top.progress, own: null, subtasks: [] };
    if (o.id === o.top.id) g.own = o; else g.subtasks.push(o);
    out.set(o.top.id, g);
  }
  return [...out.values()];
}

/**
 * Step 3 choices of a task: each of my subtasks, then the task itself when it is mine — "No subtask" for a task
 * without subtasks (its progress is entered directly), "The whole task" for one with subtasks (status only: its
 * progress is calculated from its subtasks).
 */
export function stepChoices<T extends StepOption>(task: StepTask<T> | undefined): StepChoice<T>[] {
  if (!task) return [];
  const subs = task.subtasks.map((s) => ({ option: s, text: s.sub ?? s.label, whole: false }));
  const own = task.own
    ? [{ option: task.own, whole: true, text: task.own.is_leaf ? "No subtask: update the task itself" : "The whole task (status only; progress comes from its subtasks)" }]
    : [];
  return [...subs, ...own];
}

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
