import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getReportFormData, projectDailyLog, projectRemarks, projectStart } from "@/lib/data/reports";
import { getSettings } from "@/lib/data/admin";
import { canManageProject, reportOrder, reportStatuses } from "@/lib/auth/capabilities";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { DailyReportForm, type MainTaskOption } from "@/components/reports/daily-report-form";
import { DailyLogTable } from "@/components/reports/daily-log-table";
import { FileUploader } from "@/components/reports/file-uploader";
import { letterOf, projectDayNumber, taskLabel } from "@/lib/sheet";
import { daysAgo, dhakaToday, fmtDay } from "@/lib/time";
import { ProjectChooser } from "@/components/projects/project-chooser";

export const metadata: Metadata = { title: "Daily update" };

/** Today's Daily Follow Up row for one of my projects, then my recent rows in the same layout. */
export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireSession();
  const { project: wanted } = await searchParams;
  const [d, settings] = await Promise.all([getReportFormData(s.userId, wanted), getSettings()]);
  const project = d.project;
  if (!project) {
    return (<><PageHeader title="Daily update" /><EmptyState title="No running project to report on">Daily updates are for running projects. Once you're on a running project, you can submit its daily update here.</EmptyState></>);
  }
  const today = dhakaToday();
  const manages = canManageProject(s, project);
  const tasks: MainTaskOption[] = d.tasks.map((t) => ({
    id: t.id,
    label: t.parent ? taskLabel(t.parent.code, t.parent.title) : taskLabel(t.code, t.title),
    sub: t.parent ? `${letterOf(t.code)}. ${t.title}` : null,
    status: t.status, choices: reportStatuses(s, t, manages), is_leaf: t.is_leaf, progress_pct: t.progress_pct,
    done: t.status === "Completed",
    // the task it belongs to (step 2), with the progress Responsibilities shows for it
    top: t.parent
      ? { id: t.parent.id, label: taskLabel(t.parent.code, t.parent.title), progress: t.parent.calculated_progress }
      : { id: t.id, label: taskLabel(t.code, t.title), progress: t.calculated_progress },
  }));
  const [recent, remarks] = await Promise.all([
    projectDailyLog(project, { from: daysAgo(13), to: today, user: { id: s.userId, name: s.profile.full_name }, workdays: settings?.workdays, order: reportOrder(s) }),
    projectRemarks(project.id, daysAgo(13), today),
  ]);
  // only the remarks addressed to me (an Admin or manager may read more of them; this page is about my own rows)
  const mine = remarks.filter((m) => m.recipientId === s.userId);
  const locked = Boolean(d.existing?.locked);
  return (
    <>
      <PageHeader title={d.existing ? "Update today's daily update" : "Daily update"}
        lead={`${fmtDay(today)}. One row per project per day; you can edit it until it locks at the end of the day.`} />
      {/* step 1: only the projects I am a member of (getReportFormData); only that project's tasks are offered below */}
      <ProjectChooser projects={d.projects} current={project.id} label="Project" step={1} />
      <div className="space-y-6">
        {locked ? <EmptyState title="Today's update is locked">Ask your admin to unlock it if something needs fixing.</EmptyState> : (
          <Section title={project.name} aside={<span className="text-sm text-ink-soft">{project.code}</span>}>
            {/* keyed by project: switching project starts a fresh form, so one project's draft is never sent to another */}
            <DailyReportForm key={project.id} projectId={project.id} date={today} dayNo={projectDayNumber(projectStart(project), today)} me={s.profile.full_name}
              tasks={tasks} existing={d.existing} maxFiles={settings?.attachment_max_files ?? 10} remarks={mine.filter((m) => m.date === today)} />
          </Section>
        )}
        {/* a new update takes its photos and files inside the form above; a saved one has its uploader here */}
        {!locked && d.existing ? (
          <Section title="Photos and files">
            <FileUploader projectId={project.id} reportId={d.existing.id} existingCount={d.existing.daily_report_attachments.length} maxFiles={settings?.attachment_max_files ?? 10} />
          </Section>
        ) : null}
        <Section title="My daily follow up, last 14 days" aside={<Link href={`/projects/${project.id}/daily-reports`} className="text-sm text-steel hover:underline">Whole project</Link>}>
          <DailyLogTable rows={recent} remarks={mine} />
        </Section>
      </div>
    </>
  );
}
