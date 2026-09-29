"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveReport } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/toast";

type Task = { id: string; code: string; title: string; parent_id: string | null; status: string; progress_pct: number | null; is_leaf: boolean };
type Existing = {
  update_text: string; issues: string | null; next_task_id: string | null; next_task_text: string | null; remarks: string | null;
  daily_report_items: { task_id: string | null; progress_after: number | null; status_after: string | null; note: string | null }[];
} | null;

const STATUSES = ["Not started", "Plan submitted", "In progress", "Blocked", "Completed"] as const;
const schema = z.object({
  update_text: z.string().trim().min(1, "Write what you did today").max(5000),
  issues: z.string().max(3000),
  next_task_id: z.string(),
  next_task_text: z.string().max(1000),
  remarks: z.string().max(3000),
  items: z.array(z.object({
    task_id: z.string(), include: z.boolean(), progress: z.string(), status: z.string(), note: z.string().max(3000),
  })),
});
type V = z.infer<typeof schema>;

/** One report per project per day. Ticked tasks get their progress and status updated as you (save_daily_report). */
export function DailyReportForm({ projectId, tasks, existing }: { projectId: string; tasks: Task[]; existing: Existing }) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const prior = new Map((existing?.daily_report_items ?? []).map((i) => [i.task_id, i]));
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      update_text: existing?.update_text ?? "", issues: existing?.issues ?? "", next_task_id: existing?.next_task_id ?? "",
      next_task_text: existing?.next_task_text ?? "", remarks: existing?.remarks ?? "",
      items: tasks.map((t) => {
        const p = prior.get(t.id);
        return { task_id: t.id, include: Boolean(p), progress: String(p?.progress_after ?? t.progress_pct ?? 0), status: p?.status_after ?? t.status, note: p?.note ?? "" };
      }),
    },
  });
  const { fields } = useFieldArray({ control: f.control, name: "items" });
  const watched = f.watch("items");

  async function onSubmit(v: V) {
    const r = await saveReport({
      project_id: projectId, update_text: v.update_text, issues: v.issues, next_task_id: v.next_task_id || null,
      next_task_text: v.next_task_text, remarks: v.remarks,
      items: v.items.filter((i) => i.include).map((i) => {
        const t = tasks.find((x) => x.id === i.task_id)!;
        return {
          task_id: i.task_id,
          progress_after: t.is_leaf ? Math.max(0, Math.min(100, Number(i.progress))) : null,
          status_after: i.status !== t.status ? (i.status as (typeof STATUSES)[number]) : null,
          note: i.note || null,
        };
      }),
    });
    setResult(r);
    if (r.ok && r.data) { toast({ ok: true, message: existing ? "Report updated" : "Report submitted" }); router.push(`/daily-reports/${r.data.id}`); }
  }

  return (
    <form onSubmit={f.handleSubmit(onSubmit)} className="space-y-6">
      <Field label="What did you do today?" htmlFor="r-update" error={f.formState.errors.update_text?.message}>
        <Textarea id="r-update" rows={5} {...f.register("update_text")} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Tasks you worked on</legend>
        {tasks.length === 0 ? <p className="text-sm text-ink-soft">You have no open tasks in this project.</p> : null}
        {fields.map((fl, idx) => {
          const t = tasks[idx];
          const on = watched[idx]?.include;
          return (
            <div key={fl.id} className="rounded-md border border-line bg-panel p-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" {...f.register(`items.${idx}.include`)} />
                <span className="text-[15px]"><span className="font-medium">{t.code}</span> {t.title}
                  <span className="ml-2 text-sm text-ink-soft">{t.status} · {t.is_leaf ? `${t.progress_pct ?? 0}%` : "calculated from subtasks"}</span></span>
              </label>
              {on ? (
                <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-[8rem_12rem_minmax(0,1fr)]">
                  <Field label="Progress now (%)" htmlFor={`p-${idx}`}>
                    <Input id={`p-${idx}`} type="number" min={0} max={100} step={5} disabled={!t.is_leaf} {...f.register(`items.${idx}.progress`)} />
                  </Field>
                  <Field label="Status" htmlFor={`s-${idx}`}>
                    <Select id={`s-${idx}`} {...f.register(`items.${idx}.status`)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
                  </Field>
                  <Field label="Note" htmlFor={`n-${idx}`}><Input id={`n-${idx}`} {...f.register(`items.${idx}.note`)} /></Field>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Issues or blockers" htmlFor="r-issues"><Textarea id="r-issues" rows={3} {...f.register("issues")} /></Field>
        <Field label="Remarks" htmlFor="r-remarks"><Textarea id="r-remarks" rows={3} {...f.register("remarks")} /></Field>
        <Field label="Next task" htmlFor="r-next">
          <Select id="r-next" {...f.register("next_task_id")}>
            <option value="">Not one of my tasks</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.code} {t.title}</option>)}
          </Select>
        </Field>
        <Field label="Next task (free text)" htmlFor="r-next-text"><Input id="r-next-text" {...f.register("next_task_text")} /></Field>
      </div>

      <FormMessage result={result && !result.ok ? result : null} />
      <div className="flex gap-2">
        <Button type="submit" pending={f.formState.isSubmitting}>{existing ? "Update today's report" : "Submit report"}</Button>
      </div>
    </form>
  );
}
