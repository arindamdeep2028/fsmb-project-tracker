import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { myPerformanceRecords } from "@/lib/data/my-performance";
import { PageHeader, Section } from "@/components/ui/misc";
import { MetricCard, MetricLabel, MetricValue, MyPerformanceDetails } from "@/components/performance/my-performance-details";
import { WindowPicker } from "@/components/window-picker";
import { scoreBand } from "@/lib/labels";
import { daysAgo, dhakaToday } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "My Performance" };

export default async function MyPerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const settings = await getSettings();
  const to = sp.to ?? dhakaToday();
  const from = sp.from ?? daysAgo(settings?.review_window_days ?? 90);
  const supabase = await createClient();
  // The figures (my_performance) and the records behind them (own rows only, read under RLS) for the same window.
  const [{ data }, details] = await Promise.all([
    supabase.rpc("my_performance", { p_from: from, p_to: to }),
    myPerformanceRecords(session.userId, from, to),
  ]);
  const r = data?.[0];
  const band = scoreBand(r?.score);
  const weights = { onTime: settings?.score_weight_on_time ?? 0.7, clean: settings?.score_weight_clean ?? 0.3 };
  const summary = {
    assigned: r?.assigned ?? 0, completed: r?.completed ?? 0, late: r?.late ?? 0, on_time_pct: r?.on_time_pct ?? null,
    red_events: r?.red_events ?? 0, daily_updates: r?.daily_updates ?? 0, score: r?.score ?? null,
  };
  return (
    <>
      <PageHeader title="My Performance" lead="How the score works: on-time completions and clean days (no red marks), weighted by the admin's rules." actions={<WindowPicker from={from} to={to} />} />
      <MyPerformanceDetails records={details.records} summary={summary} weights={weights} window={{ from, to }} loadError={details.error}>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard metric="score" label={`Score · ${band.label}`} value={r?.score ?? "—"} signal={band.signal} />
          <MetricCard metric="completed" label="Completed" value={r?.completed ?? 0} />
          <MetricCard metric="ontime" label="On time" value={pct(r?.on_time_pct)} signal="green" />
          <MetricCard metric="red" label="Red marks" value={r?.red_events ?? 0} signal={r?.red_events ? "red" : "neutral"} />
        </div>
        <Section title="Details">
          <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-y-2 text-[15px]">
            <dt className="text-ink-soft"><MetricLabel metric="assigned">Tasks assigned</MetricLabel></dt><dd><MetricValue metric="assigned" value={r?.assigned ?? 0} /></dd>
            <dt className="text-ink-soft"><MetricLabel metric="late">Completed late</MetricLabel></dt><dd><MetricValue metric="late" value={r?.late ?? 0} /></dd>
            <dt className="text-ink-soft"><MetricLabel metric="daily">Daily updates</MetricLabel></dt><dd><MetricValue metric="daily" value={r?.daily_updates ?? 0} /></dd>
            <dt className="text-ink-soft">Weights</dt><dd>On time {pct((settings?.score_weight_on_time ?? 0.7) * 100)} · clean days {pct((settings?.score_weight_clean ?? 0.3) * 100)}</dd>
          </dl>
        </Section>
      </MyPerformanceDetails>
    </>
  );
}
