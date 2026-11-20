import type { TaskStatus } from "@/lib/auth/capabilities";
import { parseHours, totalHours } from "@/lib/hours";
import type { StepOption } from "@/lib/report-items";
import { letterOf, taskLabel } from "@/lib/sheet";

/**
 * Several task entries in one daily report (migration 35). One report per person, project and day, as before;
 * each entry is one row of daily_report_items (one per task or subtask) carrying its own Work done, Issues, Next
 * Task, hours, status and completion. Status and completion are applied to the task by the database exactly as
 * before, so the weighted completion of tasks and projects is unchanged.
 *
 * "Other work (no task)" is the one entry without a task: it is stored on the report itself (update_text,
 * issues, next_task_text, work_hours), which is also where a report saved before migration 35 kept its text.
 * When there is no such entry, the report's own text holds a readable summary of the entries for the places
 * that show a report as one text (lists, dashboards); the sheet and the report page show the entries instead.
 */

/** The task choice "Other work (no task)". */
export const OTHER = "other";

/** One entry of the form while it is being written. Numbers are kept as typed. */
export type EntryDraft = {
  key: string;
  /** step 1: the task (a top-level task id), OTHER, or "" */
  topId: string;
  /** step 2: the task or subtask the entry is about (sent as the item's task), OTHER, or "" */
  taskId: string;
  hours: string;
  status: string;
  progress: string;
  work: string;
  issues: string;
  next: string;
  /**
   * shown but not sent: "done" — the task is Completed (its entry stays as saved); "unavailable" — the task is no
   * longer assigned to this person (reassigned or archived), so the report keeps the saved entry untouched
   */
  locked?: "done" | "unavailable";
  /** label of a locked entry whose task is not among the options */
  lockedLabel?: string;
};

/** A saved entry (daily_report_items row) with what is needed to show it again. */
export type SavedItem = {
  task_id: string; task_code: string; task_title: string;
  parent?: { code: string; title: string } | null;
  status_after: string | null; progress_after: number | null; work_hours: number | null;
  work_text?: string | null; issues?: string | null; next_task_text?: string | null;
  created_at?: string;
};
export type SavedReport = {
  update_text: string; issues: string | null; next_task_text: string | null; work_hours: number | null;
  items: SavedItem[];
};

const num = (n: number | null | undefined) => (n == null ? "" : String(Number(n)));

/** A report saved with the multi-entry form: at least one entry has its own work text. */
export const hasEntryTexts = (items: { work_text?: string | null }[]) => items.some((i) => Boolean(i.work_text));

/** The report's own text is an "Other work" entry: always for an older report, else only when it has its own hours. */
export const reportTextIsOwnEntry = (r: { work_hours: number | null }, items: { work_text?: string | null }[]) =>
  !hasEntryTexts(items) || r.work_hours != null;

/** "4. Task / b. Subtask" for an option; "4. Task" for a task without a chosen subtask. */
export function optionLabel(o: StepOption): string {
  return o.sub ? `${o.top.label} / ${o.sub}` : o.top.label;
}

/** The label of a saved item from its own snapshot (when its task is no longer offered). */
export function itemLabel(i: Pick<SavedItem, "task_code" | "task_title" | "parent">): string {
  return i.parent ? `${taskLabel(i.parent.code, i.parent.title)} / ${letterOf(i.task_code)}. ${i.task_title}` : taskLabel(i.task_code, i.task_title);
}

let seq = 0;
export const newKey = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankEntry(): EntryDraft {
  return { key: newKey(), topId: "", taskId: "", hours: "", status: "", progress: "", work: "", issues: "", next: "" };
}

/** The form's entries for a saved report (or one blank entry when there is none). */
export function entriesFromSaved(saved: SavedReport | null, options: StepOption[]): EntryDraft[] {
  if (!saved) return [blankEntry()];
  const items = [...saved.items].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const multi = hasEntryTexts(items);
  const out: EntryDraft[] = items.map((i, n) => {
    const o = options.find((x) => x.id === i.task_id);
    // a report saved before migration 35 kept one text for the whole report: it goes to its first task entry
    const legacyText = !multi && n === 0;
    return {
      key: newKey(),
      topId: o?.top.id ?? "", taskId: i.task_id,
      hours: num(i.work_hours),
      status: o?.done ? "Completed" : i.status_after ?? o?.status ?? "",
      progress: o?.done ? "100" : num(i.progress_after ?? o?.progress_pct),
      work: i.work_text ?? (legacyText ? saved.update_text : ""),
      issues: i.issues ?? (legacyText ? saved.issues ?? "" : ""),
      next: i.next_task_text ?? (legacyText ? saved.next_task_text ?? "" : ""),
      ...(o ? (o.done ? { locked: "done" as const } : {}) : { locked: "unavailable" as const, lockedLabel: itemLabel(i) }),
    };
  });
  const otherHasText = !items.length || multi;
  if (!items.length || saved.work_hours != null) {
    out.push({
      key: newKey(), topId: OTHER, taskId: OTHER, hours: num(saved.work_hours), status: "", progress: "",
      work: otherHasText ? saved.update_text : "", issues: otherHasText ? saved.issues ?? "" : "", next: otherHasText ? saved.next_task_text ?? "" : "",
    });
  }
  return out.length ? out : [blankEntry()];
}

export type EntryErrors = Partial<Record<"task" | "subtask" | "hours" | "status" | "progress" | "work" | "issues" | "next", string>>;

/** What is wrong with the entries, per entry key (only entries that are sent are checked), plus one form-level message. */
export function validateEntries(entries: EntryDraft[], options: StepOption[]): { ok: boolean; errors: Record<string, EntryErrors>; form: string | null } {
  const errors: Record<string, EntryErrors> = {};
  const seen = new Map<string, number>();
  let form: string | null = null;
  entries.forEach((e, n) => {
    const err: EntryErrors = {};
    const first = seen.get(e.taskId);
    if (e.taskId && first != null) err.subtask = e.taskId === OTHER ? `"Other work" is already entry ${first + 1}` : `Already in entry ${first + 1}: choose another task or subtask`;
    else if (e.taskId) seen.set(e.taskId, n);
    if (e.locked) { if (Object.keys(err).length) errors[e.key] = err; return; }
    if (!e.topId) err.task = "Choose the task";
    else if (!e.taskId) err.subtask = "Choose the subtask";
    const h = parseHours(e.hours);
    if (!h.ok) err.hours = h.message;
    else if (h.value == null) err.hours = "Enter the hours";
    if (!e.work.trim()) err.work = "Write the work done today";
    else if (e.work.length > 3000) err.work = "3000 characters at most";
    if (e.issues.length > 3000) err.issues = "3000 characters at most";
    if (e.next.length > 1000) err.next = "1000 characters at most";
    const o = options.find((x) => x.id === e.taskId);
    if (o && !o.done) {
      if (!e.status) err.status = "Choose the status";
      if (o.is_leaf && e.status !== "Completed") {
        const p = e.progress.trim() === "" ? NaN : Number(e.progress);
        if (!Number.isFinite(p) || p < 0 || p > 100) err.progress = "0 to 100";
      }
    }
    if (Object.keys(err).length) errors[e.key] = err;
  });
  const total = entriesTotalHours(entries);
  if (total != null && total > 24) form = `The working hours add up to ${total}; one daily report can have 24 at most.`;
  if (!entries.length) form = "Add at least one entry.";
  return { ok: !Object.keys(errors).length && !form, errors, form };
}

/** Total working hours of the entries (null when none is filled in). Unreadable numbers are left out. */
export function entriesTotalHours(entries: EntryDraft[]): number | null {
  return totalHours(entries.map((e) => { const h = parseHours(e.hours); return h.ok ? h.value : null; }));
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export type EntryItemInput = {
  task_id: string; status_after: TaskStatus; progress_after: number | null; work_hours: number | null;
  work_text: string; issues: string | null; next_task_text: string | null;
};
export type EntrySubmission = {
  update_text: string; issues: string | null; next_task_text: string | null; work_hours: number | null;
  items: EntryItemInput[]; remove_task_ids: string[];
};

/**
 * The save_daily_report payload for valid entries. `savedTaskIds`: the task entries the report has now; one the
 * user removed from the form is named for removal (and only then). Locked entries are neither sent nor removed.
 */
export function buildSubmission(entries: EntryDraft[], options: StepOption[], savedTaskIds: string[]): EntrySubmission {
  const hoursOf = (e: EntryDraft) => { const h = parseHours(e.hours); return h.ok ? h.value : null; };
  const labelOf = (e: EntryDraft) => e.lockedLabel ?? (e.taskId === OTHER ? "Other work" : (() => { const o = options.find((x) => x.id === e.taskId); return o ? optionLabel(o) : "Task"; })());
  const items: EntryItemInput[] = [];
  for (const e of entries) {
    const o = options.find((x) => x.id === e.taskId);
    if (e.locked || e.taskId === OTHER || !o || o.done) continue;
    const status = (o.choices.includes(e.status as TaskStatus) ? e.status : o.status) as TaskStatus;
    items.push({
      task_id: o.id, status_after: status,
      progress_after: o.is_leaf ? (status === "Completed" ? 100 : Math.max(0, Math.min(100, Number(e.progress)))) : null,
      work_hours: hoursOf(e), work_text: e.work.trim(), issues: e.issues.trim() || null, next_task_text: e.next.trim() || null,
    });
  }
  const kept = new Set(entries.map((e) => e.taskId));
  const remove_task_ids = savedTaskIds.filter((id) => !kept.has(id));
  const other = entries.find((e) => e.taskId === OTHER);
  if (other) {
    return { update_text: other.work.trim(), issues: other.issues.trim() || null, next_task_text: other.next.trim() || null, work_hours: hoursOf(other), items, remove_task_ids };
  }
  const lines = (pick: (e: EntryDraft) => string) => entries.filter((e) => pick(e).trim()).map((e) => `${labelOf(e)}: ${pick(e).trim()}`).join("\n");
  return {
    update_text: clip(lines((e) => e.work) || "Daily report", 5000),
    issues: clip(lines((e) => e.issues), 3000) || null,
    next_task_text: clip(lines((e) => e.next), 1000) || null,
    // sent as null: hours live on the entries; an "Other work" entry removed in this edit loses its hours too
    work_hours: null,
    items, remove_task_ids,
  };
}

/** How one task entry is shown in the Daily Reports sheet and the report page. */
export type EntryView = {
  label: string; sub: string | null; status: string | null; taskId: string;
  work: string | null; hours: number | null; progress: number | null;
};

/**
 * The sheet's view of a report: each entry with its own text, and the Issues / Next Task columns per entry
 * ("b. Subtask: …"). A report saved before migration 35 (no entry texts) is shown exactly as before.
 */
export function reportView(r: { update_text: string; issues: string | null; next_task_text: string | null; work_hours: number | null }, items: SavedItem[], nextTaskLabel?: string | null) {
  const sorted = [...items].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const multi = hasEntryTexts(sorted);
  const own = reportTextIsOwnEntry(r, sorted);
  const entries: EntryView[] = sorted.map((i) => ({
    ...(i.parent
      ? { label: taskLabel(i.parent.code, i.parent.title), sub: `${letterOf(i.task_code)}. ${i.task_title}` }
      : { label: taskLabel(i.task_code, i.task_title), sub: null }),
    status: i.status_after, taskId: i.task_id,
    work: multi ? i.work_text ?? null : null, hours: i.work_hours ?? null, progress: i.progress_after ?? null,
  }));
  if (!multi) {
    return { entries, multi, text: r.update_text, issues: r.issues ?? "", nextTask: nextTaskLabel ?? r.next_task_text ?? "" };
  }
  const name = (e: EntryView) => e.sub ?? e.label;
  const join = (pick: (i: SavedItem) => string | null | undefined, extra: string | null) => {
    const parts = sorted.map((i, n) => ({ t: pick(i)?.trim(), n })).filter((x) => x.t).map((x) => (sorted.length > 1 || own ? `${name(entries[x.n])}: ${x.t}` : x.t as string));
    if (own && extra?.trim()) parts.push(`Other work: ${extra.trim()}`);
    return parts.join("\n");
  };
  return {
    entries, multi,
    text: own ? r.update_text : "",
    issues: join((i) => i.issues, own ? r.issues : null),
    nextTask: join((i) => i.next_task_text, own ? (nextTaskLabel ?? r.next_task_text) : null),
  };
}
