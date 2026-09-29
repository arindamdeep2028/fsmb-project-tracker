import type { Metadata } from "next";
import { requireHeadOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { getDepartments } from "@/lib/data/projects";
import { PageHeader } from "@/components/ui/misc";
import { WindowPicker } from "@/components/window-picker";
import { ScoreTable } from "@/components/performance/score-table";
import { daysAgo, dhakaToday } from "@/lib/time";

export const metadata: Metadata = { title: "Performance" };

/** Department Head (own departments) and Admin (all). */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; dept?: string }> }) {
  const s = await requireHeadOrAdmin();
  const sp = await searchParams;
  const settings = await getSettings();
  const to = sp.to ?? dhakaToday();
  const from = sp.from ?? daysAgo(settings?.review_window_days ?? 90);
  const departments = (await getDepartments()).filter((d) => s.isAdmin || s.headedDepartmentIds.includes(d.id));
  const supabase = await createClient();
  const { data } = await supabase.rpc("performance_summary", { p_from: from, p_to: to, ...(sp.dept ? { p_department: sp.dept } : {}) });
  const select = (
    <label className="text-sm">Department
      <select name="dept" defaultValue={sp.dept ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
        <option value="">{s.isAdmin ? "All departments" : "All my departments"}</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <PageHeader title="Performance" lead="Scores for the chosen window. Open a person to see their log." actions={<WindowPicker from={from} to={to} extra={select} />} />
      <ScoreTable rows={data ?? []} csvName={`fsmb-performance-${from}-${to}`} logBase={s.isAdmin ? "/admin/log?person=" : undefined} />
    </>
  );
}
