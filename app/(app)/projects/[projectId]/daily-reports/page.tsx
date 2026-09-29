import { projectContext } from "@/lib/auth/project-guard";
import { projectReportFeed } from "@/lib/data/reports";
import { getMembers } from "@/lib/data/projects";
import { ReportFeedTable } from "@/components/reports/report-feed-table";

/** Project report feed; RLS decides which reports each viewer sees. CSV for managers only. */
export default async function ProjectReportsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ user?: string; date?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { project, manages } = await projectContext(projectId);
  const [feed, members] = await Promise.all([projectReportFeed(projectId, { user: sp.user, date: sp.date }), getMembers(projectId, true)]);
  const rows = feed.map((r) => ({
    id: r.id, report_date: r.report_date, author: r.author?.full_name ?? "—", update_text: r.update_text, issues: r.issues,
    next_task_text: r.next_task_text, items: r.daily_report_items?.[0]?.count ?? 0, files: r.daily_report_attachments?.[0]?.count ?? 0, locked: r.locked,
  }));
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Engineer
          <select name="user" defaultValue={sp.user ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
            <option value="">Everyone</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
          </select>
        </label>
        <label className="text-sm">Date<input type="date" name="date" defaultValue={sp.date} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
        <button className="h-9 rounded-md border border-line bg-panel px-3 text-sm font-medium hover:border-steel">Apply</button>
      </form>
      <ReportFeedTable rows={rows} csvName={manages ? `${project.code}-daily-reports` : undefined} />
    </div>
  );
}
