import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listMyReports, projectStart } from "@/lib/data/reports";
import { listProjects } from "@/lib/data/projects";
import { canManageProject, reportOrder } from "@/lib/auth/capabilities";
import { projectDayNumber } from "@/lib/sheet";
import { Badge, EmptyState, PageHeader, Section, Table } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtDay } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Daily Reports" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * My reports and team links. Dashboard figures open it with ?user=&from=&to= for one person's reports (RLS-limited).
 * Admin, Department Head and Project Manager read newest first; an Engineer reads oldest first, from Day 1.
 */
export default async function DailyReportsPage({ searchParams }: { searchParams: Promise<{ user?: string; from?: string; to?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const order = reportOrder(s);
  if (sp.user && /^[0-9a-f-]{36}$/i.test(sp.user)) return <PersonReports user={sp.user} newestFirst={order === "desc"} from={sp.from && ISO.test(sp.from) ? sp.from : undefined} to={sp.to && ISO.test(sp.to) ? sp.to : undefined} />;
  const [mine, projects] = await Promise.all([listMyReports(s.userId, order), listProjects()]);
  const managed = projects.filter((p) => canManageProject(s, p));
  return (
    <>
      <PageHeader title="Daily Reports" lead="One report per project per working day (Monday to Friday)."
        actions={s.memberProjectIds.length ? <LinkButton href="/daily-reports/new" variant="primary">Submit today's report</LinkButton> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title="My reports">
          {mine.length ? (
            <Table>
              <thead><tr><th>Day</th><th>Date</th><th>Project</th><th>Update</th><th /></tr></thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-ink-soft">{r.project ? `Day ${projectDayNumber(projectStart(r.project), r.report_date) ?? "—"}` : "—"}</td>
                    <td className="whitespace-nowrap"><Link href={`/daily-reports/${r.id}`} className="font-medium hover:text-steel hover:underline">{fmtDay(r.report_date)}</Link></td>
                    <td>{r.project?.code}</td>
                    <td className="max-w-md truncate text-ink-soft">{r.update_text}</td>
                    <td>{r.locked ? <Badge signal="done">Locked</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title="No reports yet">Your first report takes about two minutes.</EmptyState>}
        </Section>
        {managed.length ? (
          <Section title="Team reports">
            <ul className="divide-y divide-line-soft">
              {managed.map((p) => (
                <li key={p.id} className="py-2"><Link href={`/projects/${p.id}/daily-reports`} className="hover:text-steel hover:underline"><span className="font-medium">{p.code}</span> {p.name}</Link></li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  );
}

/** One person's daily reports in a window — only those in projects the viewer can see (reports RLS). */
async function PersonReports({ user, from, to, newestFirst }: { user: string; from?: string; to?: string; newestFirst: boolean }) {
  const supabase = await createClient();
  let q = supabase.from("daily_reports")
    .select("id, report_date, update_text, locked, project:projects(code, name), daily_report_items(count)")
    .eq("user_id", user).order("report_date", { ascending: !newestFirst }).limit(200);
  if (from) q = q.gte("report_date", from);
  if (to) q = q.lte("report_date", to);
  const [{ data: rows }, { data: person }] = await Promise.all([q, supabase.from("profiles").select("full_name").eq("id", user).maybeSingle()]);
  const reports = rows ?? [];
  const tasks = reports.reduce((a, r) => a + (r.daily_report_items?.[0]?.count ?? 0), 0);
  return (
    <>
      <PageHeader title={`Daily reports · ${person?.full_name ?? "this person"}`}
        lead={<>{from || to ? `${fmtDate(from ?? null)} to ${fmtDate(to ?? null)} · ` : ""}<span data-testid="record-count">{reports.length} report{reports.length === 1 ? "" : "s"}</span>
          {` covering ${tasks} task update${tasks === 1 ? "" : "s"}`} · only reports in projects you have access to are listed</>}
        actions={<Link href="/daily-reports" className="text-sm text-steel hover:underline">Clear filter</Link>} />
      {reports.length ? (
        <Table className="rounded-lg border border-line bg-panel">
          <thead><tr><th>Date</th><th>Project</th><th>Update</th><th>Tasks</th><th /></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap"><Link href={`/daily-reports/${r.id}`} className="font-medium hover:text-steel hover:underline">{fmtDay(r.report_date)}</Link></td>
                <td>{r.project?.code}</td>
                <td className="max-w-md truncate text-ink-soft">{r.update_text}</td>
                <td>{r.daily_report_items?.[0]?.count ?? 0}</td>
                <td>{r.locked ? <Badge signal="done">Locked</Badge> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No daily reports in this window." />}
    </>
  );
}
