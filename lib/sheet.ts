import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Helpers for the two workbook layouts the app mirrors: the project Task list
 * (SL | Task | Sub Task | …) and the Daily Reports sheet (Day | Date | Days | Task | …).
 * Dates are Dhaka calendar dates ("yyyy-MM-dd"); nothing here counts working days.
 */

/** SL of a task from its code: "P03-T04" → "4", "P03-T04b" → "4". */
export function slOf(code: string): string {
  const m = /-T(\d+)/.exec(code);
  return m ? String(Number(m[1])) : code;
}

/** Sub-task letter from its code: "P03-T04b" → "b"; "" for a top-level task. */
export function letterOf(code: string): string {
  const m = /-T\d+(\D.*)$/.exec(code);
  return m ? m[1].replace(/^-/, "") : "";
}

/** "4. Title" for a task, "4b. Title" for a subtask (the workbook's numbering). */
export function taskLabel(code: string, title: string): string {
  return `${slOf(code)}${letterOf(code)}. ${title}`;
}

/** "Day 47": calendar days since the project started, counting the start day as Day 1. */
export function projectDayNumber(start: string | null | undefined, date: string): number | null {
  if (!start) return null;
  const n = differenceInCalendarDays(parseISO(date), parseISO(start.slice(0, 10))) + 1;
  return n >= 1 ? n : null;
}

/**
 * The dates a new Daily Update row may be given: an Admin any day from the project's Day 1 to today, everyone
 * else today only. `fixed`: there is just one such date, so there is nothing to pick.
 */
export function rowDateChoice(isAdmin: boolean, start: string, today: string): { min: string; max: string; fixed: boolean } {
  const min = isAdmin && start < today ? start : today;
  return { min, max: today, fixed: min === today };
}

/** "25-Sep-26" */
export const sheetDate = (d: string) => format(parseISO(d), "d-MMM-yy");
/** "Friday" */
export const weekday = (d: string) => format(parseISO(d), "EEEE");
/** ISO weekday (1 = Monday) is not in the workspace's working week. */
export const isOffDay = (d: string, workdays: number[] = [1, 2, 3, 4, 5]) => !workdays.includes(Number(format(parseISO(d), "i")));

/** Every calendar date from `from` to `to`, inclusive, ascending. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = parseISO(to);
  for (let d = parseISO(from); d <= end && out.length < 400; d = addDays(d, 1)) out.push(format(d, "yyyy-MM-dd"));
  return out;
}

/** A file attached to one task row of a daily update; `url` is a short-lived signed link (null if it can't be read). */
export type TaskFile = { id: string; name: string; mime: string; url: string | null };

/**
 * How a task status reads in the two sheet layouts (Daily Reports and Tasklist), as in the team's workbooks:
 * Completed → Done, In progress → On-Going, Not started → Pending. Display only; the database value is unchanged.
 */
export const SHEET_STATUS: Record<string, string> = {
  Completed: "Done", "In progress": "On-Going", "Not started": "Pending", "Plan submitted": "Plan submitted", Blocked: "Blocked",
};
export const sheetStatus = (s: string | null | undefined) => (s ? SHEET_STATUS[s] ?? s : "");
/** Pill colours per status (screen and Excel): [background, text]. */
export const STATUS_TONE: Record<string, [string, string]> = {
  Completed: ["#d9efdf", "#1d6b40"], "In progress": ["#fbe8b4", "#6f4a00"], "Not started": ["#b3261e", "#ffffff"],
  "Plan submitted": ["#e3ebf3", "#2d4a66"], Blocked: ["#f6d5d3", "#9b1c17"],
};
/** Priority colours (Tasklist): [background, text]. */
export const PRIORITY_TONE: Record<string, [string, string]> = {
  Important: ["#b3261e", "#ffffff"], High: ["#f6d5d3", "#9b1c17"], Normal: ["#e9efe9", "#34483c"], Low: ["#edf0f3", "#5b6878"],
};

/** An Admin's remark on a project day, addressed to one member (migration 27). Legacy notes come from the report text. */
export type DayRemark = {
  id: string; date: string; recipientId: string; recipient: string; authorId: string | null; author: string;
  body: string; createdAt: string; updatedAt: string; edited: boolean;
  /** a free-text remark saved inside a daily report before remarks became the Admin's (read-only) */
  legacy?: boolean;
};

/** One line of the Daily Follow Up: a person's update for a project on one date (empty when nobody reported). */
export type DailyRow = {
  key: string;
  date: string;
  dayNo: number | null;
  offDay: boolean;
  reportId: string | null;
  /** author, lock and the raw values, for editing the row in place */
  userId: string | null;
  locked: boolean;
  edit: { taskId: string | null; status: string | null; progress: number | null; nextTask: string; taskHours?: number | null; reportHours?: number | null } | null;
  /** working hours of the update: the report's own hours plus every task row's hours (null: none recorded) */
  hours?: number | null;
  /** each task row of the update; `files`: its screenshots/photos (task-row attachments, signed links) */
  mainTask: { label: string; sub: string | null; status: string | null; taskId?: string; files?: TaskFile[] }[];
  /** all files attached to the report (whole report + task rows), for the files-per-report limit */
  fileCount?: number;
  dailySubTask: string;
  assignedTo: string;
  issues: string;
  nextTask: string;
  remarks: string;
};

/**
 * The sheet's project-day rows: consecutive lines of the same date (each person's own report) shown as one row.
 * Display only — every report stays its own record, edited on its own.
 */
export function dayGroups(rows: DailyRow[]): DailyRow[][] {
  const out: DailyRow[][] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last[0].date === r.date) last.push(r);
    else out.push([r]);
  }
  return out;
}

/** Newest date first (Admin, Department Head, Project Manager) or oldest first from Day 1 (Engineer). */
export type ReportOrder = "asc" | "desc";

/** Columns of the Daily Reports sheet, on screen and in the Excel export. */
export const DAILY_HEAD = ["Day", "Date", "Days", "Task", "Assigned To", "Working Hours", "Status", "Issues", "Next Task", "Attachment", "Remarks"] as const;
/** Fixed column widths (px), shared by the screen and the Excel export. */
export const DAILY_WIDTHS = [64, 96, 92, 300, 120, 80, 110, 104, 112, 90, 124];

/** The remarks shown for one person's line: the Admin's remarks to them that day, then their own legacy note. */
export function remarksFor(r: DailyRow, remarks: DayRemark[]): DayRemark[] {
  const given = remarks.filter((m) => m.date === r.date && (r.userId ? m.recipientId === r.userId : true));
  const legacy: DayRemark[] = r.remarks && r.reportId ? [{
    id: `legacy-${r.reportId}`, date: r.date, recipientId: r.userId ?? "", recipient: r.assignedTo, authorId: r.userId, author: r.assignedTo,
    body: r.remarks, createdAt: "", updatedAt: "", edited: false, legacy: true,
  }] : [];
  return [...given, ...legacy];
}

/**
 * The remarks of one project day (a group of lines): every remark that day, including one to a person with no
 * line of their own that day. Ordered oldest first.
 */
export function remarksForDay(g: DailyRow[], remarks: DayRemark[]): DayRemark[] {
  const date = g[0]?.date;
  const given = remarks.filter((m) => m.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const legacy = g.flatMap((r) => remarksFor(r, []));
  return [...given, ...legacy];
}

/** One line of the sheet as Excel cells, in the same column order. */
export function dailyExcelLine(r: DailyRow, remarks: DayRemark[] = []): (string | number | null)[] {
  const notes = remarksFor(r, remarks).map((m) => (m.legacy ? `${m.body} (note by ${m.author})` : `${m.body} (from ${m.author} to ${m.recipient})`));
  return [
    r.dayNo ? `Day ${r.dayNo}` : "", sheetDate(r.date), weekday(r.date),
    [...r.mainTask.map((m) => (m.sub ? `${m.label} / ${m.sub}` : m.label)), r.dailySubTask].filter(Boolean).join("\n"), r.assignedTo,
    r.hours ?? null,
    r.mainTask.map((m) => sheetStatus(m.status)).filter(Boolean).join("\n"), r.issues, r.nextTask,
    r.fileCount ? r.fileCount : "", notes.join("\n"),
  ];
}
