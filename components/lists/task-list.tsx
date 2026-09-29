import Link from "next/link";
import { DeadlineChip } from "@/components/tasks/deadline";
import { deadlineSignal } from "@/lib/labels";
import { cn, pct } from "@/lib/utils";
import type { EngineerTask } from "@/types/domain";

/** Compact list of task rows (dashboards). */
export function TaskList({ tasks, empty }: { tasks: EngineerTask[]; empty: string }) {
  if (!tasks.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {tasks.map((t) => (
        <li key={t.task_id} className={cn("rail flex flex-wrap items-center justify-between gap-3 py-2.5 pl-4", `rail-${deadlineSignal(t.deadline_status, t.is_red)}`)}>
          <div className="min-w-0">
            <Link href={`/projects/${t.project_id}/tasks/${t.task_id}`} className="font-medium hover:text-steel hover:underline">
              <span className="mr-1.5 text-ink-soft">{t.code}</span>{t.title}
            </Link>
            <div className="text-xs text-ink-soft">{t.project_code} · {t.status} · {pct(t.progress_pct)}</div>
          </div>
          <DeadlineChip due={t.effective_due_at} status={t.deadline_status} isRed={t.is_red} />
        </li>
      ))}
    </ul>
  );
}
