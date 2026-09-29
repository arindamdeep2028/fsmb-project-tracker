import { projectContext } from "@/lib/auth/project-guard";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { Section, Table } from "@/components/ui/misc";
import { ScoreTable } from "@/components/performance/score-table";
import { WindowPicker } from "@/components/window-picker";
import { breachLabel } from "@/lib/labels";
import { daysAgo, dhakaToday } from "@/lib/time";
import { pct } from "@/lib/utils";

/** Project report for its managers: contribution split, member performance on this project only (v2 §14.11), open red flags. */
export default async function ProjectReportPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { project } = await projectContext(projectId, { manager: true });
  const settings = await getSettings();
  const to = sp.to ?? dhakaToday();
  const from = sp.from ?? daysAgo(settings?.review_window_days ?? 90);
  const supabase = await createClient();
  const [contrib, perf, flags] = await Promise.all([
    supabase.rpc("member_contribution", { p_project: projectId }),
    supabase.rpc("project_performance", { p_project: projectId, p_from: from, p_to: to }),
    supabase.from("task_flags").select("task_id, reasons, deadline_status").eq("project_id", projectId).eq("is_red", true),
  ]);
  const redIds = (flags.data ?? []).map((f) => f.task_id).filter((x): x is string => Boolean(x));
  const { data: redTasks } = redIds.length
    ? await supabase.from("tasks").select("id, code, title, status").in("id", redIds).neq("status", "Completed").eq("archived", false).order("code")
    : { data: [] as { id: string; code: string; title: string; status: string }[] };
  const reasonsById = new Map((flags.data ?? []).map((f) => [f.task_id, f.reasons ?? []]));
  return (
    <div className="space-y-6">
      <Section title="Who carries what">
        <Table>
          <thead><tr><th>Person</th><th>Role</th><th>Open tasks</th><th>Share of project</th><th>Delivered</th><th>Personal progress</th></tr></thead>
          <tbody>
            {(contrib.data ?? []).map((m) => (
              <tr key={m.user_id}><td className="font-medium">{m.full_name}</td><td>{m.member_role === "pm" ? "PM" : "Engineer"}</td><td>{m.open_tasks}</td>
                <td>{pct(m.share_pct, 1)}</td><td>{pct(m.delivered_pct, 1)}</td><td>{pct(m.personal_progress)}</td></tr>
            ))}
          </tbody>
        </Table>
      </Section>
      <Section title="Member performance on this project" aside={<WindowPicker from={from} to={to} />}>
        <ScoreTable rows={perf.data ?? []} csvName={`${project.code}-performance-${from}-${to}`} />
      </Section>
      <Section title="Red flags now">
        {redTasks?.length ? (
          <ul className="divide-y divide-line-soft">
            {redTasks.map((t) => (
              <li key={t.id} className="rail rail-red py-2.5 pl-4">
                <a href={`/projects/${projectId}/tasks/${t.id}`} className="font-medium hover:text-steel hover:underline">{t.code} {t.title}</a>
                <p className="text-sm text-signal-red">{(reasonsById.get(t.id) ?? []).map((r) => breachLabel[r]).join(" · ")}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-soft">No red flags.</p>}
      </Section>
    </div>
  );
}
