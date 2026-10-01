import { projectContext } from "@/lib/auth/project-guard";
import { projectDailyLog } from "@/lib/data/reports";
import { getMembers } from "@/lib/data/projects";
import { getSettings } from "@/lib/data/admin";
import { DailyLogTable } from "@/components/reports/daily-log-table";
import { DailyLogCsv } from "@/components/reports/daily-log-csv";
import { LinkButton } from "@/components/ui/button";
import { daysAgo, dhakaToday } from "@/lib/time";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The project's Daily Follow Up (workbook layout). Every member reads every member's updates (RLS); CSV for managers. */
export default async function ProjectReportsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>; searchParams: Promise<{ user?: string; from?: string; to?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { s, project, manages } = await projectContext(projectId);
  const today = dhakaToday();
  let to = sp.to && ISO.test(sp.to) ? sp.to : today;
  let from = sp.from && ISO.test(sp.from) ? sp.from : daysAgo(13);
  if (from > to) [from, to] = [to, from];
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 92) from = new Date(Date.parse(to) - 92 * 864e5).toISOString().slice(0, 10);
  const [members, settings] = await Promise.all([getMembers(projectId, true), getSettings()]);
  const who = members.find((m) => m.user_id === sp.user);
  const rows = await projectDailyLog(project, { from, to, user: who ? { id: who.user_id, name: who.full_name } : null, workdays: settings?.workdays });
  const isMember = s.memberProjectIds.includes(projectId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Assigned To
            <select name="user" defaultValue={who?.user_id ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
              <option value="">Everyone</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="text-sm">From<input type="date" name="from" defaultValue={from} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={to} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
          <button className="h-9 rounded-md border border-line bg-panel px-3 text-sm font-medium hover:border-steel">Apply</button>
        </form>
        <div className="flex gap-2">
          {manages ? <DailyLogCsv rows={rows} name={`${project.code}-daily-follow-up-${from}-to-${to}`} /> : null}
          {isMember && !project.archived ? <LinkButton href={`/daily-reports/new?project=${projectId}`} variant="primary" size="sm">Today's update</LinkButton> : null}
        </div>
      </div>
      <DailyLogTable rows={rows} />
    </div>
  );
}
