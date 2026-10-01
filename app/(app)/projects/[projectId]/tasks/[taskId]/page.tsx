import Link from "next/link";
import { notFound } from "next/navigation";
import { projectContext } from "@/lib/auth/project-guard";
import { getTaskDetail } from "@/lib/data/tasks";
import { getMembers, getProjectEngineers } from "@/lib/data/projects";
import { taskCaps } from "@/lib/auth/capabilities";
import { Badge, Meter, Section, Table } from "@/components/ui/misc";
import { DeadlineChip, RedReasons } from "@/components/tasks/deadline";
import { CommentThread } from "@/components/tasks/comment-thread";
import { TaskDetailActions } from "@/components/tasks/task-detail-actions";
import { fmt, fmtDay } from "@/lib/time";
import { pct } from "@/lib/utils";

export default async function TaskPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { projectId, taskId } = await params;
  const { s, manages } = await projectContext(projectId);
  const d = await getTaskDetail(taskId);
  if (!d || d.task.project_id !== projectId) notFound();
  const t = d.task;
  const isLeaf = d.rollup?.is_leaf ?? d.subtasks.length === 0;
  const caps = taskCaps(s, t, manages, isLeaf);
  const openSubtasks = d.subtasks.filter((x) => x.status !== "Completed").map((x) => ({ code: x.code, title: x.title }));
  let parentPrompt: { id: string; code: string; title: string } | null = null;
  let parent: { id: string; code: string; title: string } | null = null;
  if (t.parent_id) {
    const pd = await getTaskDetail(t.parent_id);
    if (pd) {
      parent = { id: pd.task.id, code: pd.task.code, title: pd.task.title };
      const othersOpen = pd.subtasks.some((x) => x.id !== t.id && x.status !== "Completed");
      if (!othersOpen && pd.task.status !== "Completed" && (pd.task.assigned_to === s.userId || manages)) parentPrompt = parent;
    }
  }
  const assignees = manages ? (await getMembers(projectId)).map((m) => ({ user_id: m.user_id, full_name: m.full_name })) : await getProjectEngineers(projectId);
  const progress = isLeaf ? t.progress_pct : d.rollup?.calculated_progress;
  const red = Boolean(d.flags?.is_red) && t.status !== "Completed";
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section className={`rail rounded-lg border border-line bg-panel py-4 pl-6 pr-4 rail-${red ? "red" : "neutral"}`}>
          {parent ? <Link href={`/projects/${projectId}/tasks/${parent.id}`} className="text-sm text-steel hover:underline">{parent.code} {parent.title}</Link> : null}
          <h2 className="text-xl font-semibold"><span className="text-ink-soft">{t.code}</span> {t.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{t.status}</Badge>
            <Badge signal={t.priority === "Important" || t.priority === "High" ? "amber" : "neutral"}>{t.priority}</Badge>
            {t.archived ? <Badge signal="done">Archived</Badge> : null}
            {t.contribution_locked ? <Badge signal="done">Share locked</Badge> : null}
          </div>
          {red ? <div className="mt-3"><RedReasons reasons={d.flags?.reasons} /></div> : null}
          {t.description ? <p className="mt-4 whitespace-pre-wrap text-[15px]">{t.description}</p> : null}
          {t.status === "Blocked" && t.blocker_note ? <p className="mt-3 text-signal-amber">Blocked: {t.blocker_note}</p> : null}
          <div className="mt-5">
            <TaskDetailActions task={t} caps={caps} openSubtasks={openSubtasks} parentPrompt={parentPrompt} assignees={assignees} meId={s.userId} projectId={projectId} isParent={!isLeaf} />
          </div>
        </section>

        {d.subtasks.length ? (
          <Section title="Subtasks">
            <ul className="divide-y divide-line-soft">
              {d.subtasks.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <Link href={`/projects/${projectId}/tasks/${x.id}`} className="hover:text-steel hover:underline"><span className="mr-1.5 text-ink-soft">{x.code}</span>{x.title}</Link>
                  <span className="text-sm text-ink-soft">{x.assignee?.full_name} · {x.status} · {pct(x.progress_pct)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Comments">
          <CommentThread taskId={t.id} comments={d.comments} meId={s.userId} canComment={caps.comment || manages} isAdmin={s.isAdmin} />
        </Section>
      </div>

      <div className="space-y-6">
        <Section title="Progress and deadline">
          <div className="mb-3 flex items-center gap-3"><Meter value={progress} label="Task progress" /><span className="text-lg font-semibold">{pct(progress)}</span></div>
          {!isLeaf ? <p className="mb-3 text-sm text-ink-soft">Calculated from subtasks.</p> : null}
          <DeadlineChip due={t.effective_due_at} status={d.flags?.deadline_status} isRed={red} />
          <dl className="mt-4 grid grid-cols-[9rem_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-ink-soft">Owner</dt><dd>{t.assignee?.full_name ?? "—"}</dd>
            <dt className="text-ink-soft">Created by</dt><dd>{t.creator?.full_name ?? "—"}</dd>
            <dt className="text-ink-soft">Assigned</dt><dd>{fmt(t.assigned_on)}</dd>
            <dt className="text-ink-soft">Clock starts</dt><dd>{fmt(t.clock_start_at)}</dd>
            <dt className="text-ink-soft">Plan due</dt><dd>{fmt(t.plan_due_at)}{t.plan_submitted_at ? ` · submitted ${fmt(t.plan_submitted_at)}` : ""}</dd>
            <dt className="text-ink-soft">Rule deadline</dt><dd>{fmt(t.exec_due_at)}</dd>
            <dt className="text-ink-soft">Set by manager</dt><dd>{fmt(t.planned_due_at)}</dd>
            <dt className="text-ink-soft">Extended to</dt><dd>{fmt(t.extended_deadline)}</dd>
            <dt className="text-ink-soft">Completed</dt><dd>{fmt(t.completed_on)}</dd>
            <dt className="text-ink-soft">Share</dt><dd>{pct(d.rollup?.effective_weight, 1)}{t.contribution_pct == null ? " (equal share)" : ""}</dd>
          </dl>
        </Section>
        {d.extensions.length ? (
          <Section title="Extensions">
            <ul className="space-y-2 text-sm">
              {d.extensions.map((e) => <li key={e.id}>{fmt(e.previous_deadline)} → <strong>{fmt(e.new_deadline)}</strong> by {e.granter?.full_name}{e.reason ? <span className="block text-ink-soft">{e.reason}</span> : null}</li>)}
            </ul>
          </Section>
        ) : null}
        <Section title="Daily report mentions">
          {d.items.length ? (
            <ul className="space-y-2 text-sm">
              {d.items.map((i) => (
                <li key={i.id}><Link href={`/daily-reports/${i.report?.id}`} className="font-medium hover:text-steel hover:underline">{fmtDay(i.report?.report_date)}</Link>
                  {i.progress_after != null ? ` · ${i.progress_after}%` : ""}{i.status_after ? ` · ${i.status_after}` : ""}{i.note ? <span className="block text-ink-soft">{i.note}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-soft">Not in any daily report yet.</p>}
        </Section>
        <Section title="Change history">
          {d.history.length ? (
            <Table>
              <thead><tr><th>When</th><th>Who</th><th>Progress</th><th>Share</th></tr></thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}><td className="whitespace-nowrap">{fmt(h.recorded_at)}</td><td>{h.who?.full_name}</td>
                    <td>{h.progress_before ?? "—"} → {h.progress_after ?? "—"}</td><td>{h.contribution_before ?? "—"} → {h.contribution_after ?? "—"}</td></tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="text-sm text-ink-soft">No changes recorded yet.</p>}
        </Section>
      </div>
    </div>
  );
}
