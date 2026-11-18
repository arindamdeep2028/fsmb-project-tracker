import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getReport, projectRemarks, projectStart } from "@/lib/data/reports";
import { formatHours, totalHours } from "@/lib/hours";
import { getSettings } from "@/lib/data/admin";
import { canManageProject } from "@/lib/auth/capabilities";
import { Badge, PageHeader, Section } from "@/components/ui/misc";
import { DailyLogTable } from "@/components/reports/daily-log-table";
import { letterOf, projectDayNumber, taskLabel, type DailyRow } from "@/lib/sheet";
import { LinkButton } from "@/components/ui/button";
import { AttachmentGallery } from "@/components/reports/attachment-gallery";
import { FileUploader } from "@/components/reports/file-uploader";
import { ReportAdminActions } from "@/components/admin/report-admin-actions";
import { dhakaToday, fmt, fmtDay } from "@/lib/time";

export const metadata: Metadata = { title: "Daily report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const data = await getReport(id);
  if (!data) notFound();
  const { report: r, items, attachments } = data;
  const [settings, dayRemarks] = await Promise.all([getSettings(), projectRemarks(r.project_id, r.report_date, r.report_date)]);
  // the remarks given to this report's person on that day (RLS: only those the viewer may read)
  const remarks = dayRemarks.filter((m) => m.recipientId === r.user_id);
  const hours = totalHours([r.work_hours, ...items.map((i) => i.work_hours)]);
  const mine = r.user_id === s.userId;
  const open = !r.locked && r.report_date === dhakaToday();
  const manages = r.project ? canManageProject(s, r.project) : false;
  const canUpload = (mine && open) || s.isAdmin;   // the Storage policy: the author while the report is open, or an Admin
  const canDeleteFiles = (mine && open) || manages;
  const row: DailyRow = {
    key: r.id, date: r.report_date, reportId: r.id, userId: r.user_id, hours, fileCount: attachments.length, locked: r.locked, edit: null, offDay: false, assignedTo: r.author?.full_name ?? "",
    dayNo: r.project ? projectDayNumber(projectStart(r.project), r.report_date) : null,
    mainTask: items.map((i) => ({
      ...(i.parent
        ? { label: taskLabel(i.parent.code, i.parent.title), sub: `${letterOf(i.task_code)}. ${i.task_title}`, status: i.status_after }
        : { label: taskLabel(i.task_code, i.task_title), sub: null, status: i.status_after }),
      // the task row's own screenshots and photos (migration 25)
      taskId: i.task_id,
      files: attachments.filter((a) => a.task_id === i.task_id).map((a) => ({ id: a.id, name: a.file_name, mime: a.mime_type, url: a.url })),
    })),
    dailySubTask: r.update_text, issues: r.issues ?? "", remarks: r.remarks ?? "",
    nextTask: r.next_task ? taskLabel(r.next_task.code, r.next_task.title) : r.next_task_text ?? "",
  };
  // what a file can be attached to here: the whole report, or one of its task rows
  const taskRows = items.map((i) => ({ id: i.task_id, label: i.parent ? `${taskLabel(i.parent.code, i.parent.title)} — ${letterOf(i.task_code)}. ${i.task_title}` : taskLabel(i.task_code, i.task_title) }));
  const taskOf = new Map(taskRows.map((t) => [t.id, t.label]));
  return (
    <>
      <PageHeader title={`${r.author?.full_name ?? "Report"}, ${fmtDay(r.report_date)}`}
        lead={<><Link href={`/projects/${r.project?.id}`} className="hover:text-steel hover:underline">{r.project?.code} {r.project?.name}</Link> · submitted {fmt(r.submitted_at)}{r.locked ? " · locked" : ""}</>}
        actions={<>
          {mine && open ? <LinkButton href={`/daily-reports/new?project=${r.project_id}`}>Edit update</LinkButton> : null}
          {s.isAdmin ? <ReportAdminActions id={r.id} locked={r.locked} /> : null}
        </>} />
      <div className="space-y-6">
        <div className="space-y-6">
          <Section title="Daily follow up">
            <DailyLogTable rows={[row]} remarks={remarks} />
          </Section>
          <Section title="Working hours" aside={<span data-testid="report-total-hours" className="text-sm font-semibold">Total {formatHours(hours)}</span>}>
            <table className="w-full max-w-xl border-collapse text-sm" data-testid="report-hours">
              <thead><tr className="bg-[#efeadf]"><th className="border border-ink/20 px-3 py-1.5 text-left">Task</th><th className="w-32 border border-ink/20 px-3 py-1.5">Hours</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}><td className="border border-ink/20 px-3 py-1.5">{taskLabel(i.task_code, i.task_title)}</td><td className="border border-ink/20 px-3 py-1.5 text-center">{formatHours(i.work_hours)}</td></tr>
                ))}
                {r.work_hours != null || !items.length ? (
                  <tr><td className="border border-ink/20 px-3 py-1.5 text-ink-soft">{items.length ? "Other work (no task)" : "Work that day"}</td><td className="border border-ink/20 px-3 py-1.5 text-center">{formatHours(r.work_hours)}</td></tr>
                ) : null}
                <tr className="font-semibold"><td className="border border-ink/20 px-3 py-1.5">Total</td><td className="border border-ink/20 px-3 py-1.5 text-center">{formatHours(hours)}</td></tr>
              </tbody>
            </table>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Photos and files" aside={r.locked ? <Badge signal="done">Locked</Badge> : undefined}>
            <div className="space-y-4">
              <AttachmentGallery files={attachments.map((a) => ({ ...a, task: a.task_id ? taskOf.get(a.task_id) ?? null : null }))} canDelete={canDeleteFiles} />
              {canUpload && r.project_id ? <FileUploader projectId={r.project_id} reportId={r.id} existingCount={attachments.length} maxFiles={settings?.attachment_max_files ?? 10} tasks={taskRows} /> : null}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
