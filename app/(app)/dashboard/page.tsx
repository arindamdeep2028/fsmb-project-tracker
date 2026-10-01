import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getMyDashboard } from "@/lib/data/dashboards";
import { Kpi, Meter, PageHeader, Section } from "@/components/ui/misc";
import { TaskList } from "@/components/lists/task-list";
import { ProgressTrend } from "@/components/data/charts";
import { DeadlineChip } from "@/components/tasks/deadline";
import { dhakaToday, fmtDay } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "My Dashboard" };

/** Engineer dashboard (Frontend Blueprint §6): one RPC, my_dashboard(). */
export default async function EngineerDashboard() {
  const s = await requireSession();
  const d = await getMyDashboard();
  const due = d.projects.filter((p) => p.report_expected_today && !p.report_submitted_today);
  const open = d.assigned_tasks.filter((t) => t.status !== "Completed");
  return (
    <>
      <PageHeader title={`Hello, ${s.profile.full_name.split(" ")[0]}`} lead={`${fmtDay(dhakaToday())}, Dhaka time`} />

      {d.report_expected_today ? (
        due.length ? (
          <div className="rail rail-amber mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel py-3 pl-5 pr-4">
            <p><span className="font-medium">Today's report is due</span> for {due.map((p) => p.code).join(", ")}.</p>
            <Link href={`/daily-reports/new?project=${due[0].project_id}`} className="rounded-md bg-steel px-3 py-1.5 text-sm font-medium text-white hover:bg-steel-dark">Submit report</Link>
          </div>
        ) : null
      ) : (
        <div className="mb-6 rounded-lg border border-line bg-panel px-4 py-3 text-ink-soft">Saturday and Sunday are non-working days. No report is due today.</div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open tasks" value={open.length} href="/my-tasks" />
        <Kpi label="Red marks now" value={d.red_now} signal={d.red_now ? "red" : "neutral"} href="/my-tasks?filter=red" />
        <Kpi label="Completed on time (window)" value={d.on_time} signal="green" />
        <Kpi label="Completed late (window)" value={d.late} signal={d.late ? "amber" : "neutral"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="Coming up">
            {d.deadlines.length ? (
              <ul className="divide-y divide-line-soft">
                {d.deadlines.map((x) => (
                  <li key={x.task_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span><span className="mr-1.5 text-ink-soft">{x.code}</span>{x.title}<span className="ml-2 text-xs text-ink-soft">{x.project_code}</span></span>
                    <DeadlineChip due={x.effective_due_at} status={x.deadline_status} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-soft">Nothing due in the next 7 days.</p>}
          </Section>
          <Section title="Waiting on you" aside={<Link href="/my-tasks" className="text-sm text-steel hover:underline">All my tasks</Link>}>
            <TaskList tasks={d.pending_tasks} empty="No tasks waiting for a plan or a start." />
          </Section>
          <Section title="Progress I delivered, last 30 days"><ProgressTrend data={d.progress_trend_30d} /></Section>
        </div>
        <Section title="My projects" aside={<span className="text-sm text-ink-soft">Overall {pct(d.overall_completion_pct)}</span>}>
          {d.projects.length ? (
            <ul className="space-y-4">
              {d.projects.map((p) => (
                <li key={p.project_id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <Link href={`/projects/${p.project_id}`} className="font-medium hover:text-steel hover:underline">{p.code} {p.name}</Link>
                    <span className="text-sm text-ink-soft">{pct(p.project_completion_pct)}</span>
                  </div>
                  <Meter value={p.project_completion_pct} label={`${p.code} completion`} />
                  <div className="mt-1 text-xs text-ink-soft">My share {pct(p.share_pct, 1)} · delivered {pct(p.delivered_pct, 1)} · {p.my_open_tasks} open</div>
                  <div className="mt-1 flex gap-3 text-sm">
                    <Link href={`/projects/${p.project_id}/tasks`} className="text-steel hover:underline">Tasks</Link>
                    <Link href={`/daily-reports/new?project=${p.project_id}`} className="text-steel hover:underline">{p.report_submitted_today ? "Edit today's update" : "Daily update"}</Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-soft">You're not on a project yet. Your PM adds you.</p>}
        </Section>
      </div>
    </>
  );
}
