import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getReportFormData } from "@/lib/data/reports";
import { getSettings } from "@/lib/data/admin";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { DailyReportForm } from "@/components/reports/daily-report-form";
import { FileUploader } from "@/components/reports/file-uploader";
import { dhakaToday, fmtDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today's report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireSession();
  const { project } = await searchParams;
  const [d, settings] = await Promise.all([getReportFormData(s.userId, project), getSettings()]);
  if (!d.projectId) {
    return (<><PageHeader title="Today's report" /><EmptyState title="You're not on a project yet">Your PM adds you to a project, then you can report on it.</EmptyState></>);
  }
  const locked = Boolean(d.existing?.locked);
  return (
    <>
      <PageHeader title={d.existing ? "Update today's report" : "Today's report"} lead={`${fmtDay(dhakaToday())}. You can edit it until it locks at the end of the day.`} />
      {d.projects.length > 1 ? (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Project">
          {d.projects.map((p) => (
            <Link key={p.id} href={`?project=${p.id}`} aria-current={p.id === d.projectId ? "page" : undefined}
              className={cn("rounded-md border border-line px-3 py-1.5 text-sm", p.id === d.projectId ? "border-steel bg-steel text-white" : "bg-panel hover:border-steel")}>{p.code}</Link>
          ))}
        </nav>
      ) : null}
      {locked ? <EmptyState title="Today's report is locked">Ask your admin to unlock it if something needs fixing.</EmptyState> : (
        <div className="space-y-6">
          <Section title={d.projects.find((p) => p.id === d.projectId)!.name}>
            <DailyReportForm projectId={d.projectId} tasks={d.tasks} existing={d.existing} />
          </Section>
          <Section title="Photos and files">
            {d.existing ? (
              <FileUploader projectId={d.projectId} reportId={d.existing.id} existingCount={d.existing.daily_report_attachments.length} maxFiles={settings?.attachment_max_files ?? 10} />
            ) : <p className="text-sm text-ink-soft">Submit the report first, then add photos and files on the next screen.</p>}
          </Section>
        </div>
      )}
    </>
  );
}
