"use client";
import Link from "next/link";
import { deleteNotification, markAllRead, markRead } from "@/lib/actions/notifications";
import { notificationLabel } from "@/lib/labels";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/types/database";

export function NotificationList({ items }: { items: Tables<"notifications">[] }) {
  const { pending, run } = useAction();
  if (!items.length) return <p className="py-10 text-center text-ink-soft">You're all caught up.</p>;
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button variant="secondary" size="sm" pending={pending} onClick={() => run(() => markAllRead())}>Mark all as read</Button></div>
      <ul className="divide-y divide-line-soft rounded-lg border border-line bg-panel">
        {items.map((n) => {
          const signal = n.type === "task_overdue" ? "rail-red" : n.type === "deadline_approaching" ? "rail-amber" : n.read_at ? "rail-done" : "rail-neutral";
          const href = n.link ?? (n.task_id && n.project_id ? `/projects/${n.project_id}/tasks/${n.task_id}` : n.project_id ? `/projects/${n.project_id}` : null);
          return (
            <li key={n.id} className={cn("rail flex items-start justify-between gap-3 py-3 pl-5 pr-3", signal, !n.read_at && "bg-steel-wash/40")}>
              <div className="min-w-0">
                <div className="text-xs text-ink-soft">{notificationLabel[n.type]} · {ago(n.created_at)}</div>
                {href ? (
                  <Link href={href} onClick={() => !n.read_at && markRead(n.id)} className={cn("hover:text-steel hover:underline", !n.read_at && "font-medium")}>{n.title}</Link>
                ) : <span className={cn(!n.read_at && "font-medium")}>{n.title}</span>}
                {n.body ? <p className="text-sm text-ink-soft">{n.body}</p> : null}
              </div>
              <div className="flex shrink-0 gap-2 text-sm">
                {!n.read_at ? <button className="text-steel hover:underline" onClick={() => run(() => markRead(n.id))}>Mark read</button> : null}
                <button className="text-ink-faint hover:text-signal-red" aria-label="Delete notification" onClick={() => run(() => deleteNotification(n.id))}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
