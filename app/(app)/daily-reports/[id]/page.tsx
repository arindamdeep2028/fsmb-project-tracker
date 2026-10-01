import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getReport, projectStart } from "@/lib/data/reports";
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
  const settings = await getSettings();
  const mine = r.user_id === s.userId;
  const open = !r.locked && r.report_date === dhakaToday();
  const manages = r.project ? canManageProject(s, r.project) : false;
  const canUpload = (mine && open) || manages;
  const canDeleteFiles = (mine && open) || manages;
  const row: DailyRow = {
    key: r.id, date: r.report_date, reportId: null, offDay: false, assignedTo: r.author?.full_name ?? "",
    dayNo: r.project ? projectDayNumber(projectStart(r.project), r.report_date) : null,
    mainTask: items.map((i) => (i.parent
      ? { label: taskLabel(i.parent.code, i.parent.title), sub: `${letterOf(i.task_code)}. ${i.task_title}`, status: i.status_after }
      : { label: taskLabel(i.task_code, i.task_title), sub: null, status: i.status_after })),
    dailySubTask: r.update_text, issues: r.issues ?? "", remarks: r.remarks ?? "",
    nextTask: r.next_task ? taskLabel(r.next_task.code, r.next_task.title) : r.next_task_text ?? "",
  };
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
            <DailyLogTable rows={[row]} />
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Photos and files" aside={r.locked ? <Badge signal="done">Locked</Badge> : undefined}>
            <div className="space-y-4">
              <AttachmentGallery files={attachments} canDelete={canDeleteFiles} />
              {canUpload && r.project_id ? <FileUploader projectId={r.project_id} reportId={r.id} existingCount={attachments.length} maxFiles={settings?.attachment_max_files ?? 10} /> : null}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
