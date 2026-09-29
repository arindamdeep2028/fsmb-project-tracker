import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { listProjects } from "@/lib/data/projects";
import { PageHeader, Section } from "@/components/ui/misc";
import { ScoreTable } from "@/components/performance/score-table";
import { WindowPicker } from "@/components/window-picker";
import { daysAgo, dhakaToday } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

/** Cross-department performance export, and every project's report and daily-report export. */
export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const to = sp.to ?? dhakaToday();
  const from = sp.from ?? daysAgo(settings?.review_window_days ?? 90);
  const supabase = await createClient();
  const [{ data: people }, projects] = await Promise.all([supabase.rpc("performance_summary", { p_from: from, p_to: to }), listProjects()]);
  return (
    <>
      <PageHeader title="Reports" actions={<WindowPicker from={from} to={to} />} />
      <div className="space-y-6">
        <Section title="Performance, all departments"><ScoreTable rows={people ?? []} csvName={`fsmb-performance-all-${from}-${to}`} logBase="/admin/log?person=" /></Section>
        <Section title="Project reports">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id} className="rounded-md border border-line-soft px-3 py-2">
                <span className="font-medium">{p.code}</span> {p.name}
                <div className="mt-1 flex gap-3 text-sm"><Link href={`/projects/${p.id}/report`} className="text-steel hover:underline">Report</Link><Link href={`/projects/${p.id}/daily-reports`} className="text-steel hover:underline">Daily reports</Link><Link href={`/projects/${p.id}/log`} className="text-steel hover:underline">Log</Link></div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
