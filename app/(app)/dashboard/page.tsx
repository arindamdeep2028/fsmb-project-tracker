import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChartColumn, FileText, Layers } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getEngineerStatusData, getMyDashboard } from "@/lib/data/dashboards";
import { getOverdueReports } from "@/lib/data/overdue";
import { OverdueReports } from "@/components/reports/overdue-reports";
import { AnnouncementBanner } from "@/components/announcements/banner";
import { CountLink } from "@/components/ui/misc";
import { TaskList } from "@/components/lists/task-list";
import { DeliveredTrend, StatusBars, StatusDonut } from "@/components/dashboards/engineer-charts";
import { BUCKET_COLOR, statusBreakdown, weekStart, weekTaskStatus } from "@/lib/dashboard-status";
import { deadlineSignal, deadlineStatusLabel } from "@/lib/labels";
import { dhakaToday, fmt, fmtDay } from "@/lib/time";
import { cn, pct } from "@/lib/utils";

export const metadata: Metadata = { title: "My Dashboard" };

const card = "rounded-xl border border-line bg-panel/90 shadow-[0_1px_2px_rgba(38,51,43,0.06)] backdrop-blur-[1px]";
const RAIL: Record<string, string> = { red: "bg-signal-red", amber: "bg-signal-amber", green: "bg-signal-green", neutral: "bg-signal-neutral", done: "bg-line" };

/** A card's title row: icon, title and an optional note or badge. */
function CardHead({ icon, title, note, aside }: { icon: React.ReactNode; title: string; note?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-steel" aria-hidden>{icon}</span>
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {note ? <span className="text-sm text-ink-soft">({note})</span> : null}
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  );
}

/** A KPI card: the figure (in its signal colour) and its label; opens the records behind it when there are any. */
function KpiCard({ label, value, tone, href }: { label: string; value: number; tone: string; href?: string }) {
  const body = (<><div className={cn("text-[34px] font-bold leading-none", tone)}>{value}</div><div className="mt-3 text-[15px] text-ink-soft">{label}</div></>);
  const cls = cn(card, "block px-6 py-5");
  return href ? <Link href={href} data-testid="kpi" className={cn(cls, "transition-colors hover:border-steel")}>{body}</Link> : <div data-testid="kpi" className={cls}>{body}</div>;
}

/**
 * Engineer dashboard ("My Dashboard"): one RPC, my_dashboard(), for every figure it showed before; the two status
 * panels count the stored status of tasks (read-only, the viewer's own access). Nothing here calculates progress.
 */
export default async function EngineerDashboard() {
  const s = await requireSession();
  const today = dhakaToday();
  const from = weekStart(today);
  const [d, overdue] = await Promise.all([getMyDashboard(), getOverdueReports({ userId: s.userId })]);
  const status = await getEngineerStatusData(s.userId, d.projects.map((p) => p.project_id).filter((x): x is string => Boolean(x)), from);
  const due = d.projects.filter((p) => p.report_expected_today && !p.report_submitted_today);
  const open = d.assigned_tasks.filter((t) => t.status !== "Completed");
  const projectOf = new Map(d.assigned_tasks.map((t) => [t.task_id, t.project_id]));
  const slices = statusBreakdown(status.itemStatuses);
  const week = weekTaskStatus(open.map((t) => ({ status: t.status ?? "" })), status.completedDates, from);

  return (
    <div className="relative isolate" data-testid="engineer-dashboard">
      {/* the FSM logo as a faint watermark behind the content */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a static decorative image */}
      <img src="/brand/fsm-logo.png" alt="" aria-hidden data-testid="fsm-watermark"
        className="pointer-events-none absolute left-1/2 top-24 -z-10 w-[min(760px,85%)] -translate-x-1/2 select-none opacity-[0.07]" />

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Hello, {s.profile.full_name.split(" ")[0]}</h1>
        <p className="mt-0.5 text-ink-soft">{fmtDay(today)}, Dhaka time</p>
      </header>

      <div className="space-y-3">
        <AnnouncementBanner compact />
        <OverdueReports items={overdue} canFill={s.isAdmin} own compact />
        {d.report_expected_today ? (
          due.length ? (
            <div data-testid="report-due" className={cn(card, "flex flex-wrap items-center justify-between gap-3 py-2.5 pl-4 pr-3")}>
              <p className="flex items-center gap-3 text-[15px]"><FileText size={20} aria-hidden className="shrink-0 text-ink" /><span><span className="font-semibold">Today&apos;s report is due</span> for {due.map((p) => p.code).join(", ")}.</span></p>
              <Link href={`/daily-reports/new?project=${due[0].project_id}`} className="rounded-md bg-steel px-4 py-2 text-sm font-semibold text-white hover:bg-steel-dark">Submit report</Link>
            </div>
          ) : null
        ) : (
          <div className={cn(card, "px-4 py-2.5 text-ink-soft")}>Saturday and Sunday are non-working days. No report is due today.</div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Open tasks" value={open.length} tone="text-steel" href="/my-tasks" />
        <KpiCard label="Red marks now" value={d.red_now} tone={d.red_now ? "text-signal-red" : "text-ink"} href="/my-tasks?filter=red" />
        <KpiCard label="Completed on time (window)" value={d.on_time} tone="text-signal-green" href={d.on_time ? "/my-tasks?filter=ontime&recent=1" : undefined} />
        <KpiCard label="Completed late (window)" value={d.late} tone={d.late ? "text-signal-amber" : "text-ink"} href={d.late ? "/my-tasks?filter=late&recent=1" : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.05fr)]">
        <section className={cn(card, "p-5")} aria-label="Project Completion" data-testid="panel-completion">
          <CardHead icon={<CalendarCheck size={22} />} title="Project Completion" note="All Projects" />
          <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-5">
            <StatusDonut slices={slices} />
            <ul className="space-y-1.5 text-sm">
              {slices.map((x) => (
                <li key={x.bucket} data-testid="completion-row" className="flex items-center gap-2.5 rounded-md bg-paper/80 px-2.5 py-1.5" title={`${x.count} ${x.count === 1 ? "item" : "items"}`}>
                  <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[x.bucket] }} />
                  <span className="flex-1">{x.bucket}</span>
                  <span className="font-semibold tabular-nums">{x.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Share of the work items (tasks and subtasks) in your projects, by status.</p>
        </section>

        <section className={cn(card, "p-5")} aria-label="Task Status" data-testid="panel-task-status">
          <CardHead icon={<Layers size={22} />} title="Task Status" note="This Week" />
          <div className="mt-3"><StatusBars counts={week} /></div>
          <p className="mt-1 text-xs text-ink-soft">Your tasks: completed since Monday; the rest as they stand now.</p>
        </section>

        <section className={cn(card, "p-5 lg:col-span-2 xl:col-span-1")} aria-label="Progress I delivered, last 30 days" data-testid="panel-delivered">
          <CardHead icon={<ChartColumn size={22} />} title="Progress I delivered, last 30 days" />
          <div className="mt-3"><DeliveredTrend data={d.progress_trend_30d} /></div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={cn(card, "p-5")} aria-label="Coming Up" data-testid="panel-coming-up">
          <CardHead icon={<CalendarCheck size={22} />} title="Coming Up"
            aside={<span className="rounded-md bg-steel-wash px-2.5 py-1 text-sm font-semibold text-steel">{d.deadlines.length} {d.deadlines.length === 1 ? "task" : "tasks"}</span>} />
          {d.deadlines.length ? (
            <ul className="mt-3 divide-y divide-line-soft">
              {d.deadlines.map((x) => {
                const pid = projectOf.get(x.task_id);
                const title = <><span className="truncate">{x.title}</span><span className="ml-2 shrink-0 text-xs text-ink-soft">{x.project_code}</span></>;
                return (
                  <li key={x.task_id} data-testid="coming-up-row" className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
                    <span className="text-ink-soft">{x.code}</span>
                    {pid ? <Link href={`/projects/${pid}/tasks/${x.task_id}`} className="flex min-w-0 items-baseline hover:text-steel hover:underline">{title}</Link> : <span className="flex min-w-0 items-baseline">{title}</span>}
                    <span className="flex items-center gap-2 whitespace-nowrap font-medium" title={deadlineStatusLabel[x.deadline_status] ?? x.deadline_status}>
                      <span aria-hidden className={cn("h-4 w-1 rounded-full", RAIL[deadlineSignal(x.deadline_status)])} />
                      {fmt(x.effective_due_at, "d MMM, HH:mm")}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-sm text-ink-soft">Nothing due in the next 7 days.</p>}
        </section>

        <section className={cn(card, "p-5")} aria-label="My Projects" data-testid="panel-my-projects">
          <CardHead icon={<Layers size={22} />} title="My Projects"
            aside={<span className="rounded-md bg-steel-wash px-2.5 py-1 text-sm font-semibold text-steel">Overall {pct(d.overall_completion_pct)}</span>} />
          {d.projects.length ? (
            <ul className="mt-3 space-y-3">
              {d.projects.map((p) => {
                const v = Math.max(0, Math.min(100, Number(p.project_completion_pct ?? 0)));
                return (
                  <li key={p.project_id} data-testid="project-row">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,40%)_3rem] items-center gap-3">
                      <Link href={`/projects/${p.project_id}`} className="truncate font-semibold hover:text-steel hover:underline">{p.code} {p.name}</Link>
                      <div className="h-2.5 rounded-full bg-line-soft" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={`${p.code} completion`}>
                        <div className="h-2.5 rounded-full bg-steel" style={{ width: `${Math.max(v, v > 0 ? 3 : 0)}%` }} />
                      </div>
                      <span className="text-right font-semibold tabular-nums">{pct(p.project_completion_pct)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                      <span>My share {pct(p.share_pct, 1)} · delivered {pct(p.delivered_pct, 1)} · <CountLink href={`/projects/${p.project_id}/tasks?filter=open&user=${s.userId}`} value={p.my_open_tasks} label={`${p.code} my open tasks`}>{p.my_open_tasks} open</CountLink></span>
                      <Link href={`/projects/${p.project_id}/tasks`} className="text-steel hover:underline">Tasks</Link>
                      <Link href={`/daily-reports/new?project=${p.project_id}`} className="text-steel hover:underline">{p.report_submitted_today ? "Edit today's update" : "Daily update"}</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-sm text-ink-soft">You&apos;re not on a project yet. Your PM adds you.</p>}
        </section>
      </div>

      {/* kept from the previous layout: tasks waiting for a plan or a start */}
      <section className={cn(card, "mt-4 p-5")} aria-label="Waiting on you" data-testid="panel-waiting">
        <CardHead icon={<FileText size={20} />} title="Waiting on you" aside={<Link href="/my-tasks" className="text-sm text-steel hover:underline">All my tasks</Link>} />
        <div className="mt-2"><TaskList tasks={d.pending_tasks} empty="No tasks waiting for a plan or a start." /></div>
      </section>
    </div>
  );
}
