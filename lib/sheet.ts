import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Helpers for the two workbook layouts the app mirrors: the project Task list
 * (SL | Task | Sub Task | …) and the Daily Follow Up (Day | Date | Day | Main Task | …).
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

/** One line of the Daily Follow Up: a person's update for a project on one date (empty when nobody reported). */
export type DailyRow = {
  key: string;
  date: string;
  dayNo: number | null;
  offDay: boolean;
  reportId: string | null;
  mainTask: { label: string; sub: string | null; status: string | null }[];
  dailySubTask: string;
  assignedTo: string;
  issues: string;
  nextTask: string;
  remarks: string;
};
