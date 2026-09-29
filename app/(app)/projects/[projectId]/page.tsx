import Link from "next/link";
import { projectContext } from "@/lib/auth/project-guard";
import { getProjectProgress } from "@/lib/data/projects";
import { projectReportFeed } from "@/lib/data/reports";
import { createClient } from "@/lib/supabase/server";
import { Kpi, Meter, Section } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtDay } from "@/lib/time";
import { pct } from "@/lib/utils";

export default async function ProjectOverview({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { s, project: p } = await projectContext(projectId);
  const supabase = await createClient();
  const [progress, feed, mine] = await Promise.all([
    getProjectProgress(projectId),
    projectReportFeed(projectId),
    s.memberProjectIds.includes(projectId) ? supabase.rpc("my_contribution", { p_project: projectId }) : Promise.resolve({ data: null }),
  ]);
  const c = mine.data?.[0];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Completion" value={pct(progress?.completion_pct)} />
        <Kpi label="Planned by today" value={pct(progress?.planned_pct)} signal={progress?.planned_pct != null && (progress?.completion_pct ?? 0) < progress.planned_pct ? "amber" : "neutral"} />
        <Kpi label="Open tasks" value={progress?.open_tasks ?? 0} href={`/projects/${projectId}/tasks`} />
        <Kpi label="Members" value={progress?.members ?? 0} href={`/projects/${projectId}/members`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Progress">
          <Meter value={progress?.completion_pct} planned={progress?.planned_pct} label="Project completion" />
          <p className="mt-2 text-sm text-ink-soft">{progress?.completed_tasks ?? 0} of {progress?.tasks_total ?? 0} tasks completed. The dark tick marks where the schedule says the project should be.</p>
          {c ? <p className="mt-4 text-[15px]">Your share is <strong>{pct(c.share_pct, 1)}</strong> of the project; you've delivered <strong>{pct(c.delivered_pct, 1)}</strong>.</p> : null}
          {p.description ? <p className="mt-4 whitespace-pre-wrap text-[15px]">{p.description}</p> : null}
          <dl className="mt-4 grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-ink-soft">Start</dt><dd>{fmtDate(p.start_date)}</dd>
            <dt className="text-ink-soft">Target end</dt><dd>{fmtDate(p.target_end)}</dd>
            <dt className="text-ink-soft">Status</dt><dd>{p.status}</dd>
          </dl>
        </Section>
        <Section title="Recent daily reports" aside={<Link href={`/projects/${projectId}/daily-reports`} className="text-sm text-steel hover:underline">All reports</Link>}>
          {feed.length ? (
            <ul className="divide-y divide-line-soft">
              {feed.slice(0, 6).map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link href={`/daily-reports/${r.id}`} className="font-medium hover:text-steel hover:underline">{r.author?.full_name}</Link>
                  <span className="ml-2 text-sm text-ink-soft">{fmtDay(r.report_date)}</span>
                  <p className="line-clamp-2 text-sm">{r.update_text}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-soft">No reports yet.</p>}
          {s.memberProjectIds.includes(projectId) ? <LinkButton href={`/daily-reports/new?project=${projectId}`} size="sm" className="mt-4">Submit today's report</LinkButton> : null}
        </Section>
      </div>
    </div>
  );
}
