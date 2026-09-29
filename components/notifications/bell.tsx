"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useToast } from "@/components/toast";

const TOAST_TYPES = new Set(["task_assigned", "task_overdue", "pm_comment"]);

/** Unread count from the server, then live via Supabase Realtime (migration 19 adds notifications to the publication). */
export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => setUnread(initialUnread), [initialUnread]);
  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        setUnread((n) => n + 1);
        const row = payload.new as { type: string; title: string };
        if (TOAST_TYPES.has(row.type)) toast({ ok: true, message: row.title });
        router.refresh();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, toast, router]);
  return (
    <Link href="/notifications" className="relative rounded-md p-2 text-ink-soft hover:bg-steel-wash hover:text-steel" aria-label={`Notifications, ${unread} unread`}>
      <Bell size={20} />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-signal-red px-1 text-center text-xs font-semibold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Link>
  );
}
