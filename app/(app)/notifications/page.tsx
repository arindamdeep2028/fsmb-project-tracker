import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { listNotifications } from "@/lib/data/notifications";
import { notificationLabel } from "@/lib/labels";
import { PageHeader } from "@/components/ui/misc";
import { NotificationList } from "@/components/notifications/notification-list";
import type { Enums } from "@/types/database";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ type?: string; unread?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const type = (sp.type && sp.type in notificationLabel ? sp.type : undefined) as Enums<"notification_type"> | undefined;
  const items = await listNotifications(s.userId, { type, unread: sp.unread === "1" });
  const filters: [string, string][] = [["", "All"], ["unread=1", "Unread"], ...Object.entries(notificationLabel).map(([k, v]) => [`type=${k}`, v] as [string, string])];
  const current = sp.unread === "1" ? "unread=1" : type ? `type=${type}` : "";
  return (
    <>
      <PageHeader title="Notifications" lead="Kept for 90 days. Choose which ones also come by email in My account." />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter">
        {filters.map(([q, label]) => (
          <a key={q} href={q ? `?${q}` : "?"} aria-current={current === q ? "page" : undefined}
            className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-steel-wash aria-[current=page]:bg-steel aria-[current=page]:text-white">{label}</a>
        ))}
      </nav>
      <NotificationList items={items} />
    </>
  );
}
