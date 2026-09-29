import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getReport } from "@/lib/data/reports";
import { getSettings } from "@/lib/data/admin";
import { canManageProject } from "@/lib/auth/capabilities";
import { Badge, PageHeader, Section, Table } from "@/components/ui/misc";
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
  return (
    <>
      <PageHeader title={`${r.author?.full_name ?? "Report"}, ${fmtDay(r.report_date)}`}
        lead={<><Link href={`/projects/${r.project?.id}`} className="hover:text-steel hover:underline">{r.project?.code} {r.project?.name}</Link> · submitted {fmt(r.submitted_at)}{r.locked ? " · locked" : ""}</>}
        actions={<>
          {mine && open ? <LinkButton href={`/daily-reports/new?project=${r.project_id}`}>Edit report</LinkButton> : null}
          {s.isAdmin ? <ReportAdminActions id={r.id} locked={r.locked} /> : null}
        </>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="Update"><p className="whitespace-pre-wrap">{r.update_text}</p></Section>
          <Section title="Tasks updated">
            {items.length ? (
              <Table>
                <thead><tr><th>Task</th><th>Progress</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td><Link href={`/projects/${r.project_id}/tasks/${i.task_id}`} className="font-medium hover:text-steel">{i.task_code}</Link> <span className="text-ink-soft">{i.task_title}</span></td>
                      <td className="whitespace-nowrap">{i.progress_after == null ? "—" : `${i.progress_after}%`}</td>
                      <td>{i.status_after ? <Badge>{i.status_after}</Badge> : "—"}</td>
                      <td className="text-ink-soft">{i.note}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="text-sm text-ink-soft">No tasks were ticked in this report.</p>}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Issues, next task, remarks">
            <dl className="space-y-3 text-[15px]">
              <div><dt className="text-sm text-ink-soft">Issues</dt><dd className="whitespace-pre-wrap">{r.issues || "None"}</dd></div>
              <div><dt className="text-sm text-ink-soft">Next task</dt><dd>{r.next_task ? `${r.next_task.code} ${r.next_task.title}` : r.next_task_text || "—"}</dd></div>
              <div><dt className="text-sm text-ink-soft">Remarks</dt><dd className="whitespace-pre-wrap">{r.remarks || "—"}</dd></div>
            </dl>
          </Section>
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
