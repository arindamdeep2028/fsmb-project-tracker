import Link from "next/link";
import { OVERDUE_LOOKBACK_DAYS, type OverdueItem } from "@/lib/overdue";
import { href } from "@/lib/drill";
import { sheetDate, weekday } from "@/lib/sheet";

const SHOWN = 10;

/**
 * "Overdue Daily Reports" on a dashboard: required reports for past working days that were never saved.
 * Each line opens that person's row for that day in the project's Daily reports tab; for an Admin it opens
 * the row ready to fill in (only an Admin can complete a past report). `own`: the viewer's own reports.
 */
export function OverdueReports({ items, canFill, own = false }: { items: OverdueItem[]; canFill: boolean; own?: boolean }) {
  if (!items.length) {
    return <p data-testid="overdue-reports" className="mb-6 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-ink-soft">No overdue daily reports in the last {OVERDUE_LOOKBACK_DAYS} days.</p>;
  }
  const row = (i: OverdueItem) => (
    <tr key={i.key} data-testid="overdue-row">
      <td><Link href={`/projects/${i.projectId}`} className="font-medium hover:text-steel hover:underline">{i.projectCode}</Link> <span className="text-ink-soft">{i.projectName}</span></td>
      <td className="whitespace-nowrap">{i.dayNo ? `Day ${i.dayNo}` : "—"}</td>
      <td className="whitespace-nowrap">{sheetDate(i.date)} <span className="text-ink-soft">{weekday(i.date)}</span></td>
      {own ? null : <td>{i.fullName}</td>}
      <td className="text-right">
        <Link href={href(`/projects/${i.projectId}/daily-reports`, { user: i.userId, from: i.date, to: i.date, fill: canFill ? i.date : undefined })}
          className={canFill ? "whitespace-nowrap rounded-md bg-signal-red px-2.5 py-1 text-xs font-medium text-white hover:opacity-90" : "whitespace-nowrap text-steel hover:underline"}>
          {canFill ? "Fill in report" : "View day"}
        </Link>
      </td>
    </tr>
  );
  const table = (rows: OverdueItem[], head: boolean) => (
    <table className="w-full border-collapse text-sm [&_td]:border-t [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-ink-soft">
      {head ? <thead><tr><th>Project</th><th>Day</th><th>Date</th>{own ? null : <th>Engineer</th>}<th /></tr></thead> : null}
      <tbody>{rows.map(row)}</tbody>
    </table>
  );
  return (
    <section data-testid="overdue-reports" aria-label="Overdue Daily Reports" className="rail rail-red mb-6 rounded-lg border border-signal-red/40 bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-3 pl-5 pr-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-signal-red">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-signal-red" />
          Overdue Daily Reports
          <span data-testid="overdue-count" className="rounded bg-signal-red px-2 py-0.5 text-xs font-semibold text-white">{items.length}</span>
        </h2>
        <span className="text-sm text-ink-soft">
          {own ? "Daily Report Due for past working days. Only an Admin can complete a past report." : canFill ? "Not submitted for a past working day. Open one to fill it in." : "Not submitted for a past working day. Only an Admin can complete them."}
        </span>
      </div>
      <div className="overflow-x-auto pl-1">
        {table(items.slice(0, SHOWN), true)}
        {items.length > SHOWN ? (
          <details className="border-t border-line-soft">
            <summary className="cursor-pointer px-3 py-2 text-sm text-steel hover:underline">Show {items.length - SHOWN} more</summary>
            {table(items.slice(SHOWN), false)}
          </details>
        ) : null}
      </div>
    </section>
  );
}
