"use client";
import { useState } from "react";
import { updateSettings } from "@/lib/actions/admin";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type { Tables } from "@/types/database";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

/** Workspace rules. Saving recalculates every open task's stored deadlines (database trigger). */
export function RulesForm({ settings }: { settings: Tables<"workspace_settings"> }) {
  const [v, setV] = useState({
    office_start: settings.office_start, office_end: settings.office_end, plan_hours: settings.plan_hours, exec_days: settings.exec_days,
    workdays: [...settings.workdays], deadline_warning_hours: settings.deadline_warning_hours, review_window_days: settings.review_window_days,
    score_weight_on_time: Number(settings.score_weight_on_time), notification_retention_days: settings.notification_retention_days,
    attachment_max_files: settings.attachment_max_files, digest_email: settings.digest_email ?? "",
  });
  const { pending, run } = useAction();
  const num = (k: keyof typeof v) => ({ value: String(v[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) }) });
  const isStandardWeek = v.workdays.slice().sort().join() === "1,2,3,4,5";
  return (
    <form className="max-w-3xl space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => updateSettings(v)); }}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(([d, label]) => (
            <label key={d} className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-sm">
              <input type="checkbox" checked={v.workdays.includes(d)} onChange={(e) => setV({ ...v, workdays: e.target.checked ? [...v.workdays, d].sort() : v.workdays.filter((x) => x !== d) })} />{label}
            </label>
          ))}
        </div>
        <p className="text-sm text-ink-soft">{isStandardWeek ? "FSMB standard: Monday to Friday. Saturday and Sunday are non-working." : "This differs from the FSMB standard week (Monday to Friday)."}{" "}
          {!isStandardWeek ? <button type="button" className="text-steel hover:underline" onClick={() => setV({ ...v, workdays: [1, 2, 3, 4, 5] })}>Reset to Monday–Friday</button> : null}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Office opens (hour)" htmlFor="s-start"><Input id="s-start" type="number" min={0} max={23} {...num("office_start")} /></Field>
        <Field label="Office closes (hour)" htmlFor="s-end"><Input id="s-end" type="number" min={1} max={24} {...num("office_end")} /></Field>
        <Field label="Plan due within (office hours)" htmlFor="s-plan"><Input id="s-plan" type="number" min={1} max={24} {...num("plan_hours")} /></Field>
        <Field label="Execution within (working days)" htmlFor="s-exec"><Input id="s-exec" type="number" min={1} max={10} {...num("exec_days")} /></Field>
        <Field label="Deadline warning (hours before)" htmlFor="s-warn"><Input id="s-warn" type="number" min={1} max={48} {...num("deadline_warning_hours")} /></Field>
        <Field label="Review window (days)" htmlFor="s-window"><Input id="s-window" type="number" min={7} max={730} {...num("review_window_days")} /></Field>
        <Field label="Score weight: on time (0–1)" htmlFor="s-weight" hint={`Clean days weight: ${(1 - v.score_weight_on_time).toFixed(2)}`}><Input id="s-weight" type="number" step={0.05} min={0} max={1} {...num("score_weight_on_time")} /></Field>
        <Field label="Keep notifications (days)" htmlFor="s-ret"><Input id="s-ret" type="number" min={7} max={730} {...num("notification_retention_days")} /></Field>
        <Field label="Files per report" htmlFor="s-files"><Input id="s-files" type="number" min={1} max={50} {...num("attachment_max_files")} /></Field>
      </div>
      <Field label="Red-mark digest email" htmlFor="s-digest" hint="Daily summary of red marks; leave empty to turn off.">
        <Input id="s-digest" type="email" value={v.digest_email} onChange={(e) => setV({ ...v, digest_email: e.target.value })} className="max-w-sm" />
      </Field>
      <Button type="submit" pending={pending}>Save rules</Button>
    </form>
  );
}
