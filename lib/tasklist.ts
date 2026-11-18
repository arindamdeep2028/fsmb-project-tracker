import { letterOf, slOf } from "@/lib/sheet";

/**
 * The project Tasklist (the team's Google Sheets layout): phase headings, then the tasks under each, with
 * Assigned Person (several people per task), Status, Comments and Priority. Built from the project's real tasks:
 * a top-level task that has subtasks is a phase heading and its subtasks are the rows under it; a top-level task
 * without subtasks is a row of its own (under "General tasks" when the list also has phases). Code order. Rows added on
 * the Tasklist (migration 28) follow the tasks of their phase.
 */
export type TasklistTask = {
  id: string; code: string; title: string; parent_id: string | null; status: string; priority: string;
  assigned_to: string; assignee_name: string | null; created_by: string; contribution_locked: boolean;
  is_leaf: boolean; children: TasklistTask[];
};

/** A row added on the Tasklist itself (migration 28): a sheet row, not a task (no code, owner or deadline). */
export type SheetRow = {
  id: string; phaseId: string | null; position: number; title: string; status: string; priority: string; comment: string;
  category: Category;
};

/**
 * The Tasklist's four statuses, in this order: Pending, On-Going, Halted, Done. Display words only: the stored task
 * status is unchanged (Blocked is shown as Halted here; the rest of the app keeps its own words).
 */
export const TASKLIST_STATUSES = ["Not started", "In progress", "Blocked", "Completed"] as const;
const TASKLIST_STATUS_LABEL: Record<string, string> = {
  "Not started": "Pending", "In progress": "On-Going", Blocked: "Halted", Completed: "Done", "Plan submitted": "Plan submitted",
};
export const tasklistStatus = (s: string | null | undefined) => (s ? TASKLIST_STATUS_LABEL[s] ?? s : "");

/** A Tasklist line's category, separate from Priority; a line without one is a General Task. */
export const CATEGORIES = ["General", "Urgent"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryLabel = (c: string) => `${c} Task`;
/** [background, text] */
export const CATEGORY_TONE: Record<string, [string, string]> = { General: ["#e7ece8", "#34483c"], Urgent: ["#b3261e", "#ffffff"] };

export type TasklistRow =
  | { kind: "phase"; key: string; label: string; taskId: string | null; count: number }
  | { kind: "task"; key: string; no: string; task: TasklistTask }
  | { kind: "row"; key: string; row: SheetRow };

export const GENERAL_PHASE = "General tasks";

/**
 * The Tasklist's lines. `sheet`: rows added on the Tasklist; each goes at the end of its phase (in the order added),
 * or under General tasks when it has no phase or its phase is not a heading (any more).
 */
export function tasklistRows(roots: TasklistTask[], sheet: SheetRow[] = []): TasklistRow[] {
  const sorted = [...roots].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const heads = new Set(sorted.filter((t) => t.children.length > 0).map((t) => t.id));
  const hasPhases = heads.size > 0;
  const rows = [...sheet].sort((a, b) => a.position - b.position);
  const underPhase = (id: string) => rows.filter((r) => r.phaseId === id);
  const general = rows.filter((r) => !r.phaseId || !heads.has(r.phaseId));
  const asRow = (r: SheetRow): TasklistRow => ({ kind: "row", key: `row-${r.id}`, row: r });

  const out: TasklistRow[] = [];
  let open = false;              // a "General tasks" heading is open for the current run of single tasks
  for (const t of sorted) {
    if (t.children.length) {
      open = false;
      const extra = underPhase(t.id);
      out.push({ kind: "phase", key: `phase-${t.id}`, label: t.title, taskId: t.id, count: t.children.length + extra.length });
      const kids = [...t.children].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      for (const c of kids) out.push({ kind: "task", key: c.id, no: `${slOf(t.code)}${letterOf(c.code)}`, task: c });
      out.push(...extra.map(asRow));
    } else {
      if (hasPhases && !open) {
        out.push({ kind: "phase", key: `general-${t.id}`, label: GENERAL_PHASE, taskId: null, count: 0 });
        open = true;
      }
      out.push({ kind: "task", key: t.id, no: slOf(t.code), task: t });
    }
  }
  // rows without a phase: at the end, under the last General heading if the list ends with one, else a new one
  if (general.length) {
    if (hasPhases && !open) out.push({ kind: "phase", key: "general-rows", label: GENERAL_PHASE, taskId: null, count: 0 });
    out.push(...general.map(asRow));
  }
  // the count of a General heading is the run of lines under it
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r.kind === "phase" && r.taskId === null) {
      let n = 0;
      for (let j = i + 1; j < out.length && out[j].kind !== "phase"; j++) n++;
      out[i] = { ...r, count: n };
    }
  }
  return out;
}

/** The phases a Tasklist row can be put under: the project's current headings (main tasks with subtasks). */
export function phaseChoices(roots: TasklistTask[]): { id: string; label: string }[] {
  return [...roots].filter((t) => t.children.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((t) => ({ id: t.id, label: `${slOf(t.code)}. ${t.title}` }));
}

/** A stable colour per person for the Assigned Person chips (Forest Green family + accents): [background, text]. */
const CHIP_TONES: [string, string][] = [
  ["#2f6b47", "#ffffff"], ["#1f4e79", "#ffffff"], ["#e7ece8", "#26332b"], ["#7a5a12", "#ffffff"],
  ["#5b3f7a", "#ffffff"], ["#9c4a14", "#ffffff"], ["#d9efdf", "#1d6b40"], ["#dfe9f5", "#1f4e79"],
];
export function personTone(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CHIP_TONES[h % CHIP_TONES.length];
}
