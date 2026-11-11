import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { myPerformanceRecords } from "@/lib/data/my-performance";
import { loadPersonPerformance } from "@/lib/person-performance";
import { PageHeader, Section } from "@/components/ui/misc";
import { FormMessage } from "@/components/ui/form";
import { MetricCard, MetricLabel, MetricValue, MyPerformanceDetails } from "@/components/performance/my-performance-details";
import { WindowPicker } from "@/components/window-picker";
import { roleLabel, scoreBand } from "@/lib/labels";
import { daysAgo, dhakaToday } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person's performance, opened by an Admin from the Performance overview. Same cards, Details and record
 * dialogs as My Performance, for the chosen person and dates. Admin only: the middleware refuses the route to
 * every other role, requireAdmin checks the live profile, and performance_summary refuses a non-admin in the
 * database. The access decision and the figures are in lib/person-performance.ts.
 */
export default async function PersonPerformancePage({ params, searchParams }: {
  params: Promise<{ userId: string }>; searchParams: Promise<{ from?: string; to?: string; dept?: string }>;
}) {
  const s = await requireAdmin();
  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const settings = await getSettings();
  const v = await loadPersonPerformance(s, userId, sp, {
    today: dhakaToday(),
    daysAgo,
    windowDays: async () => settings?.review_window_days ?? null,
    person: async (id) => {
      const { data, error } = await supabase.from("profiles")
        .select("id, full_name, login_name, role, active, department_id, department:departments!profiles_department_id_fkey(name)")
        .eq("id", id).maybeSingle();
      return { error, data: data ? { ...data, department: data.department?.name ?? null } : null };
    },
    summary: async (args) => supabase.rpc("performance_summary", args),
    // Read under RLS as the Admin, for the chosen person only.
    records: (id, from, to) => myPerformanceRecords(id, from, to),
  });
  if (v.status === "denied") redirect("/");
  if (v.status === "notFound") notFound();

  const { person, summary: r, from, to } = v;
  const dept = sp.dept && UUID.test(sp.dept) ? sp.dept : null;
  const back = `/performance?${new URLSearchParams({ from, to, ...(dept ? { dept } : {}) })}`;
  const band = scoreBand(r?.score);
  const weights = { onTime: settings?.score_weight_on_time ?? 0.7, clean: settings?.score_weight_clean ?? 0.3 };
  const identity = [roleLabel[person.role], person.department ?? "No department", person.login_name ? `@${person.login_name}` : null, person.active ? null : "Deactivated"]
    .filter(Boolean).join(" · ");

  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-steel" data-testid="performance-back">
        <ArrowLeft size={14} aria-hidden /> Back to Performance
      </Link>
      <PageHeader
        title={person.full_name}
        lead={<>{identity}. <Link href={`/admin/log?person=${person.id}`} className="underline decoration-dotted underline-offset-4 hover:text-steel">Open their log</Link></>}
        actions={<WindowPicker from={from} to={to} extra={dept ? <input type="hidden" name="dept" value={dept} /> : null} />}
      />
      {!r ? (
        <div data-testid="person-performance-error"><FormMessage result={{ ok: false, message: v.error ?? "The performance figures couldn't be loaded." }} /></div>
      ) : (
        <MyPerformanceDetails records={v.records} summary={r} weights={weights} window={{ from, to }} loadError={v.recordsError} person={person.full_name}>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard metric="score" label={`Score · ${band.label}`} value={r.score ?? "—"} signal={band.signal} />
            <MetricCard metric="completed" label="Completed" value={r.completed} />
            <MetricCard metric="ontime" label="On time" value={pct(r.on_time_pct)} signal="green" />
            <MetricCard metric="red" label="Red marks" value={r.red_events} signal={r.red_events ? "red" : "neutral"} />
          </div>
          <Section title="Details">
            <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-y-2 text-[15px]">
              <dt className="text-ink-soft"><MetricLabel metric="assigned">Tasks assigned</MetricLabel></dt><dd><MetricValue metric="assigned" value={r.assigned} /></dd>
              <dt className="text-ink-soft"><MetricLabel metric="late">Completed late</MetricLabel></dt><dd><MetricValue metric="late" value={r.late} /></dd>
              <dt className="text-ink-soft"><MetricLabel metric="daily">Daily updates</MetricLabel></dt><dd><MetricValue metric="daily" value={r.daily_updates} /></dd>
              <dt className="text-ink-soft">Weights</dt><dd>On time {pct(weights.onTime * 100)} · clean days {pct(weights.clean * 100)}</dd>
            </dl>
          </Section>
        </MyPerformanceDetails>
      )}
    </>
  );
}
