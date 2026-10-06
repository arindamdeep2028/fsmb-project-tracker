import type { Metadata } from "next";
import { requireHeadOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPerformance } from "@/lib/performance";
import { PageHeader } from "@/components/ui/misc";
import { FormMessage } from "@/components/ui/form";
import { WindowPicker } from "@/components/window-picker";
import { ScoreTable } from "@/components/performance/score-table";
import { daysAgo, dhakaToday } from "@/lib/time";

export const metadata: Metadata = { title: "Performance" };

/**
 * Department Head (one department they head, the first by default) and Admin (all, or one). Which department is
 * shown and what a failed query means are decided in lib/performance.ts; performance_summary enforces the same
 * department rule in the database. A failed load shows an error in place of the table, never "no activity".
 */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; dept?: string }> }) {
  const s = await requireHeadOrAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const v = await loadPerformance(s, sp, {
    today: dhakaToday(),
    daysAgo,
    windowDays: async () => (await supabase.from("workspace_settings").select("review_window_days").eq("id", 1).maybeSingle()).data?.review_window_days ?? null,
    departments: async () => supabase.from("departments").select("id, name").order("sort_order").order("name"),
    summary: async (args) => supabase.rpc("performance_summary", args),
  });
  const select = (
    <label className="text-sm">Department
      <select name="dept" defaultValue={v.departmentId ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2">
        {s.isAdmin ? <option value="">All departments</option> : null}
        {v.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <PageHeader title="Performance" lead="Scores for the chosen window. Open a person to see their log." actions={<WindowPicker from={v.from} to={v.to} extra={select} />} />
      {v.rows
        ? <ScoreTable rows={v.rows} csvName={`fsmb-performance-${v.from}-${v.to}`} logBase={s.isAdmin ? "/admin/log?person=" : undefined} />
        : <div data-testid="performance-error"><FormMessage result={{ ok: false, message: v.error ?? "The performance scores couldn't be loaded." }} /></div>}
    </>
  );
}
