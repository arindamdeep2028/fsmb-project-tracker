"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { saveAnnouncement } from "@/lib/actions/announcements";
import { ANNOUNCEMENT_PRIORITIES, expiryDay, type Announcement, type AnnouncementPriority, type AnnouncementTargets } from "@/lib/announcements";
import { dhakaToday } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form";

type Kind = "general" | "project";
const flagColour: Record<AnnouncementPriority, string> = { Normal: "text-signal-green", Important: "text-signal-amber", Urgent: "text-signal-red" };

/**
 * Create / edit an announcement. Only the departments and projects this user may publish to are offered (the
 * database decides, and refuses anything else again on save). Editing keeps the original author and time.
 */
export function AnnouncementForm({ open, onOpenChange, targets, editing }: {
  open: boolean; onOpenChange: (v: boolean) => void; targets: AnnouncementTargets; editing?: Announcement | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const canGeneral = targets.departments.length > 0;
  const canProject = targets.projects.length > 0;

  const initial = React.useCallback(() => ({
    kind: (editing?.kind ?? (canGeneral ? "general" : "project")) as Kind,
    departments: editing?.department_ids ?? [],
    project: editing?.project_id ?? "",
    title: editing?.title ?? "",
    message: editing?.message ?? "",
    priority: (editing?.priority ?? "Normal") as AnnouncementPriority,
    pinned: editing?.pinned ?? false,
    hasExpiry: !!editing?.expires_at,
    expiresOn: expiryDay(editing?.expires_at ?? null) ?? "",
  }), [editing, canGeneral]);
  const [f, setF] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setF(initial()); setError(null); } }, [open, initial]);
  const set = <K extends keyof ReturnType<typeof initial>>(k: K, v: ReturnType<typeof initial>[K]) => setF((x) => ({ ...x, [k]: v }));

  // When editing, a target the editor could not choose themselves (e.g. a department outside their authority on an
  // Admin's announcement) is still shown, so nothing disappears silently.
  const deptOptions = React.useMemo(() => {
    const m = new Map(targets.departments.map((d) => [d.id, d.name]));
    editing?.department_ids.forEach((d, i) => { if (!m.has(d)) m.set(d, editing.department_names[i] ?? "Department"); });
    return [...m.entries()].map(([id, name]) => ({ id, name, allowed: targets.departments.some((t) => t.id === id) }));
  }, [targets.departments, editing]);
  const projectOptions = React.useMemo(() => {
    const xs = [...targets.projects];
    if (editing?.project_id && !xs.some((p) => p.id === editing.project_id)) xs.unshift({ id: editing.project_id, code: editing.project_code ?? "", name: editing.project_name ?? "Project" });
    return xs;
  }, [targets.projects, editing]);

  function toggleDept(id: string) {
    set("departments", f.departments.includes(id) ? f.departments.filter((d) => d !== id) : [...f.departments, id]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.kind === "general" && f.departments.length === 0) return setError("Choose at least one department.");
    if (f.kind === "project" && !f.project) return setError("Choose a project.");
    if (!f.title.trim()) return setError("Enter a title.");
    if (!f.message.trim()) return setError("Write the announcement details.");
    if (f.hasExpiry && !f.expiresOn) return setError("Choose the expiry date, or untick Set expiry date.");
    start(async () => {
      const r = await saveAnnouncement({
        id: editing?.id ?? null, kind: f.kind, project_id: f.kind === "project" ? f.project : null,
        department_ids: f.kind === "general" ? f.departments : [], title: f.title, message: f.message,
        priority: f.priority, pinned: f.pinned, expires_on: f.hasExpiry ? f.expiresOn : null,
      });
      if (!r.ok) { setError(r.message); return; }
      toast({ ok: true, message: r.message });
      onOpenChange(false);
      router.refresh();
    });
  }

  const radio = (k: Kind, label: string, hint: string, enabled: boolean) => (
    <label className={cn("flex cursor-pointer items-start gap-2.5", (!enabled || (editing && editing.kind !== k)) && "cursor-not-allowed opacity-50")}>
      <input type="radio" name="kind" value={k} checked={f.kind === k} disabled={!enabled || (!!editing && editing.kind !== k)}
        onChange={() => set("kind", k)} className="mt-1 size-4 accent-steel" />
      <span className="leading-tight"><span className="block font-medium">{label}</span><span className="text-xs text-ink-soft">{hint}</span></span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent persistent title={editing ? "Edit Announcement" : "Create Announcement"}
        description={editing ? `Published by ${editing.author_name ?? "a former user"}. The original author and time stay the same.` : undefined}
        className="max-w-3xl">
        <form onSubmit={submit} className="space-y-5" data-testid="announcement-form">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Announcement Type <span className="text-signal-red">*</span></legend>
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                {radio("general", "General Announcement", "(Department)", canGeneral)}
                {radio("project", "Project Announcement", "(Specific Project)", canProject || !!editing?.project_id)}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="ann-priority" className="block text-sm font-medium">Priority <span className="text-signal-red">*</span></label>
              <div className="relative">
                <Flag size={16} aria-hidden className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2", flagColour[f.priority])} fill="currentColor" />
                <Select id="ann-priority" value={f.priority} onChange={(e) => set("priority", e.target.value as AnnouncementPriority)} className="pl-9">
                  {ANNOUNCEMENT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <fieldset disabled={f.kind !== "general"} className={cn(f.kind !== "general" && "opacity-50")}>
              <legend className="mb-2 text-sm font-medium">Department (General Only) {f.kind === "general" ? <span className="text-signal-red">*</span> : null}</legend>
              <div className="flex flex-wrap gap-2" data-testid="ann-departments">
                {deptOptions.length ? deptOptions.map((d) => (
                  <label key={d.id} className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                    f.departments.includes(d.id) ? "border-steel bg-steel-wash" : "border-line bg-panel", d.allowed ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
                    <input type="checkbox" checked={f.departments.includes(d.id)} disabled={!d.allowed} onChange={() => toggleDept(d.id)} className="size-4 accent-steel" />
                    {d.name}
                  </label>
                )) : <p className="text-sm text-ink-soft">You can't publish department announcements.</p>}
              </div>
            </fieldset>
            <div className={cn("space-y-1.5", f.kind !== "project" && "opacity-50")}>
              <label htmlFor="ann-project" className="block text-sm font-medium">Project (Project Only) {f.kind === "project" ? <span className="text-signal-red">*</span> : null}</label>
              <Select id="ann-project" value={f.project} disabled={f.kind !== "project"} onChange={(e) => set("project", e.target.value)}>
                <option value="">Select a project</option>
                {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ann-title" className="block text-sm font-medium">Title <span className="text-signal-red">*</span></label>
            <Input id="ann-title" value={f.title} maxLength={200} placeholder="Enter announcement title" onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ann-message" className="block text-sm font-medium">Message <span className="text-signal-red">*</span></label>
            <Textarea id="ann-message" value={f.message} maxLength={5000} rows={5} placeholder="Write your announcement details…" onChange={(e) => set("message", e.target.value)} />
          </div>

          <div className="grid gap-5 border-t border-line-soft pt-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">Visibility / Audience</p>
              <p className="text-sm text-ink-soft">
                {f.kind === "general"
                  ? "Everyone whose department is selected. Admin sees every announcement."
                  : "Current members of the selected project only. Admin sees every announcement."}
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Important Options</p>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" checked={f.pinned} onChange={(e) => set("pinned", e.target.checked)} className="size-4 accent-steel" />
                Pin this announcement (show at top)
              </label>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" checked={f.hasExpiry} onChange={(e) => set("hasExpiry", e.target.checked)} className="size-4 accent-steel" />
                  Set expiry date
                </label>
                <Input type="date" aria-label="Expiry date" min={dhakaToday()} value={f.expiresOn} disabled={!f.hasExpiry}
                  onChange={(e) => set("expiresOn", e.target.value)} className="h-9 w-44" />
              </div>
              {f.hasExpiry ? <p className="text-xs text-ink-soft">Shown until the end of that day (Dhaka time), then kept under Expired.</p> : null}
            </div>
          </div>

          {error ? <p role="alert" className="rounded-md bg-signal-red/10 px-3 py-2 text-sm text-signal-red">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" pending={pending}>{editing ? "Save changes" : "Publish Announcement"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
