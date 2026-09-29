import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listMyReports } from "@/lib/data/reports";
import { listProjects } from "@/lib/data/projects";
import { canManageProject } from "@/lib/auth/capabilities";
import { Badge, EmptyState, PageHeader, Section, Table } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { fmtDay } from "@/lib/time";

export const metadata: Metadata = { title: "Daily Reports" };

export default async function DailyReportsPage() {
  const s = await requireSession();
  const [mine, projects] = await Promise.all([listMyReports(s.userId), listProjects()]);
  const managed = projects.filter((p) => canManageProject(s, p));
  return (
    <>
      <PageHeader title="Daily Reports" lead="One report per project per working day (Monday to Friday)."
        actions={s.memberProjectIds.length ? <LinkButton href="/daily-reports/new" variant="primary">Submit today's report</LinkButton> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title="My reports">
          {mine.length ? (
            <Table>
              <thead><tr><th>Date</th><th>Project</th><th>Update</th><th /></tr></thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
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
