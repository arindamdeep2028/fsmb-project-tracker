/**
 * Working hours on daily reports (migration 27): a decimal number of hours, more than 0 and at most 24, with at
 * most two decimals (1.5, 2.25). The database enforces the same range and that one report's hours add up to 24
 * or less; these helpers only read what was typed and present what was saved.
 */
export const MAX_HOURS = 24;

/** What the user typed: "" → null (no hours), a valid amount → the number, anything else → an error sentence. */
export function parseHours(input: string | number | null | undefined): { ok: true; value: number | null } | { ok: false; message: string } {
  const raw = input == null ? "" : String(input).trim().replace(",", ".");
  if (raw === "") return { ok: true, value: null };
  if (!/^\d{1,2}(\.\d{0,2})?$/.test(raw) && !/^\.\d{1,2}$/.test(raw)) return { ok: false, message: "Working hours: write a number such as 1.5 or 2.25 (two decimals at most)." };
  const value = Number(raw);
  if (!(value > 0)) return { ok: false, message: "Working hours must be more than 0, or left empty." };
  if (value > MAX_HOURS) return { ok: false, message: "Working hours can't be more than 24 in a day." };
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/** Sum of the hours given; null when none of them is set (nothing recorded, shown as a dash). */
export function totalHours(values: (number | string | null | undefined)[]): number | null {
  const set = values.filter((v): v is number | string => v != null && v !== "").map(Number).filter((n) => Number.isFinite(n));
  if (!set.length) return null;
  return Math.round(set.reduce((a, b) => a + b, 0) * 100) / 100;
}

/** "4.5 hrs", "3.0 hrs", "2.25 hrs"; null → "-". */
export function formatHours(h: number | null | undefined): string {
  if (h == null) return "-";
  const n = Number(h);
  return `${Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100)} hrs`;
}
