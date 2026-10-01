import Link from "next/link";
import { sheetDate, weekday, type DailyRow } from "@/lib/sheet";
import { cn } from "@/lib/utils";

export const DAILY_HEAD = ["Day", "Date", "Day", "Main Task", "Daily Sub Task", "Assigned To", "Status", "Issues", "Next Task", "Remarks"] as const;
/** Fixed column widths (px), so adding or editing a row never shifts the grid. */
const DAILY_WIDTHS = [60, 112, 84, 160, 188, 96, 116, 116, 130, 130];

/** Header row of the Daily Follow Up sheet (shared by the log and the update form). */
export function DailyHead() {
  return (
    <tr className="bg-[#efeadf] text-ink">
      {DAILY_HEAD.map((h, i) => <th key={i} className="border border-ink/70 px-3 py-2 text-center font-semibold">{h}</th>)}
    </tr>
  );
}

/** Day / Date / Day cells in the sheet's shading. */
export function DayCells({ date, dayNo, rowSpan }: { date: string; dayNo: number | null; rowSpan?: number }) {
  const c = "border border-line px-2 py-2 text-center whitespace-nowrap align-middle";
  return (
    <>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#e9e3d3]")}>{dayNo ? `Day ${dayNo}` : "—"}</td>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#d8cfb4]")}>{sheetDate(date)}</td>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#e9e3d3]")}>{weekday(date)}</td>
    </>
  );
}

/**
 * The project's Daily Follow Up, laid out like the workbook sheet: Day | Date | Day | Main Task | Daily Sub Task |
 * Assigned To | Status | Issues | Next Task | Remarks. Non-working days are shaded; each filled row opens its report.
 */
export function DailyLogTable({ rows, empty = "No daily updates in this range.", replaceRow, rowAction, footer }: {
  rows: DailyRow[]; empty?: string;
  /** in-place editing (Daily reports tab): a row rendered instead of `r`, an action under the name, extra rows at the end */
  replaceRow?: (r: DailyRow) => React.ReactNode | null; rowAction?: (r: DailyRow) => React.ReactNode; footer?: React.ReactNode;
}) {
  const cell = "border border-line px-2 py-2 align-top whitespace-pre-wrap break-words";
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[1192px] table-fixed border-collapse text-sm">
        <colgroup>{DAILY_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead><DailyHead /></thead>
        <tbody>
          {rows.length === 0 && !footer ? <tr><td colSpan={DAILY_HEAD.length} className="px-3 py-8 text-center text-ink-soft">{empty}</td></tr> : rows.map((r) => replaceRow?.(r) ?? (
            <tr key={r.key} className={cn(r.offDay && "bg-[#9c4a14] text-white")}>
              {r.offDay ? (
                <>
                  <td className="border border-line px-2 py-1.5 text-center whitespace-nowrap">{r.dayNo ? `Day ${r.dayNo}` : "—"}</td>
                  <td className="border border-line px-2 py-1.5 text-center whitespace-nowrap">{sheetDate(r.date)}</td>
                  <td className="border border-line px-2 py-1.5 text-center whitespace-nowrap">{weekday(r.date)}</td>
                </>
              ) : <DayCells date={r.date} dayNo={r.dayNo} />}
              <td className={cn(cell, "text-center")}>
                {r.mainTask.map((m, i) => (
                  <div key={i} className={cn(i > 0 && "mt-1.5")}>{m.label}{m.sub ? <span className="block text-xs opacity-80">{m.sub}</span> : null}</div>
                ))}
              </td>
              <td className={cell}>
                {r.reportId ? <Link href={`/daily-reports/${r.reportId}`} className="hover:text-steel hover:underline">{r.dailySubTask}</Link> : null}
              </td>
              <td className={cn(cell, "text-center")}>{r.assignedTo}{rowAction ? <div className="mt-1">{rowAction(r)}</div> : null}</td>
              <td className={cn(cell, "text-center")}>
                {r.mainTask.map((m, i) => <div key={i} className={cn(i > 0 && "mt-1.5")}>{m.status ?? ""}</div>)}
              </td>
              <td className={cell}>{r.issues}</td>
              <td className={cell}>{r.nextTask}</td>
              <td className={cell}>{r.remarks}</td>
            </tr>
          ))}
          {footer}
        </tbody>
      </table>
    </div>
  );
}
