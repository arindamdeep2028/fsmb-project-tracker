import { z } from "zod";

/** Zod schemas mirror the table checks, so the form and the Server Action reject the same things. */
export const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Choose a value");
const optText = (max: number) => z.string().max(max).optional().transform((v) => (v?.trim() ? v.trim() : null));
/** For partial updates: a field that isn't sent stays undefined (not written); an empty one clears the column. */
const patchText = (max: number) => z.string().max(max).optional().transform((v) => (v === undefined ? undefined : v.trim() ? v.trim() : null));

export const taskStatus = z.enum(["Not started", "Plan submitted", "In progress", "Blocked", "Completed"]);
/** Normal / Important / Urgent (the earlier High and Low were moved by migration 31 and are refused by the database). */
export const priority = z.enum(["Normal", "Important", "Urgent"]);

export const taskCreate = z.object({
  project_id: id,
  parent_id: id.optional().nullable(),
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: optText(5000),
  priority: priority.default("Normal"),
  assigned_to: id,
  contribution_pct: z.number().min(0).max(100).nullable().optional(),
  planned_due_local: z.string().optional(), // managers only; Dhaka wall-clock
  contribution_locked: z.boolean().optional(),
});
export type TaskCreate = z.input<typeof taskCreate>;

export const taskPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: patchText(5000),
  priority: priority.optional(),
  assigned_to: id.optional(),
  contribution_pct: z.number().min(0).max(100).nullable().optional(),
  contribution_locked: z.boolean().optional(),
  blocker_note: patchText(1000),
  planned_due_local: z.string().optional(),
  status: taskStatus.optional(),
});
export type TaskPatch = z.input<typeof taskPatch>;

/** A Responsibilities cell of an existing task (member_update_task, migration 32): no End Date here. */
export const cellPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: patchText(5000),
  assigned_to: id.optional(),
  priority: priority.optional(),
  progress_pct: z.number().min(0).max(100).optional(),
}).strict();
export type CellPatch = z.input<typeof cellPatch>;

/** Working hours (migration 27): more than 0, at most 24, two decimals; null = none recorded. */
export const workHours = z.number().gt(0, "Working hours must be more than 0").max(24, "Working hours can't be more than 24")
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Working hours: two decimals at most").nullable().optional();

export const reportItem = z.object({
  task_id: id,
  progress_after: z.number().min(0).max(100).nullable().optional(),
  status_after: taskStatus.nullable().optional(),
  note: z.string().max(3000).optional().nullable(),
  work_hours: workHours,
});
export const reportInput = z.object({
  project_id: id,
  update_text: z.string().trim().min(1, "Write what you did today").max(5000),
  issues: z.string().max(3000).optional().nullable(),
  next_task_id: z.string().optional().nullable(),
  next_task_text: z.string().max(1000).optional().nullable(),
  remarks: z.string().max(3000).optional().nullable(),
  /** hours of the day not tied to a listed task; absent = keep what is saved */
  work_hours: workHours,
  items: z.array(reportItem).default([]),
  /** task entries the user removed on purpose (changed or cleared the Main Task); nothing else is ever removed */
  remove_task_ids: z.array(id).default([]),
});
export type ReportInput = z.input<typeof reportInput>;

/** One row of the project's Daily Follow Up, added or edited in place (Daily reports tab). */
export const dailyRowInput = z.object({
  /** the saved report this row edits; absent or null when the row is new (a new row never replaces a saved one) */
  report_id: id.nullable().optional(),
  project_id: id,
  user_id: id,
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  task_id: id.nullable(),
  update_text: z.string().trim().min(1, "Write the Task: what was done that day").max(5000),
  status: taskStatus.nullable(),
  progress: z.number().min(0).max(100).nullable(),
  issues: z.string().max(3000),
  next_task_text: z.string().max(1000),
  /** hours for the row: on its Main Task when one is chosen, otherwise on the report */
  work_hours: workHours,
  remove_task_ids: z.array(id).default([]),
});
export type DailyRowInput = z.input<typeof dailyRowInput>;

/** An Admin's remark on a project day to one member (migration 27). `id` set = edit that remark. */
export const remarkInput = z.object({
  id: id.nullable().optional(),
  project_id: id,
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  recipient_id: id,
  body: z.string().trim().min(1, "Write the remark").max(2000, "A remark can be 2000 characters at most"),
});
export type RemarkInput = z.input<typeof remarkInput>;

/** Tasklist cells (migration 27). */
export const tasklistComment = z.object({ task_id: id, body: z.string().max(500, "A comment can be 500 characters at most") });
export const tasklistAssignee = z.object({ task_id: id, user_id: id });

/** Tasklist rows and member edits (migration 28). */
export const TASKLIST_MAX_ADD = 50;
export const tasklistAddRows = z.object({
  project_id: id,
  count: z.coerce.number().int("Enter a whole number of rows").min(1, "Add at least 1 row").max(TASKLIST_MAX_ADD, `Add at most ${TASKLIST_MAX_ADD} rows at a time`),
  phase_id: id.nullable(),
  category: z.enum(["General", "Urgent"]).default("General"),
});
/** A Tasklist line's category (General Task / Urgent Task); separate from Priority. */
export const tasklistCategory = z.enum(["General", "Urgent"]);
export const tasklistTaskCategory = z.object({ task_id: id, category: tasklistCategory });
/** An existing task's cells the Tasklist may change (name, status, priority); a field not sent stays as it is. */
export const tasklistTaskPatch = z.object({
  title: z.string().trim().min(1, "A task needs a name").max(300, "A name can be 300 characters at most").optional(),
  status: taskStatus.optional(),
  priority: priority.optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to save");
/** A Tasklist row's cells; the name may stay empty until it is filled in. */
export const tasklistRowPatch = z.object({
  title: z.string().trim().max(300, "A name can be 300 characters at most").optional(),
  status: taskStatus.optional(),
  priority: priority.optional(),
  comment: z.string().trim().max(500, "A comment can be 500 characters at most").optional(),
  category: z.enum(["General", "Urgent"]).optional(),
  phase_task_id: id.nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to save");
export const tasklistRowAssignee = z.object({ row_id: id, user_id: id });
export type TasklistRowPatch = z.input<typeof tasklistRowPatch>;
export type TasklistTaskPatch = z.input<typeof tasklistTaskPatch>;

export const projectInput = z.object({
  code: z.string().trim().min(1, "Add a project code").max(20),
  name: z.string().trim().min(1, "Add a project name").max(200),
  description: optText(5000),
  department_id: id,
  pm_id: id.nullable().optional(),
  status: z.enum(["Active", "On hold", "Completed", "Cancelled"]).default("Active"),
  category: z.enum(["Software", "Embedded", "Optical", "Mechanical"]).optional(),
  start_date: z.string().optional().transform((v) => v || null),
  target_end: z.string().optional().transform((v) => v || null),
  notes: optText(5000),
});
export type ProjectInput = z.input<typeof projectInput>;
/**
 * Partial edit. Status has no default here: Zod 4 applies defaults inside .partial(), which would otherwise
 * reset the status to Active on every save that didn't touch it.
 */
export const projectUpdateInput = projectInput.extend({ status: z.enum(["Active", "On hold", "Completed", "Cancelled"]) }).partial();

/** Lifecycle change (migration 24): Running = Active, Halted = On hold, Completed. */
export const projectStatusInput = z.object({
  projectId: id,
  status: z.enum(["Active", "On hold", "Completed"]),
  reason: z.string().trim().max(1000, "Keep the reason under 1000 characters").optional(),
});

export const password = z.string().min(10, "Use at least 10 characters").max(72);

/** Create user: the admin sets the password (sent only to Supabase Auth via auth-admin; never shown or stored). */
export const inviteInput = z.object({
  full_name: z.string().trim().min(1, "Add the person's name").max(120),
  login_name: z.string().trim().min(1).max(60).regex(/^[a-z0-9._-]+$/i, "Letters, numbers, dots, dashes only"),
  email: z.email("Enter a valid email"),
  role: z.enum(["admin", "dept_head", "pm", "engineer"]),
  department_id: z.string().min(1, "Choose a department").pipe(id),
  password,
  confirm_password: z.string(),
}).refine((v) => v.password === v.confirm_password, { message: "The two passwords don't match", path: ["confirm_password"] });
export type InviteInput = z.input<typeof inviteInput>;

/** Admin sets another user's password (sent only to Supabase Auth via auth-admin; never shown or stored). */
export const setPasswordInput = z.object({
  user_id: id,
  password,
  confirm_password: z.string(),
}).refine((v) => v.password === v.confirm_password, { message: "The two passwords don't match", path: ["confirm_password"] });
export type SetPasswordInput = z.input<typeof setPasswordInput>;

export const settingsInput = z.object({
  office_start: z.number().int().min(0).max(23),
  office_end: z.number().int().min(1).max(24),
  plan_hours: z.number().int().min(1).max(24),
  exec_days: z.number().int().min(1).max(10),
  workdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one working day"),
  deadline_warning_hours: z.number().int().min(1).max(48),
  review_window_days: z.number().int().min(7).max(730),
  score_weight_on_time: z.number().min(0).max(1),
  notification_retention_days: z.number().int().min(7).max(730),
  attachment_max_files: z.number().int().min(1).max(50),
  digest_email: z.string().optional().transform((v) => v || null),
}).refine((v) => v.office_end > v.office_start, { message: "Office end must be after office start", path: ["office_end"] });

export function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Check the form and try again.";
}
