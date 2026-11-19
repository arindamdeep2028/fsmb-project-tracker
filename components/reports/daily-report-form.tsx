"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveReport } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/toast";
import { DailyHead, DayCells } from "@/components/reports/daily-log-table";
import { reportItemChange, stepChoices, taskSteps, type StepOption } from "@/lib/report-items";
import { StepNo } from "@/components/projects/project-chooser";
import { pct } from "@/lib/utils";
import { SHEET_STATUS, type DayRemark } from "@/lib/sheet";
import { parseHours } from "@/lib/hours";
import { RemarksCell } from "@/components/reports/sheet-cells";
import type { TaskStatus } from "@/lib/auth/capabilities";
import { PendingFiles, reach, withAdded, type PendingFile } from "@/components/reports/pending-files";
import { carryToReport, imagesFromPaste } from "@/components/reports/file-uploader";

/** One of my open tasks / subtasks: label "4. Task" (+ "a. Subtask"), the statuses I may move it to, and its task. */
export type MainTaskOption = StepOption;
type Existing = {
  update_text: string; issues: string | null; next_task_text: string | null; remarks: string | null;
  work_hours?: number | null;
  daily_report_items: { task_id: string | null; progress_after: number | null; status_after: string | null; work_hours?: number | null }[];
  /** files already attached (counted against the files-per-report limit) */
  daily_report_attachments?: unknown[];
} | null;

const schema = z.object({
  task_id: z.string(),
  update_text: z.string().trim().min(1, "Write the Task: what you did today").max(5000),
  status: z.string(),
  progress: z.string(),
  issues: z.string().max(3000),
  next_task_text: z.string().max(1000),
  hours: z.string().refine((v) => parseHours(v).ok, { message: "Working hours: a number above 0 and up to 24, such as 1.5 or 2.25" }),
});
type V = z.infer<typeof schema>;

/**
 * Today's row of the Daily Reports sheet for one project (one per person, project and day; editable until it locks).
 * The Main Task is one of my open tasks or subtasks; its Status (and progress) is applied to the task as me.
 * A task entry the update already has is kept on every save (also once the task is Completed); it is replaced
 * or removed only when I choose a different Main Task or clear it. The page keys this form by project.
 * Working Hours go on the Main Task (or on the update when no task is chosen). Remarks are the Admin's: shown here
 * read-only; whatever was saved before stays as it is.
 */
export function DailyReportForm({ projectId, date, dayNo, me, tasks, existing, maxFiles = 10, remarks = [] }: {
  projectId: string; date: string; dayNo: number | null; me: string; tasks: MainTaskOption[]; existing: Existing;
  /** the Admin's remarks to me for today (read-only) */
  remarks?: DayRemark[];
  /** files per report (workspace setting); photos and files can be added before a new update is submitted */
  maxFiles?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  // screenshots/photos for the task row itself (linked to the Main Task when saved; migration 25)
  const [taskPending, setTaskPending] = useState<PendingFile[]>([]);
  const savedFiles = existing?.daily_report_attachments?.length ?? 0;
  const prior = existing?.daily_report_items.find((i) => i.task_id && tasks.some((t) => t.id === i.task_id));
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      task_id: prior?.task_id ?? "", update_text: existing?.update_text ?? "",
      status: prior?.status_after ?? tasks.find((t) => t.id === prior?.task_id)?.status ?? "",
      progress: String(prior?.progress_after ?? tasks.find((t) => t.id === prior?.task_id)?.progress_pct ?? ""),
      issues: existing?.issues ?? "", next_task_text: existing?.next_task_text ?? "",
      hours: String(prior?.work_hours ?? existing?.work_hours ?? ""),
    },
  });
  const [taskId, setTaskId] = useState(f.getValues("task_id"));
  const [taskChanged, setTaskChanged] = useState(false);
  const task = tasks.find((t) => t.id === taskId);
  // step 2 (task) and step 3 (its subtask, or the task itself); the entry sent is the step 3 choice
  const groups = taskSteps(tasks);
  const [topId, setTopId] = useState(task?.top.id ?? "");
  const group = groups.find((g) => g.id === topId);
  const choices = stepChoices(group);
  const taskName = task ? (task.sub ? `${task.label} — ${task.sub}` : task.label) : "";
  const fileCount = pending.length + taskPending.length;

  /** Ctrl+V anywhere in the task row (while a Main Task is chosen) attaches the screenshot to that task row. */
  function pasteIntoRow(e: React.ClipboardEvent) {
    if (!task || f.formState.isSubmitting) return;
    const images = imagesFromPaste(e.nativeEvent);
    if (!images) return;
    e.preventDefault();                               // the page-wide paste handlers leave it alone
    // computed first, then set: a refusal message (toast) must not be raised from inside a React state update
    setTaskPending(withAdded(taskPending, images, { room: Math.max(0, maxFiles - savedFiles - pending.length - taskPending.length), maxFiles, pasted: true, others: pending, say: (message) => toast({ ok: false, message }) }));
  }

  function pickTask(id: string) {
    const t = tasks.find((x) => x.id === id);
    setTaskId(id);
    setTaskChanged(true);
    f.setValue("task_id", id);
    f.setValue("status", t?.status ?? "");
    f.setValue("progress", t ? String(t.progress_pct ?? 0) : "");
  }

  /** Step 2: a different task clears step 3 (or fills it when there is only one choice), so no entry of the
   *  previous task can be sent by mistake. */
  function pickTop(id: string) {
    setTopId(id);
    const next = stepChoices(groups.find((g) => g.id === id));
    pickTask(next.length === 1 ? next[0].option.id : "");
  }

  async function onSubmit(v: V) {
    const t = tasks.find((x) => x.id === taskId);
    const hours = parseHours(v.hours);
    const hoursValue = hours.ok ? hours.value : null;
    const change = reportItemChange({ priorTaskId: prior?.task_id ?? null, task: t, changed: taskChanged, status: v.status, progress: v.progress });
    const r = await reach(() => saveReport({
      project_id: projectId, update_text: v.update_text, issues: v.issues, next_task_id: null,
      next_task_text: v.next_task_text,
      // hours on the Main Task when one is chosen (and still open), otherwise on the update itself
      work_hours: change.items.length ? null : hoursValue,
      items: change.items.map((i) => ({ ...i, work_hours: hoursValue })),
      remove_task_ids: change.remove_task_ids,
    }));
    setResult(r);
    // nothing was uploaded before this point: if saving failed, the chosen files are still here, unstored
    if (r.ok && r.data) {
      toast({ ok: true, message: existing ? "Daily update saved" : "Daily update submitted" });
      carryToReport(r.data.id, pending);            // the report page attaches them (progress, Retry) to this report
      // the task row's files go to the Main Task saved with the update (none chosen: the whole report)
      carryToReport(r.data.id, taskPending.map((x) => ({ ...x, taskId: t?.id ?? null, taskLabel: t ? taskName : undefined })));
      setPending([]);
      setTaskPending([]);
      router.push(`/daily-reports/${r.data.id}`);
    }
  }

  const box = "w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm";
  const cell = "border border-line p-2 align-top";
  return (
    <form onSubmit={f.handleSubmit(onSubmit)} className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead><DailyHead /></thead>
          <tbody>
            <tr data-testid="task-row" onPaste={pasteIntoRow}>
              <DayCells date={date} dayNo={dayNo} />
              <td className={`${cell} min-w-80`}>
                <div className="space-y-2" data-testid="update-steps">
                  <label className="block text-xs font-semibold text-ink"><StepNo n={2} />Task
                    <select aria-label="Task" data-testid="step-task" className={`${box} mt-1 font-normal`} value={topId} onChange={(e) => pickTop(e.target.value)}>
                      <option value="">{groups.length ? "Choose the task you worked on" : "No task assigned to you yet"}</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-ink"><StepNo n={3} />Subtask
                    <select aria-label="Subtask" data-testid="step-subtask" className={`${box} mt-1 font-normal disabled:bg-paper disabled:text-ink-faint`}
                      value={taskId} disabled={!group} onChange={(e) => pickTask(e.target.value)}>
                      <option value="">{!group ? "Choose the task first" : "Choose the subtask"}</option>
                      {choices.map((c) => <option key={c.option.id} value={c.option.id}>{c.text}{c.option.done ? " (Completed)" : ""}</option>)}
                    </select>
                  </label>
                  {group ? (
                    <p data-testid="task-progress" className="text-[11px] text-ink-soft">
                      Task progress now: <strong className="text-ink">{pct(group.progress)}</strong>
                      {(group.own && !group.own.is_leaf) || group.subtasks.length ? " (calculated from its subtasks)" : ""}
                    </p>
                  ) : null}
                  <label className="block text-xs font-semibold text-ink"><StepNo n={4} />Work done today
                    <textarea aria-label="Daily Sub Task" rows={4} className={`${box} mt-1 font-normal`} placeholder={"a. …\nb. …"} {...f.register("update_text")} />
                  </label>
                  {f.formState.errors.update_text ? <p className="text-xs text-signal-red">{f.formState.errors.update_text.message}</p> : null}
                  {task && !task.done && task.is_leaf ? (
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-ink">Completion
                      <input type="number" min={0} max={100} step={5} aria-label="Progress %" data-testid="step-progress"
                        className="h-8 w-20 rounded border border-line bg-panel px-1.5 text-right text-sm font-normal" {...f.register("progress")} />%
                      <span className="font-normal text-ink-soft">of {task.sub ? "this subtask" : "this task"}</span>
                    </label>
                  ) : task && !task.done ? <p className="text-xs text-ink-soft">This task&apos;s progress is calculated from its subtasks; choose a subtask to enter a percentage.</p> : null}
                </div>
                {task || taskPending.length ? (
                  <>
                    <PendingFiles variant="task" task={taskName} files={taskPending} onChange={setTaskPending} maxFiles={maxFiles}
                      used={savedFiles + pending.length} others={pending} disabled={f.formState.isSubmitting} />
                    {!task && taskPending.length ? <p className="mt-1 text-xs text-signal-amber">No Main Task chosen: these will be attached to the whole update.</p> : null}
                  </>
                ) : null}
              </td>
              <td className={`${cell} whitespace-nowrap text-center align-middle`}>{me}</td>
              <td className={`${cell} w-24`}>
                <input type="text" inputMode="decimal" aria-label="Working Hours" placeholder="e.g. 1.5" className={`${box} text-center`} {...f.register("hours")} />
                <p className="mt-1 text-center text-[11px] text-ink-soft">{task ? "hours on this task" : "hours today"}</p>
                {f.formState.errors.hours ? <p className="mt-1 text-xs text-signal-red">{f.formState.errors.hours.message}</p> : null}
              </td>
              <td className={`${cell} w-40`}>
                {task?.done ? (
                  <p className="pt-1.5 text-center text-sm">Completed<span className="mt-1 block text-xs text-ink-soft">This task is done; its entry stays in the update.</span></p>
                ) : task ? (
                  <>
                    <select aria-label="Status" className={box} {...f.register("status")}>
                      {[task.status, ...task.choices.filter((s) => s !== task.status)].map((s) => <option key={s} value={s}>{SHEET_STATUS[s] ?? s}</option>)}
                    </select>
                    {task.is_leaf ? null : <p className="mt-1 text-xs text-ink-soft">Progress from subtasks</p>}
                  </>
                ) : (
                  // a status belongs to the Main Task: the field is shown from the start and opens once a task is chosen
                  <>
                    <select aria-label="Status" className={box} disabled value=""><option value="">{tasks.length ? "Choose task" : "No open task"}</option></select>
                    <p data-testid="status-hint" className="mt-1 text-xs text-ink-soft">{tasks.length ? "Choose the task and subtask first to set its status." : "No open task is assigned to you here."}</p>
                  </>
                )}
              </td>
              <td className={`${cell} min-w-28`}><textarea aria-label="Issues" rows={4} className={box} {...f.register("issues")} /></td>
              <td className={`${cell} min-w-36`}><textarea aria-label="Next Task" rows={4} className={box} {...f.register("next_task_text")} /></td>
              <td className={`${cell} text-center align-middle text-ink-soft`}>{savedFiles ? savedFiles : "-"}</td>
              <td className={`${cell} min-w-32 text-center align-middle`} data-testid="form-remarks">
                <RemarksCell remarks={[...remarks, ...(existing?.remarks ? [{ id: "legacy", date, recipientId: "", recipient: me, authorId: null, author: me, body: existing.remarks, createdAt: "", updatedAt: "", edited: false, legacy: true }] : [])]}
                  projectId={projectId} date={date} people={[]} isAdmin={false} label="today" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {existing ? null : (
        <section aria-label="Photos and files" className="space-y-2">
          <h3 className="text-sm font-semibold">Photos and files</h3>
          <PendingFiles files={pending} onChange={setPending} maxFiles={maxFiles} used={taskPending.length} others={taskPending} disabled={f.formState.isSubmitting} />
        </section>
      )}
      <FormMessage result={result && !result.ok ? result : null} />
      <Button type="submit" pending={f.formState.isSubmitting} data-testid="step-submit"><StepNo n={5} inverse />{`${existing ? "Save today's update" : "Submit daily update"}${fileCount ? ` with ${fileCount === 1 ? "1 file" : `${fileCount} files`}` : ""}`}</Button>
    </form>
  );
}
