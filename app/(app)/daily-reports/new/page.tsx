import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getReportFormData, projectDailyLog, projectRemarks, projectStart } from "@/lib/data/reports";
import { getSettings } from "@/lib/data/admin";
import { getMembers } from "@/lib/data/projects";
import { canManageProject, reportOrder, reportStatuses } from "@/lib/auth/capabilities";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { DailyEntriesForm } from "@/components/reports/daily-entries-form";
import { DailyLogTable } from "@/components/reports/daily-log-table";
import type { StepOption } from "@/lib/report-items";
import type { SavedReport } from "@/lib/report-entries";
import { letterOf, rowDateChoice, sheetDate, taskLabel } from "@/lib/sheet";
import { daysAgo, dhakaToday } from "@/lib/time";

export const metadata: Metadata = { title: "Submit Daily Report" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Submit Daily Report: several task/subtask entries in one report for one project and date (migration 35), then
 * the person's recent rows of the Daily Follow Up. Everyone writes their own report for today; an Admin may also
 * open any current member's report (?user=) and an earlier date (?date=), which is how a multi-entry report is
 * edited from the project's Daily reports tab.
 */
export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ project?: string; date?: string; user?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const today = dhakaToday();
  const settings = await getSettings();
  // first the project (the person and date depend on it)
  const first = await getReportFormData(s.userId, sp.project, { allProjects: s.isAdmin, viewerId: s.userId });
  const project = first.project;
  const header = (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-sm text-ink-soft">
        <Link href="/daily-reports" className="hover:text-steel hover:underline">Daily Reports</Link><ChevronRight size={14} aria-hidden /><span className="font-medium text-ink">Submit Daily Report</span>
      </nav>
      <header className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e6f1e3] text-signal-green"><CalendarCheck size={20} aria-hidden /></span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submit Daily Report</h1>
          <p className="mt-0.5 text-ink-soft">Report your daily work, progress and issues for the project.</p>
        </div>
      </header>
    </>
  );
  if (!project) {
    return (<>{header}<EmptyState title="No running project to report on">Daily updates are for running projects. Once you&apos;re on a running project, you can submit its daily update here.</EmptyState></>);
  }

  const start = projectStart(project);
  const dateChoice = rowDateChoice(s.isAdmin, start, today);
  const date = s.isAdmin && sp.date && ISO.test(sp.date) && sp.date >= dateChoice.min && sp.date <= today ? sp.date : today;
  const members = s.isAdmin ? (await getMembers(project.id)).map((m) => ({ id: m.user_id, name: m.full_name })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  // whose report: my own; an Admin may choose a current member (an Admin who is not a member starts with the first one)
  const userId = s.isAdmin
    ? (members.find((m) => m.id === sp.user)?.id ?? (members.some((m) => m.id === s.userId) || !members.length ? s.userId : members[0].id))
    : s.userId;
  const d = userId === s.userId && date === today ? first : await getReportFormData(userId, project.id, { date, allProjects: s.isAdmin, viewerId: s.userId });
  const personName = userId === s.userId ? s.profile.full_name : members.find((m) => m.id === userId)?.name ?? "";

  const manages = canManageProject(s, project);
  const tasks: StepOption[] = d.tasks.map((t) => ({
    id: t.id,
    label: t.parent ? taskLabel(t.parent.code, t.parent.title) : taskLabel(t.code, t.title),
    sub: t.parent ? `${letterOf(t.code)}. ${t.title}` : null,
    status: t.status, choices: reportStatuses(s, t, manages), is_leaf: t.is_leaf, progress_pct: t.progress_pct,
    done: t.status === "Completed",
    // the task it belongs to, with the progress Responsibilities shows for it (weighted from its subtasks)
    top: t.parent
      ? { id: t.parent.id, label: taskLabel(t.parent.code, t.parent.title), progress: t.parent.calculated_progress }
      : { id: t.id, label: taskLabel(t.code, t.title), progress: t.calculated_progress },
  }));
  const existing = d.existing;
  const saved: SavedReport | null = existing ? {
    update_text: existing.update_text, issues: existing.issues, next_task_text: existing.next_task_text, work_hours: existing.work_hours,
    items: existing.daily_report_items.map((i) => ({
      task_id: i.task_id, task_code: i.task_code, task_title: i.task_title, parent: i.parent ?? null,
      status_after: i.status_after, progress_after: i.progress_after, work_hours: i.work_hours,
      work_text: i.work_text, issues: i.issues, next_task_text: i.next_task_text, created_at: i.created_at,
    })),
  } : null;
  const locked = Boolean(existing?.locked) && !s.isAdmin;

  const [recent, remarks] = await Promise.all([
    projectDailyLog(project, { from: daysAgo(13), to: today, user: { id: userId, name: personName }, workdays: settings?.workdays, order: reportOrder(s) }),
    projectRemarks(project.id, daysAgo(13), today),
  ]);
  const mine = remarks.filter((m) => m.recipientId === userId);

  return (
    <>
      {header}
      <div className="space-y-8">
        {locked ? (
          <>
            <PageHeader title={`${project.code} · ${sheetDate(date)}`} />
            <EmptyState title="Today's report is locked">Ask your admin to unlock it if something needs fixing.</EmptyState>
          </>
        ) : (
          // keyed by project, person and date: a change starts a fresh form, so one report's entries never go to another
          <DailyEntriesForm key={`${project.id}:${userId}:${date}`}
            projectId={project.id} projects={first.projects.map((x) => ({ id: x.id, code: x.code, name: x.name }))}
            date={date} today={today} dateChoice={dateChoice}
            userId={userId} viewerId={s.userId} isAdmin={s.isAdmin} people={members}
            tasks={tasks} saved={saved}
            savedFiles={(existing?.daily_report_attachments ?? []).map((a) => ({ taskId: a.task_id, size: a.size_bytes }))}
            maxFiles={settings?.attachment_max_files ?? 10} />
        )}
        <Section title={userId === s.userId ? "My daily follow up, last 14 days" : `${personName}: daily follow up, last 14 days`}
          aside={<Link href={`/projects/${project.id}/daily-reports`} className="text-sm text-steel hover:underline">Whole project</Link>}>
          <DailyLogTable rows={recent} remarks={mine} />
        </Section>
      </div>
    </>
  );
}
