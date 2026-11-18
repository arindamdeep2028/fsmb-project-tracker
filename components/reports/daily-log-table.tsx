import { Fragment } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { DAILY_HEAD, DAILY_WIDTHS, STATUS_TONE, dayGroups, remarksForDay, sheetDate, sheetStatus, weekday, type DailyRow, type DayRemark, type TaskFile } from "@/lib/sheet";
import { formatHours } from "@/lib/hours";
import { cn } from "@/lib/utils";
import { AttachmentChip, RemarksCell } from "./sheet-cells";

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

/** Header row of the Daily Reports sheet (shared by the log and the update form). */
export function DailyHead() {
  return (
    <tr className="bg-[#efeadf] text-ink">
      {DAILY_HEAD.map((h, i) => <th key={i} className="border border-ink/40 px-2 py-2 text-center text-[13px] font-semibold leading-tight">{h}</th>)}
    </tr>
  );
}

/** Day / Date / Days cells in the sheet's shading. */
export function DayCells({ date, dayNo, rowSpan, offDay }: { date: string; dayNo: number | null; rowSpan?: number; offDay?: boolean }) {
  const c = "border border-ink/20 px-2 py-2 text-center whitespace-nowrap align-middle";
  return (
    <>
      <td rowSpan={rowSpan} className={c}>{dayNo ? `Day ${dayNo}` : "—"}</td>
      <td rowSpan={rowSpan} className={cn(c, !offDay && "bg-[#e9e1cc]")}>{sheetDate(date)}</td>
      <td rowSpan={rowSpan} className={c}>{weekday(date)}</td>
    </>
  );
}

/** Status as a pill, in the team's sheet words: Done (green), On-Going (amber), Pending (red). */
export function StatusMark({ status }: { status: string }) {
  const [bg, fg] = STATUS_TONE[status] ?? ["#ffffff", "#26332b"];
  return (
    <span title={status} className="inline-block min-w-[5.5rem] rounded-full px-2.5 py-0.5 text-center text-xs font-semibold" style={{ background: bg, color: fg }}>
      {sheetStatus(status)}
    </span>
  );
}

/** What the Remarks column needs to show and write remarks (the project's Daily reports tab). */
export type RemarkContext = { projectId: string; people: { id: string; name: string }[]; isAdmin: boolean; openId?: string | null };

/**
 * The project's Daily Reports sheet: Day | Date | Days | Task | Assigned To | Working Hours | Status | Issues |
 * Next Task | Attachment | Remarks. The Task cell holds the main task, its subtask and the work done that day.
 * Non-working days are shaded; each filled row opens its report. Several people's updates for the same date share
 * one row (each under the person's name, with its own Edit); every update stays its own report.
 */
export function DailyLogTable({ rows, empty = "No daily updates in this range.", replaceRow, rowAction, dayAction, lead, footer, remarks = [], remarkContext }: {
  rows: DailyRow[]; empty?: string;
  /** in-place editing (Daily reports tab): a row rendered instead of `r`, an action under the name, extra rows first or last */
  replaceRow?: (r: DailyRow) => React.ReactNode | null; rowAction?: (r: DailyRow) => React.ReactNode; lead?: React.ReactNode; footer?: React.ReactNode;
  /** an action for the whole project day (Admin: add another member's report for that date) */
  dayAction?: (g: DailyRow[]) => React.ReactNode;
  /** the Admin's remarks for the shown days (RLS-filtered for the viewer) */
  remarks?: DayRemark[]; remarkContext?: RemarkContext;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[1292px] table-fixed border-collapse text-sm">
        <colgroup>{DAILY_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead><DailyHead /></thead>
        <tbody>
          {lead}
          {rows.length === 0 && !footer && !lead ? <tr><td colSpan={DAILY_HEAD.length} className="px-3 py-8 text-center text-ink-soft">{empty}</td></tr> : dayGroups(rows).map((g) => {
            // an update being edited is taken out of the day's row and its editor is shown right below it
            const edited = g.map((r) => replaceRow?.(r) ?? null);
            const shown = g.filter((_, i) => !edited[i]);
            return (
              <Fragment key={g[0].key}>
                {shown.length ? <DayRow g={shown} rowAction={rowAction} dayAction={dayAction} remarks={remarks} remarkContext={remarkContext} /> : null}
                {edited}
              </Fragment>
            );
          })}
          {footer}
        </tbody>
      </table>
    </div>
  );
}

/** One project-day row: a single update exactly as one line of the sheet, or several people's updates stacked in each cell. */
function DayRow({ g, rowAction, dayAction, remarks, remarkContext }: {
  g: DailyRow[]; rowAction?: (r: DailyRow) => React.ReactNode; dayAction?: (g: DailyRow[]) => React.ReactNode;
  remarks: DayRemark[]; remarkContext?: RemarkContext;
}) {
  const cell = "border border-ink/20 px-2 py-2 align-middle whitespace-pre-wrap break-words";
  const center = cn(cell, "text-center");
  const r = g[0];
  const multi = g.length > 1;
  const filled = g.some((p) => p.reportId);
  const divider = (i: number) => cn(i > 0 && "mt-2 border-t border-dashed border-ink/30 pt-2");
  const dash = <span className={r.offDay ? "opacity-80" : "text-ink-soft"}>-</span>;
  /** a column's content: as before for one update; for several, each non-empty part under its author's name */
  const parts = (body: (p: DailyRow) => React.ReactNode, has: (p: DailyRow) => boolean = () => true) => {
    if (!multi) return has(r) ? body(r) : dash;
    const xs = g.filter(has);
    if (!xs.length) return dash;
    return xs.map((p, i) => (
      <div key={p.key} data-testid="daily-row-part" className={divider(i)}>
        <div className={cn("mb-0.5 text-xs font-bold", !r.offDay && "text-steel")}>{p.assignedTo}</div>
        {body(p)}
      </div>
    ));
  };
  const task = (p: DailyRow) => (
    <div className="text-left">
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
    </div>
  );
  const status = (p: DailyRow) => p.mainTask.map((m, i) => (m.status ? <div key={i} className={cn(i > 0 && "mt-1.5")}><StatusMark status={m.status} /></div> : null));
  const dayRemarks = remarkContext || remarks.length ? remarksForDay(g, remarks) : [];
  const people = g.filter((p) => p.userId);
  return (
    <tr className={cn(r.offDay ? "bg-[#9c4a14] text-white" : "bg-panel")} data-testid={multi ? "daily-row-group" : "daily-row"} data-date={r.date}>
      <DayCells date={r.date} dayNo={r.dayNo} offDay={r.offDay} />
      <td className={cn(cell, "align-top")}>{filled ? parts(task, (p) => Boolean(p.mainTask.length || p.dailySubTask)) : null}</td>
      <td className={center}>
        {g.map((p, i) => (
          <div key={p.key} className={cn(divider(i), "text-[13px] leading-snug")}>
            {p.assignedTo}{rowAction ? <div className="mt-0.5">{rowAction(p)}</div> : null}
          </div>
        ))}
        {dayAction ? <div className="mt-1">{dayAction(g)}</div> : null}
      </td>
      <td className={center} data-testid="hours-cell">{parts((p) => formatHours(p.hours), (p) => p.hours != null)}</td>
      <td className={center}>{parts(status, (p) => p.mainTask.some((m) => m.status))}</td>
      <td className={center}>{parts((p) => p.issues, (p) => Boolean(p.issues))}</td>
      <td className={center}>{parts((p) => p.nextTask, (p) => Boolean(p.nextTask))}</td>
      <td className={center}>{parts((p) => <AttachmentChip reportId={p.reportId} count={p.fileCount ?? 0} label={`${p.assignedTo}, ${sheetDate(p.date)}`} />, (p) => Boolean(p.reportId && p.fileCount))}</td>
      <td className={cn(center, "text-ink")} data-testid="remarks-cell">
        {remarkContext ? (
          <RemarksCell remarks={dayRemarks} projectId={remarkContext.projectId} date={r.date} people={remarkContext.people} isAdmin={remarkContext.isAdmin}
            defaultRecipient={people.length === 1 ? people[0].userId : null} openId={remarkContext.openId} label={sheetDate(r.date)} />
        ) : dayRemarks.length ? (
          <RemarksCell remarks={dayRemarks} projectId="" date={r.date} people={[]} isAdmin={false} label={sheetDate(r.date)} />
        ) : dash}
      </td>
    </tr>
  );
}
