"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, FormMessage } from "@/components/ui/form";
import { createTask, updateTask } from "@/lib/actions/tasks";
import { PRIORITIES } from "@/lib/labels";
import { toLocalInput } from "@/lib/time";
import type { TaskCaps } from "@/lib/auth/capabilities";
import { useToast } from "@/components/toast";

const formSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: z.string().max(5000),
  priority: z.enum(["Important", "High", "Normal", "Low"]),
  assigned_to: z.string().min(1, "Choose who owns it"),
  contribution: z.string().refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 100), "0 to 100, or leave empty for an equal share"),
  planned_due_local: z.string(),
  contribution_locked: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

export type Assignee = { user_id: string; full_name: string };
export type EditableTask = {
  id: string; title: string; description: string | null; priority: FormValues["priority"]; assigned_to: string;
  contribution_pct: number | null; planned_due_at: string | null; contribution_locked: boolean;
};

/**
 * New / edit task or subtask. Engineers get no deadline field and only engineer members as assignees;
 * managers also set the deadline (approved decision) and can lock contribution.
 */
export function TaskDialog({ open, onOpenChange, projectId, parent, task, caps, assignees, meId }: {
  open: boolean; onOpenChange: (o: boolean) => void; projectId: string; parent?: { id: string; code: string } | null;
  task?: EditableTask | null; caps: Pick<TaskCaps, "manager" | "titleAndAssignee" | "priority" | "contribution" | "deadline" | "lockContribution">;
  assignees: Assignee[]; meId: string;
}) {
  const toast = useToast();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const creating = !task;
  const f = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: {
      title: task?.title ?? "", description: task?.description ?? "", priority: task?.priority ?? "Normal",
      assigned_to: task?.assigned_to ?? meId, contribution: task?.contribution_pct == null ? "" : String(task.contribution_pct),
      planned_due_local: toLocalInput(task?.planned_due_at), contribution_locked: task?.contribution_locked ?? false,
    },
  });
  const canTitle = creating || caps.titleAndAssignee;
  const options = assignees.some((a) => a.user_id === meId) ? assignees : [{ user_id: meId, full_name: "Me" }, ...assignees];

  async function onSubmit(v: FormValues) {
    const contribution = v.contribution === "" ? null : Number(v.contribution);
    let r;
    if (creating) {
      r = await createTask({
        project_id: projectId, parent_id: parent?.id ?? null, title: v.title, description: v.description,
        priority: v.priority, assigned_to: v.assigned_to, contribution_pct: contribution,
        ...(caps.deadline && v.planned_due_local ? { planned_due_local: v.planned_due_local } : {}),
        ...(caps.lockContribution ? { contribution_locked: v.contribution_locked } : {}),
      });
    } else {
      const d = f.formState.dirtyFields;
      r = await updateTask(task!.id, {
        ...(d.title ? { title: v.title } : {}), ...(d.description ? { description: v.description } : {}),
        ...(d.priority ? { priority: v.priority } : {}), ...(d.assigned_to ? { assigned_to: v.assigned_to } : {}),
        ...(d.contribution ? { contribution_pct: contribution } : {}),
        ...(d.planned_due_local ? { planned_due_local: v.planned_due_local } : {}),
        ...(d.contribution_locked ? { contribution_locked: v.contribution_locked } : {}),
      });
    }
    setResult(r);
    if (r.ok) { toast({ ok: true, message: r.message }); onOpenChange(false); setResult(null); }
  }

  const e = f.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={creating ? (parent ? `New subtask under ${parent.code}` : "New task") : "Edit task"}
        description={creating && !caps.manager ? "It goes live as soon as you save. Assign it to yourself or an engineer on this project." : undefined}>
        <form onSubmit={f.handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" htmlFor="t-title" error={e.title?.message}>
            <Input id="t-title" {...f.register("title")} disabled={!canTitle} />
          </Field>
          <Field label="Description" htmlFor="t-desc" hint="Optional: scope, acceptance, links.">
            <Textarea id="t-desc" rows={3} {...f.register("description")} disabled={!canTitle} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" htmlFor="t-owner" error={e.assigned_to?.message}>
              <Select id="t-owner" {...f.register("assigned_to")} disabled={!canTitle}>
                {options.map((a) => <option key={a.user_id} value={a.user_id}>{a.user_id === meId ? `${a.full_name} (me)` : a.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="t-priority">
              <Select id="t-priority" {...f.register("priority")} disabled={!creating && !caps.priority}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label={parent ? "Share of the parent task (%)" : "Share of the project (%)"} htmlFor="t-contrib" error={e.contribution?.message} hint="Empty = equal share of what's left.">
              <Input id="t-contrib" inputMode="decimal" {...f.register("contribution")} disabled={!creating && !caps.contribution} />
            </Field>
            {caps.deadline ? (
              <Field label="Deadline (Dhaka time)" htmlFor="t-due" hint="Empty = the office-hours rule deadline.">
                <Input id="t-due" type="datetime-local" {...f.register("planned_due_local")} />
              </Field>
            ) : null}
          </div>
          {caps.lockContribution ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register("contribution_locked")} /> Lock the share so engineers can't change it</label>
          ) : null}
          <FormMessage result={result && !result.ok ? result : null} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" pending={f.formState.isSubmitting}>{creating ? "Create task" : "Save changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
