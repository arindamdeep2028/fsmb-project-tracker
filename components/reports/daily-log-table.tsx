import { Fragment } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { DAILY_HEAD, dayGroups, sheetDate, weekday, type DailyRow, type TaskFile } from "@/lib/sheet";
import { cn } from "@/lib/utils";

/** A signed Storage link that downloads the file under its own name instead of opening it. */
const downloadUrl = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

/**
 * The screenshots and photos attached to one task row, as thumbnails inside the Task cell: a click opens the
 * file, the small link under it downloads it. Links are signed for the viewer and expire after 10 minutes.
 */
export function TaskFiles({ files, task }: { files: TaskFile[]; task: string }) {
  return (
    <ul data-testid="task-files" aria-label={`Files for ${task}`} className="mt-1.5 flex flex-wrap gap-1.5 font-normal">
      {files.map((f) => (
        <li key={f.id} data-testid="task-file" className="w-16">
          {f.url ? (
            <>
              <a href={f.url} target="_blank" rel="noreferrer" title={`Open ${f.name}`} className="block overflow-hidden rounded border border-line bg-panel">
                {f.mime.startsWith("image/") && f.mime !== "image/heic"
                  // eslint-disable-next-line @next/next/no-img-element -- signed links expire, nothing to cache
                  ? <img src={f.url} alt={f.name} loading="lazy" className="h-12 w-16 object-cover" />
                  : <span className="grid h-12 w-16 place-items-center text-ink-faint"><FileText size={20} /></span>}
              </a>
              <a href={downloadUrl(f.url, f.name)} aria-label={`Download ${f.name}`} className="mt-0.5 flex items-center justify-center gap-0.5 text-[10px] text-steel hover:underline">
                <Download size={10} />Download
              </a>
            </>
          ) : <span className="grid h-12 w-16 place-items-center rounded border border-line text-[10px] text-ink-faint" title={f.name}>unavailable</span>}
        </li>
      ))}
    </ul>
  );
}

/** Fixed column widths (px), so adding or editing a row never shifts the grid. */
const DAILY_WIDTHS = [60, 112, 92, 340, 96, 116, 116, 130, 130];

/** Header row of the Daily Reports sheet (shared by the log and the update form). */
export function DailyHead() {
  return (
    <tr className="bg-[#efeadf] text-ink">
      {DAILY_HEAD.map((h, i) => <th key={i} className="border border-ink/70 px-3 py-2 text-center font-semibold">{h}</th>)}
    </tr>
  );
}

/** Day / Date / Days cells in the sheet's shading. */
export function DayCells({ date, dayNo, rowSpan }: { date: string; dayNo: number | null; rowSpan?: number }) {
  const c = "border border-ink/30 px-2 py-2 text-center whitespace-nowrap align-middle";
  return (
    <>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#e9e3d3]")}>{dayNo ? `Day ${dayNo}` : "—"}</td>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#d8cfb4]")}>{sheetDate(date)}</td>
      <td rowSpan={rowSpan} className={cn(c, "bg-[#e9e3d3]")}>{weekday(date)}</td>
    </>
  );
}

/** Status as in the sheet: Completed in green, work still going on ("In progress") in red. */
export function StatusMark({ status }: { status: string }) {
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold",
      status === "Completed" ? "bg-signal-green text-white" : status === "In progress" ? "bg-signal-red text-white" : "border border-ink/30 bg-panel text-ink")}>
      {status}
    </span>
  );
}

/**
 * The project's Daily Reports sheet, laid out like the workbook: Day | Date | Days | Task | Assigned To | Status |
 * Issues | Next Task | Remarks. The Task cell holds the main task, its subtask and the work done that day.
 * Non-working days are shaded; each filled row opens its report. Several people's updates for the same date share
 * one row (each under the person's name, with its own Edit); every update stays its own report.
 */
export function DailyLogTable({ rows, empty = "No daily updates in this range.", replaceRow, rowAction, lead, footer }: {
  rows: DailyRow[]; empty?: string;
  /** in-place editing (Daily reports tab): a row rendered instead of `r`, an action under the name, extra rows first or last */
  replaceRow?: (r: DailyRow) => React.ReactNode | null; rowAction?: (r: DailyRow) => React.ReactNode; lead?: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[1192px] table-fixed border-collapse text-sm">
        <colgroup>{DAILY_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead><DailyHead /></thead>
        <tbody>
          {lead}
          {rows.length === 0 && !footer && !lead ? <tr><td colSpan={DAILY_HEAD.length} className="px-3 py-8 text-center text-ink-soft">{empty}</td></tr> : dayGroups(rows).map((g) => {
            // an update being edited is taken out of the day's row and its editor is shown right below it
            const edited = g.map((r) => replaceRow?.(r) ?? null);
            const shown = g.filter((_, i) => !edited[i]);
            return <Fragment key={g[0].key}>{shown.length ? <DayRow g={shown} rowAction={rowAction} /> : null}{edited}</Fragment>;
          })}
          {footer}
        </tbody>
      </table>
    </div>
  );
}

/** One project-day row: a single update exactly as one line of the sheet, or several people's updates stacked in each cell. */
function DayRow({ g, rowAction }: { g: DailyRow[]; rowAction?: (r: DailyRow) => React.ReactNode }) {
  const cell = "border border-ink/30 px-2 py-2 align-top whitespace-pre-wrap break-words";
  const day = "border border-ink/30 px-2 py-1.5 text-center whitespace-nowrap";
  const r = g[0];
  const multi = g.length > 1;
  const divider = (i: number) => cn(i > 0 && "mt-2 border-t border-dashed border-ink/40 pt-2");
  /** a column's content: as before for one update; for several, each non-empty part under its author's name */
  const parts = (body: (p: DailyRow) => React.ReactNode, has: (p: DailyRow) => boolean = () => true) => (!multi ? body(r) : g.filter(has).map((p, i) => (
    <div key={p.key} data-testid="daily-row-part" className={divider(i)}>
      <div className={cn("mb-0.5 text-xs font-bold", !r.offDay && "text-steel")}>{p.assignedTo}</div>
      {body(p)}
    </div>
  )));
  const task = (p: DailyRow) => (
    <>
      {p.mainTask.map((m, i) => (
        <div key={i} className={cn("font-semibold", i > 0 && "mt-1.5")}>{m.label}{m.sub ? <span className="block text-xs font-medium opacity-80">{m.sub}</span> : null}
          {m.files?.length ? <TaskFiles files={m.files} task={m.sub ?? m.label} /> : null}
        </div>
      ))}
      {p.dailySubTask ? (
        <div className={cn(p.mainTask.length > 0 && "mt-1.5")}>
          {p.reportId ? <Link href={`/daily-reports/${p.reportId}`} className="hover:text-steel hover:underline">{p.dailySubTask}</Link> : p.dailySubTask}
        </div>
      ) : null}
    </>
  );
  const status = (p: DailyRow) => p.mainTask.map((m, i) => (m.status ? <div key={i} className={cn(i > 0 && "mt-1.5")}><StatusMark status={m.status} /></div> : null));
  return (
    <tr className={cn(r.offDay && "bg-[#9c4a14] text-white")} data-testid={multi ? "daily-row-group" : undefined}>
      {r.offDay ? (
        <>
          <td className={day}>{r.dayNo ? `Day ${r.dayNo}` : "—"}</td>
          <td className={day}>{sheetDate(r.date)}</td>
          <td className={day}>{weekday(r.date)}</td>
        </>
      ) : <DayCells date={r.date} dayNo={r.dayNo} />}
      <td className={cell}>{parts(task)}</td>
      <td className={cn(cell, "text-center")}>
        {g.map((p, i) => <div key={p.key} className={divider(i)}>{p.assignedTo}{rowAction ? <div className="mt-1">{rowAction(p)}</div> : null}</div>)}
      </td>
      <td className={cn(cell, "text-center")}>{parts(status, (p) => p.mainTask.some((m) => m.status))}</td>
      <td className={cell}>{parts((p) => p.issues, (p) => Boolean(p.issues))}</td>
      <td className={cell}>{parts((p) => p.nextTask, (p) => Boolean(p.nextTask))}</td>
      <td className={cell}>{parts((p) => p.remarks, (p) => Boolean(p.remarks))}</td>
    </tr>
  );
}
