"use client";
import * as React from "react";
import Link from "next/link";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, EmptyState, Table } from "@/components/ui/misc";
import { breachLabel, scoreBand, type Signal } from "@/lib/labels";
import { expectedCount, isLate, scoreBreakdown, type PerformanceLog, type PerformanceMetric, type PerformanceRecords, type PerformanceSummary, type PerformanceTask } from "@/lib/my-performance";
import { fmt, fmtDate } from "@/lib/time";
import { cn, pct } from "@/lib/utils";

/**
 * My Performance click-through. Every figure on the page opens the records it counts, for the window the page
 * shows. Records arrive from the server already limited to the signed-in user (and to what RLS lets them read);
 * this component only presents them — the figures themselves still come from my_performance.
 */
type Ctx = { open: (m: PerformanceMetric) => void };
const MetricContext = React.createContext<Ctx | null>(null);
const useMetric = () => {
  const c = React.useContext(MetricContext);
  if (!c) throw new Error("Metric buttons must be inside <MyPerformanceDetails>");
  return c;
};

const TITLES: Record<PerformanceMetric, string> = {
  score: "Score", completed: "Completed", ontime: "On time", red: "Red marks",
  assigned: "Tasks assigned", late: "Completed late", daily: "Daily updates",
};

const signalText: Record<Signal, string> = {
  red: "text-signal-red", amber: "text-signal-amber", green: "text-signal-green", neutral: "text-ink", done: "text-ink-soft",
};

/** A summary card that opens its records — looks like the page's other clickable cards (Kpi with a link). */
export function MetricCard({ metric, label, value, signal = "neutral" }: { metric: PerformanceMetric; label: string; value: React.ReactNode; signal?: Signal }) {
  const { open } = useMetric();
  return (
    <button type="button" onClick={() => open(metric)} aria-haspopup="dialog" aria-label={`${label}: ${value}. Show records`}
      className="block w-full rounded-lg border border-line bg-panel px-4 py-4 text-left hover:border-steel focus-visible:border-steel focus-visible:outline-none">
      <span className={cn("block text-3xl font-semibold leading-none", signalText[signal])}>{value}</span>
      <span className="mt-2 block text-sm text-ink-soft">{label}</span>
    </button>
  );
}

/** A Details figure that opens its records; the dotted underline is the app's "this figure opens" mark. */
export function MetricValue({ metric, value }: { metric: PerformanceMetric; value: React.ReactNode }) {
  const { open } = useMetric();
  return (
    <button type="button" onClick={() => open(metric)} aria-haspopup="dialog" aria-label={`${TITLES[metric]}: ${value}. Show records`}
      className="underline decoration-dotted underline-offset-4 hover:text-steel hover:decoration-solid">
      {value}
    </button>
  );
}

/** The Details label: also opens the records (mouse convenience; the figure next to it is the keyboard stop). */
export function MetricLabel({ metric, children }: { metric: PerformanceMetric; children: React.ReactNode }) {
  const { open } = useMetric();
  return <span role="presentation" onClick={() => open(metric)} className="cursor-pointer hover:text-steel">{children}</span>;
}

export function MyPerformanceDetails({ children, records, summary, weights, window: w, loadError }: {
  children: React.ReactNode; records: PerformanceRecords; summary: PerformanceSummary;
  weights: { onTime: number; clean: number }; window: { from: string; to: string }; loadError: boolean;
}) {
  const [metric, setMetric] = React.useState<PerformanceMetric | null>(null);
  const ctx = React.useMemo<Ctx>(() => ({ open: setMetric }), []);
  const range = `${fmtDate(w.from)} – ${fmtDate(w.to)}`;
  return (
    <MetricContext.Provider value={ctx}>
      {children}
      <Dialog open={metric !== null} onOpenChange={(o) => { if (!o) setMetric(null); }}>
        {metric ? (
          <DialogContent title={TITLES[metric]} description={`${describe(metric, summary)} · ${range}`} className="max-w-4xl">
            {loadError ? (
              <p role="alert" className="mb-3 rounded-md border border-signal-red/40 bg-signal-red/5 px-3 py-2 text-sm text-signal-red">
                Some records could not be loaded. Reload the page to try again.
              </p>
            ) : null}
            {metric === "score"
              ? <ScoreDetails summary={summary} records={records} weights={weights} />
              : <MetricRecords metric={metric} records={records} summary={summary} />}
          </DialogContent>
        ) : null}
      </Dialog>
    </MetricContext.Provider>
  );
}

function describe(m: PerformanceMetric, s: PerformanceSummary): string {
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  switch (m) {
    case "score": return s.score == null ? "No score yet" : `Score ${s.score} · ${scoreBand(s.score).label}`;
    case "completed": return `${n(s.completed, "task")} completed in this period`;
    case "ontime": return `${Math.max(0, s.completed - s.late)} of ${n(s.completed, "completed task")} finished by the deadline (${pct(s.on_time_pct)})`;
    case "red": return `${n(s.red_events, "red mark")} recorded in this period`;
    case "assigned": return `${n(s.assigned, "task")} assigned to you in this period`;
    case "late": return `${n(s.late, "task")} completed after the deadline`;
    case "daily": return `${n(s.daily_updates, "daily update")} recorded in this period`;
  }
}

const EMPTY: Record<Exclude<PerformanceMetric, "score">, [string, string]> = {
  completed: ["No completed tasks", "You didn't complete any tasks in the selected dates."],
  ontime: ["No tasks completed on time", "None of your tasks were completed by their deadline in the selected dates."],
  red: ["No red marks", "No red marks were recorded against you in the selected dates."],
  assigned: ["No tasks assigned", "No tasks were assigned to you in the selected dates."],
  late: ["No late completions", "None of your tasks were completed after their deadline in the selected dates."],
  daily: ["No daily updates", "No daily updates were recorded for you in the selected dates."],
};

function MetricRecords({ metric, records, summary }: { metric: Exclude<PerformanceMetric, "score">; records: PerformanceRecords; summary: PerformanceSummary }) {
  const rows = records[metric];
  const hidden = Math.max(0, expectedCount(metric, summary) - rows.length);
  return (
    <>
      {rows.length === 0 ? <EmptyState title={EMPTY[metric][0]}>{hidden ? null : EMPTY[metric][1]}</EmptyState>
        : metric === "red" || metric === "daily" ? <LogRecords kind={metric} rows={rows as PerformanceLog[]} />
        : <TaskRecords kind={metric} rows={rows as PerformanceTask[]} />}
      <HiddenNote count={hidden} />
    </>
  );
}

/** Counted by the score but not readable by the viewer (a project they are no longer a member of). */
function HiddenNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <p className="mt-3 text-sm text-ink-soft">
      {count === 1 ? "1 more record is" : `${count} more records are`} counted in this figure but can&apos;t be shown, because
      {count === 1 ? " it belongs" : " they belong"} to a project you no longer have access to.
    </p>
  );
}

const statusSignal = (s: string): Signal => (s === "Completed" ? "done" : s === "Blocked" ? "red" : "neutral");

function TaskName({ t }: { t: PerformanceTask }) {
  return (
    <Link href={`/projects/${t.project_id}/tasks/${t.id}`} className="hover:text-steel hover:underline">
      <span className="font-mono text-xs text-ink-soft">{t.code}</span> <span className="font-medium">{t.title}</span>
    </Link>
  );
}
function ProjectName({ code, name }: { code: string | null; name?: string | null }) {
  if (!code && !name) return <span className="text-ink-faint">—</span>;
  return <span className="whitespace-nowrap" title={name ?? undefined}>{code ?? name}</span>;
}

/** "2 d 3 h" after the deadline. */
function lateBy(t: PerformanceTask): string {
  const ms = new Date(t.completed_on!).getTime() - new Date(t.effective_due_at!).getTime();
  const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
  return d ? `${d} d ${h % 24} h` : h ? `${h} h` : `${Math.max(1, Math.round(ms / 6e4))} min`;
}

function TaskRecords({ kind, rows }: { kind: "assigned" | "completed" | "ontime" | "late"; rows: PerformanceTask[] }) {
  const done = kind !== "assigned";
  return (
    <Table>
      <thead>
        <tr>
          <th>Task</th><th>Project</th>
          {done ? null : <th>Assigned</th>}
          <th>Deadline</th>
          {done ? <th>Completed</th> : null}
          {kind === "late" ? <th>Late by</th> : null}
          <th>{done ? "Result" : "Status"}</th>
          {done ? null : <th className="text-right">Progress</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td><TaskName t={t} /></td>
            <td><ProjectName code={t.project_code} name={t.project_name} /></td>
            {done ? null : <td className="whitespace-nowrap">{fmt(t.assigned_on, "dd MMM yyyy")}</td>}
            <td className="whitespace-nowrap">{fmt(t.effective_due_at, "dd MMM yyyy, HH:mm")}</td>
            {done ? <td className="whitespace-nowrap">{fmt(t.completed_on, "dd MMM yyyy, HH:mm")}</td> : null}
            {kind === "late" ? <td className="whitespace-nowrap text-signal-red">{lateBy(t)}</td> : null}
            <td>{done
              ? (isLate(t) ? <Badge signal="red">Late</Badge> : <Badge signal="green">On time</Badge>)
              : <Badge signal={statusSignal(t.status)}>{t.status}</Badge>}</td>
            {done ? null : <td className="text-right tabular-nums">{pct(t.progress_pct)}</td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LogRecords({ kind, rows }: { kind: "red" | "daily"; rows: PerformanceLog[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th>Date</th><th>Project</th><th>Task</th>
          {kind === "red" ? <th>Reason</th> : null}
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.id}>
            <td className="whitespace-nowrap">{fmt(l.ts, "dd MMM yyyy, HH:mm")}</td>
            <td><ProjectName code={l.project_code} /></td>
            <td>
              {l.task_code || l.task_title ? (
                <>
                  {l.task_code ? <span className="font-mono text-xs text-ink-soft">{l.task_code}</span> : null}
                  {l.task_title ? <> <span className="font-medium">{l.task_title}</span></> : null}
                </>
              ) : <span className="text-ink-faint">—</span>}
            </td>
            {kind === "red" ? <td>{l.reason_code ? <Badge signal="red">{breachLabel[l.reason_code]}</Badge> : "—"}</td> : null}
            <td className="text-ink-soft">{l.details ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** How the score was reached: its two parts with the actual figures, then the records behind each part. */
function ScoreDetails({ summary: s, records, weights }: { summary: PerformanceSummary; records: PerformanceRecords; weights: { onTime: number; clean: number } }) {
  const b = scoreBreakdown(s, weights);
  if (s.score == null || !b) {
    return <EmptyState title="No score for these dates">The score is calculated once you complete at least one task in the selected dates.</EmptyState>;
  }
  const one = (x: number) => x.toFixed(1);
  return (
    <div className="space-y-5">
      <Table>
        <thead><tr><th>Part</th><th>Your figures</th><th className="text-right">Rate</th><th className="text-right">Weight</th><th className="text-right">Points</th></tr></thead>
        <tbody>
          <tr>
            <td className="font-medium">On time</td>
            <td>{s.completed - s.late} of {s.completed} completed tasks finished by the deadline</td>
            <td className="text-right tabular-nums">{pct(b.onTimeRate * 100, 1)}</td>
            <td className="text-right tabular-nums">{pct(weights.onTime * 100)}</td>
            <td className="text-right tabular-nums">{one(b.onTimePoints)}</td>
          </tr>
          <tr>
            <td className="font-medium">Clean days</td>
            <td>{s.red_events} red mark{s.red_events === 1 ? "" : "s"} against {s.assigned} task{s.assigned === 1 ? "" : "s"} assigned</td>
            <td className="text-right tabular-nums">{pct(b.cleanRate * 100, 1)}</td>
            <td className="text-right tabular-nums">{pct(weights.clean * 100)}</td>
            <td className="text-right tabular-nums">{one(b.cleanPoints)}</td>
          </tr>
          <tr>
            <td className="font-semibold">Score</td><td className="text-ink-soft">Points added together and rounded</td><td /><td />
            <td className="text-right text-base font-semibold tabular-nums">{s.score}</td>
          </tr>
        </tbody>
      </Table>
      <div>
        <h3 className="mb-2 text-[15px] font-semibold">Completed tasks ({records.completed.length})</h3>
        {records.completed.length ? <TaskRecords kind="completed" rows={records.completed} /> : <EmptyState title={EMPTY.completed[0]} />}
        <HiddenNote count={Math.max(0, s.completed - records.completed.length)} />
      </div>
      <div>
        <h3 className="mb-2 text-[15px] font-semibold">Red marks ({records.red.length})</h3>
        {records.red.length ? <LogRecords kind="red" rows={records.red} /> : <EmptyState title={EMPTY.red[0]}>{EMPTY.red[1]}</EmptyState>}
      </div>
    </div>
  );
}
