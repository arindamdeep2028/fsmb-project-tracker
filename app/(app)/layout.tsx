import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { navFor } from "@/lib/auth/nav";
import { unreadCount } from "@/lib/data/notifications";
import { roleLabel } from "@/lib/labels";
import { MobileNav, NavLinks } from "@/components/layout/nav-links";
import { NotificationBell } from "@/components/notifications/bell";
import { UserMenu } from "@/components/layout/user-menu";

/** Signed-in shell. requireSession re-reads the live profile on every request (Frontend Blueprint §5, layer 2). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const items = navFor(s);
  const unread = await unreadCount(s.userId);
  const canReport = s.memberProjectIds.length > 0;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-graphite px-3 py-5 md:flex">
        <Link href="/" className="mb-6 px-3 text-white">
          <span className="block text-lg font-semibold leading-tight">FSMB</span>
          <span className="block text-sm text-white/60">Project Tracker</span>
        </Link>
        {canReport ? (
          <Link href="/daily-reports/new" className="mb-5 rounded-md bg-steel px-3 py-2 text-center text-[15px] font-medium text-white hover:bg-steel-dark">Submit today's report</Link>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto"><NavLinks items={items} /></div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-2">
            <MobileNav items={items} />
            <span className="font-semibold md:hidden">FSMB</span>
          </div>
          <div className="flex items-center gap-1">
            {canReport ? <Link href="/daily-reports/new" className="mr-1 rounded-md bg-steel px-3 py-1.5 text-sm font-medium text-white md:hidden">Report</Link> : null}
            <NotificationBell userId={s.userId} initialUnread={unread} />
            <UserMenu name={s.profile.full_name} roleLabel={roleLabel[s.profile.role]} />
          </div>
        </header>
        <main className="mx-auto max-w-[88rem] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
