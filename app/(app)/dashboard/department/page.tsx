import type { Metadata } from "next";
import { requireHeadOrAdmin } from "@/lib/auth/session";
import { getDepartmentDashboard } from "@/lib/data/dashboards";
import { getDepartments } from "@/lib/data/projects";
import { EmptyState, Kpi, PageHeader, Section } from "@/components/ui/misc";
import { ProjectHealthTable } from "@/components/dashboards/project-table";
import { ScoreTable } from "@/components/performance/score-table";
import { WindowPicker } from "@/components/window-picker";
import { describeError } from "@/lib/errors";
import { fmtDate } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Department" };

/** Department Head dashboard (Frontend Blueprint §8): department_dashboard(dept, from, to). */
export default async function DepartmentDashboard({ searchParams }: { searchParams: Promise<{ dept?: string; from?: string; to?: string }> }) {
  const s = await requireHeadOrAdmin();
  const sp = await searchParams;
  const departments = (await getDepartments()).filter((d) => s.isAdmin || s.headedDepartmentIds.includes(d.id));
  const res = await getDepartmentDashboard(sp.dept, sp.from, sp.to);
  if ("error" in res) return (<><PageHeader title="Department" /><EmptyState title="This dashboard isn't available">{describeError(res.error)}</EmptyState></>);
  const d = res.data;
  const dep = d.department;
  const picker = departments.length > 1 ? (
    <label className="text-sm">Department
      <select name="dept" defaultValue={d.window.department_id} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
        {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </label>
  ) : <input type="hidden" name="dept" value={d.window.department_id} />;
  return (
    <>
      <PageHeader title={dep?.department_name ?? "Department"} lead={`Window ${fmtDate(d.window.from)} to ${fmtDate(d.window.to)}`}
        actions={<WindowPicker from={d.window.from} to={d.window.to} extra={picker} />} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active projects" value={dep?.active_projects ?? 0} />
        <Kpi label="Department progress" value={pct(dep?.department_progress_pct)} />
        <Kpi label="Projects at risk" value={dep?.projects_at_risk ?? 0} signal={dep?.projects_at_risk ? "red" : "neutral"} />
        <Kpi label="Red tasks now" value={dep?.red_tasks ?? 0} signal={dep?.red_tasks ? "red" : "neutral"} />
      </div>
      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Window results</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tasks completed" value={dep?.completed_in_window ?? 0} />
        <Kpi label="Completed on time" value={pct(dep?.on_time_pct)} signal="green" />
        <Kpi label="Extensions granted" value={dep?.extensions_in_window ?? 0} signal={dep?.extensions_in_window ? "amber" : "neutral"} />
        <Kpi label="Red-mark events" value={dep?.red_mark_events ?? 0} signal={dep?.red_mark_events ? "red" : "neutral"} />
      </div>
      <div className="space-y-6">
        <Section title="Projects"><ProjectHealthTable projects={d.projects} /></Section>
        <Section title="People"><ScoreTable rows={d.people} csvName={`fsmb-department-${d.window.from}-${d.window.to}`} logBase={s.isAdmin ? "/admin/log?person=" : undefined} /></Section>
      </div>
    </>
  );
}
