"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProject, updateProject } from "@/lib/actions/projects";
import { PROJECT_STATUSES } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/toast";

const schema = z.object({
  code: z.string().trim().min(1, "Add a project code").max(20),
  name: z.string().trim().min(1, "Add a project name").max(200),
  description: z.string().max(5000),
  department_id: z.string().min(1, "Choose a department"),
  pm_id: z.string(),
  status: z.enum(["Active", "On hold", "Completed", "Cancelled"]),
  start_date: z.string(),
  target_end: z.string(),
  notes: z.string().max(5000),
});
type V = z.infer<typeof schema>;
type Project = Partial<{ id: string; code: string; name: string; description: string | null; department_id: string; pm_id: string | null; status: V["status"]; start_date: string | null; target_end: string | null; notes: string | null }>;

/** New project (Department Head, Admin) and project details. Structural fields are editable by Department Head / Admin only. */
export function ProjectForm({ project, departments, pms, canEditStructure }: {
  project?: Project; departments: { id: string; name: string }[]; pms: { id: string; full_name: string }[]; canEditStructure: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: project?.code ?? "", name: project?.name ?? "", description: project?.description ?? "",
      department_id: project?.department_id ?? departments[0]?.id ?? "", pm_id: project?.pm_id ?? "",
      status: project?.status ?? "Active", start_date: project?.start_date ?? "", target_end: project?.target_end ?? "", notes: project?.notes ?? "",
    },
  });
  const e = f.formState.errors;
  async function onSubmit(v: V) {
    const payload = { ...v, pm_id: v.pm_id || null };
    if (project?.id) {
      const d = f.formState.dirtyFields;
      const patch = Object.fromEntries(Object.entries(payload).filter(([k]) => d[k as keyof V]));
      const r = await updateProject(project.id, patch);
      setResult(r); toast(r);
      if (r.ok) router.refresh();
    } else {
      const r = await createProject(payload);
      setResult(r);
      if (r.ok && r.data) { toast(r); router.push(`/projects/${r.data.id}`); }
    }
  }
  return (
    <form onSubmit={f.handleSubmit(onSubmit)} className="max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Code" htmlFor="p-code" error={e.code?.message} hint="For example P07"><Input id="p-code" {...f.register("code")} disabled={!canEditStructure} /></Field>
        <Field label="Name" htmlFor="p-name" error={e.name?.message}><Input id="p-name" {...f.register("name")} /></Field>
      </div>
      <Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" rows={3} {...f.register("description")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department" htmlFor="p-dept" error={e.department_id?.message}>
          <Select id="p-dept" {...f.register("department_id")} disabled={!canEditStructure}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
        <Field label="Lead PM" htmlFor="p-pm" hint="Added to the project as PM automatically.">
          <Select id="p-pm" {...f.register("pm_id")} disabled={!canEditStructure}><option value="">None yet</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select>
        </Field>
        <Field label="Status" htmlFor="p-status"><Select id="p-status" {...f.register("status")}>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" htmlFor="p-start"><Input id="p-start" type="date" {...f.register("start_date")} /></Field>
          <Field label="Target end" htmlFor="p-end"><Input id="p-end" type="date" {...f.register("target_end")} /></Field>
        </div>
      </div>
      <Field label="Notes" htmlFor="p-notes"><Textarea id="p-notes" rows={3} {...f.register("notes")} /></Field>
      <FormMessage result={result && !result.ok ? result : null} />
      <Button type="submit" pending={f.formState.isSubmitting}>{project?.id ? "Save project" : "Create project"}</Button>
    </form>
  );
}
