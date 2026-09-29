import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/admin";
import { Kpi, PageHeader, Section } from "@/components/ui/misc";
import { WindowPicker } from "@/components/window-picker";
import { scoreBand } from "@/lib/labels";
import { daysAgo, dhakaToday } from "@/lib/time";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "My Performance" };

export default async function MyPerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const settings = await getSettings();
  const to = sp.to ?? dhakaToday();
  const from = sp.from ?? daysAgo(settings?.review_window_days ?? 90);
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_performance", { p_from: from, p_to: to });
  const r = data?.[0];
  const band = scoreBand(r?.score);
  return (
    <>
      <PageHeader title="My Performance" lead="How the score works: on-time completions and clean days (no red marks), weighted by the admin's rules." actions={<WindowPicker from={from} to={to} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Score · ${band.label}`} value={r?.score ?? "—"} signal={band.signal} />
        <Kpi label="Completed" value={r?.completed ?? 0} />
        <Kpi label="On time" value={pct(r?.on_time_pct)} signal="green" />
        <Kpi label="Red marks" value={r?.red_events ?? 0} signal={r?.red_events ? "red" : "neutral"} />
      </div>
      <Section title="Details">
        <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-y-2 text-[15px]">
          <dt className="text-ink-soft">Tasks assigned</dt><dd>{r?.assigned ?? 0}</dd>
          <dt className="text-ink-soft">Completed late</dt><dd>{r?.late ?? 0}</dd>
          <dt className="text-ink-soft">Daily updates</dt><dd>{r?.daily_updates ?? 0}</dd>
          <dt className="text-ink-soft">Weights</dt><dd>On time {pct((settings?.score_weight_on_time ?? 0.7) * 100)} · clean days {pct((settings?.score_weight_clean ?? 0.3) * 100)}</dd>
        </dl>
      </Section>
    </>
  );
}
