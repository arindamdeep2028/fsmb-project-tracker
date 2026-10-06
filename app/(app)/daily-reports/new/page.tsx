import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getReportFormData, projectDailyLog, projectStart } from "@/lib/data/reports";
import { getSettings } from "@/lib/data/admin";
import { canManageProject, reportOrder, taskCaps } from "@/lib/auth/capabilities";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { DailyReportForm, type MainTaskOption } from "@/components/reports/daily-report-form";
import { DailyLogTable } from "@/components/reports/daily-log-table";
import { FileUploader } from "@/components/reports/file-uploader";
import { letterOf, projectDayNumber, taskLabel } from "@/lib/sheet";
import { daysAgo, dhakaToday, fmtDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Daily update" };

/** Today's Daily Follow Up row for one of my projects, then my recent rows in the same layout. */
export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireSession();
  const { project: wanted } = await searchParams;
  const [d, settings] = await Promise.all([getReportFormData(s.userId, wanted), getSettings()]);
  const project = d.project;
  if (!project) {
    return (<><PageHeader title="Daily update" /><EmptyState title="You're not on a project yet">Once you're added to a project, you can submit its daily update here.</EmptyState></>);
  }
  const today = dhakaToday();
  const manages = canManageProject(s, project);
  const tasks: MainTaskOption[] = d.tasks.map((t) => ({
    id: t.id,
    label: t.parent ? taskLabel(t.parent.code, t.parent.title) : taskLabel(t.code, t.title),
    sub: t.parent ? `${letterOf(t.code)}. ${t.title}` : null,
    status: t.status, choices: taskCaps(s, t, manages, t.is_leaf).statuses, is_leaf: t.is_leaf, progress_pct: t.progress_pct,
    done: t.status === "Completed",
  }));
  const recent = await projectDailyLog(project, { from: daysAgo(13), to: today, user: { id: s.userId, name: s.profile.full_name }, workdays: settings?.workdays, order: reportOrder(s) });
  const locked = Boolean(d.existing?.locked);
  return (
    <>
      <PageHeader title={d.existing ? "Update today's daily update" : "Daily update"}
        lead={`${fmtDay(today)}. One row per project per day; you can edit it until it locks at the end of the day.`} />
      {d.projects.length > 1 ? (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Project">
          {d.projects.map((p) => (
            <Link key={p.id} href={`?project=${p.id}`} aria-current={p.id === project.id ? "page" : undefined}
              className={cn("rounded-md border border-line px-3 py-1.5 text-sm", p.id === project.id ? "border-steel bg-steel text-white" : "bg-panel hover:border-steel")}>{p.code}</Link>
          ))}
        </nav>
      ) : null}
      <div className="space-y-6">
        {locked ? <EmptyState title="Today's update is locked">Ask your admin to unlock it if something needs fixing.</EmptyState> : (
          <Section title={`${project.code} ${project.name}`}>
            {/* keyed by project: switching project starts a fresh form, so one project's draft is never sent to another */}
            <DailyReportForm key={project.id} projectId={project.id} date={today} dayNo={projectDayNumber(projectStart(project), today)} me={s.profile.full_name}
              tasks={tasks} existing={d.existing} />
          </Section>
        )}
        {!locked ? (
          <Section title="Photos and files">
            {d.existing ? (
              <FileUploader projectId={project.id} reportId={d.existing.id} existingCount={d.existing.daily_report_attachments.length} maxFiles={settings?.attachment_max_files ?? 10} />
            ) : <p className="text-sm text-ink-soft">Submit the update first, then add photos and files on the next screen.</p>}
          </Section>
        ) : null}
        <Section title="My daily follow up, last 14 days" aside={<Link href={`/projects/${project.id}/daily-reports`} className="text-sm text-steel hover:underline">Whole project</Link>}>
          <DailyLogTable rows={recent} />
        </Section>
      </div>
    </>
  );
}
