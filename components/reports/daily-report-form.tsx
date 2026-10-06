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
import type { TaskStatus } from "@/lib/auth/capabilities";

/** One of my open tasks / subtasks: label "4. Task" (+ "a. Subtask"), and the statuses I may move it to. */
export type MainTaskOption = { id: string; label: string; sub: string | null; status: TaskStatus; choices: TaskStatus[]; is_leaf: boolean; progress_pct: number | null };
type Existing = {
  update_text: string; issues: string | null; next_task_text: string | null; remarks: string | null;
  daily_report_items: { task_id: string | null; progress_after: number | null; status_after: string | null }[];
} | null;

const schema = z.object({
  task_id: z.string(),
  update_text: z.string().trim().min(1, "Write the Task: what you did today").max(5000),
  status: z.string(),
  progress: z.string(),
  issues: z.string().max(3000),
  next_task_text: z.string().max(1000),
  remarks: z.string().max(3000),
});
type V = z.infer<typeof schema>;

/**
 * Today's row of the Daily Reports sheet for one project (one per person, project and day; editable until it locks).
 * The Main Task is one of my open tasks or subtasks; its Status (and progress) is applied to the task as me.
 */
export function DailyReportForm({ projectId, date, dayNo, me, tasks, existing }: {
  projectId: string; date: string; dayNo: number | null; me: string; tasks: MainTaskOption[]; existing: Existing;
}) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const prior = existing?.daily_report_items.find((i) => i.task_id && tasks.some((t) => t.id === i.task_id));
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      task_id: prior?.task_id ?? "", update_text: existing?.update_text ?? "",
      status: prior?.status_after ?? tasks.find((t) => t.id === prior?.task_id)?.status ?? "",
      progress: String(prior?.progress_after ?? tasks.find((t) => t.id === prior?.task_id)?.progress_pct ?? ""),
      issues: existing?.issues ?? "", next_task_text: existing?.next_task_text ?? "", remarks: existing?.remarks ?? "",
    },
  });
  const [taskId, setTaskId] = useState(f.getValues("task_id"));
  const task = tasks.find((t) => t.id === taskId);

  function pickTask(id: string) {
    const t = tasks.find((x) => x.id === id);
    setTaskId(id);
    f.setValue("task_id", id);
    f.setValue("status", t?.status ?? "");
    f.setValue("progress", t ? String(t.progress_pct ?? 0) : "");
  }

  async function onSubmit(v: V) {
    const t = tasks.find((x) => x.id === taskId);
    const r = await saveReport({
      project_id: projectId, update_text: v.update_text, issues: v.issues, next_task_id: null,
      next_task_text: v.next_task_text, remarks: v.remarks,
      items: t ? [{
        task_id: t.id,
        status_after: (t.choices.includes(v.status as TaskStatus) ? v.status : t.status) as TaskStatus,
        progress_after: t.is_leaf && v.progress !== "" ? Math.max(0, Math.min(100, Number(v.progress))) : null,
        note: null,
      }] : [],
    });
    setResult(r);
    if (r.ok && r.data) { toast({ ok: true, message: existing ? "Daily update saved" : "Daily update submitted" }); router.push(`/daily-reports/${r.data.id}`); }
  }

  const box = "w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm";
  const cell = "border border-line p-2 align-top";
  return (
    <form onSubmit={f.handleSubmit(onSubmit)} className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead><DailyHead /></thead>
          <tbody>
            <tr>
              <DayCells date={date} dayNo={dayNo} />
              <td className={`${cell} min-w-72`}>
                <select aria-label="Main Task" className={box} value={taskId} onChange={(e) => pickTask(e.target.value)}>
                  <option value="">{tasks.length ? "Choose your task" : "No task assigned to you yet"}</option>
                  {tasks.map((t) => <option key={t.id} value={t.id}>{t.sub ? `${t.label} — ${t.sub}` : t.label}</option>)}
                </select>
                {task?.sub ? <p className="mt-1 text-xs text-ink-soft">Subtask {task.sub}</p> : null}
                <textarea aria-label="Daily Sub Task" rows={4} className={`${box} mt-1.5`} placeholder={"Work done today\na. …\nb. …"} {...f.register("update_text")} />
                {f.formState.errors.update_text ? <p className="mt-1 text-xs text-signal-red">{f.formState.errors.update_text.message}</p> : null}
              </td>
              <td className={`${cell} whitespace-nowrap text-center align-middle`}>{me}</td>
              <td className={`${cell} w-40`}>
                {task ? (
                  <>
                    <select aria-label="Status" className={box} {...f.register("status")}>
                      {[task.status, ...task.choices.filter((s) => s !== task.status)].map((s) => <option key={s}>{s}</option>)}
                    </select>
                    {task.is_leaf ? (
                      <label className="mt-1.5 flex items-center gap-1 text-xs text-ink-soft">Progress
                        <input type="number" min={0} max={100} step={5} aria-label="Progress %" className="h-7 w-16 rounded border border-line bg-panel px-1 text-right text-sm" {...f.register("progress")} />%
                      </label>
                    ) : <p className="mt-1 text-xs text-ink-soft">Progress from subtasks</p>}
                  </>
                ) : <span className="block pt-1.5 text-center text-ink-faint">—</span>}
              </td>
              <td className={`${cell} min-w-28`}><textarea aria-label="Issues" rows={4} className={box} {...f.register("issues")} /></td>
              <td className={`${cell} min-w-36`}><textarea aria-label="Next Task" rows={4} className={box} {...f.register("next_task_text")} /></td>
              <td className={`${cell} min-w-36`}><textarea aria-label="Remarks" rows={4} className={box} {...f.register("remarks")} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <FormMessage result={result && !result.ok ? result : null} />
      <Button type="submit" pending={f.formState.isSubmitting}>{existing ? "Save today's update" : "Submit daily update"}</Button>
    </form>
  );
}
