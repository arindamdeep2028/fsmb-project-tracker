import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, User } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getAnnouncementFeed, getAnnouncementTargets } from "@/lib/data/announcements";
import { departmentCounts, filterAnnouncements, parseTab, tabCounts, type AnnouncementTab } from "@/lib/announcements";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AnnouncementList, NewAnnouncementButton } from "@/components/announcements/announcement-list";

export const metadata: Metadata = { title: "Announcements" };

const tabLabel: Record<AnnouncementTab, string> = { all: "All", unread: "Unread", general: "General", projects: "Projects", expired: "Expired" };
const empty: Record<AnnouncementTab, string> = {
  all: "No announcements right now.", unread: "You're all caught up.", general: "No department announcements right now.",
  projects: "No project announcements right now.", expired: "No expired announcements.",
};

/**
 * Announcements: general (department) and project announcements. What appears is exactly what the database lets
 * this user read (RLS): Admin sees every announcement; others their department's and their projects'.
 */
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ tab?: string; dept?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const [items, targets] = await Promise.all([getAnnouncementFeed(), getAnnouncementTargets()]);
  const canPublish = s.isAdmin || targets.departments.length > 0 || targets.projects.length > 0;
  const showDeptFilter = s.isAdmin || targets.departments.length > 0;

  const depts = departmentCounts(items);
  const dept = showDeptFilter && sp.dept && depts.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  const tab = parseTab(sp.tab);
  const counts = tabCounts(items, dept);
  const list = filterAnnouncements(items, tab, dept);
  const tabs = (["all", "unread", "general", "projects"] as AnnouncementTab[]).concat(counts.expired > 0 || tab === "expired" ? ["expired"] : []);

  let ownDept: string | null = null;
  if (!showDeptFilter && s.profile.department_id) {
    const supabase = await createClient();
    const { data } = await supabase.from("departments").select("name").eq("id", s.profile.department_id).maybeSingle();
    ownDept = data?.name ?? null;
  }
  const q = (t: AnnouncementTab, d?: string) => {
    const p = new URLSearchParams();
    if (t !== "all") p.set("tab", t);
    if (d) p.set("dept", d);
    const str = p.toString();
    return str ? `?${str}` : "?";
  };

  return (
    <>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <Megaphone size={30} aria-hidden className="mt-0.5 shrink-0 text-ink" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
            <p className="mt-1 text-ink-soft">
              {s.isAdmin ? "General (department-wise) and project announcements from Admin and Project Managers."
                : "Announcements for your department and assigned projects."}
            </p>
          </div>
        </div>
        {canPublish ? <NewAnnouncementButton targets={targets} /> : null}
      </header>

      <nav aria-label="Announcement filters" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t} href={q(t, dept)} aria-current={tab === t ? "page" : undefined} data-testid={`tab-${t}`}
            className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-4 py-1.5 text-[15px] font-medium text-ink hover:border-steel aria-[current=page]:border-steel aria-[current=page]:bg-steel aria-[current=page]:text-white">
            {tabLabel[t]}
            {t === "unread"
              ? counts.unread > 0 ? <span className="grid min-w-5 place-items-center rounded-full bg-signal-red px-1.5 text-xs text-white">{counts.unread}</span> : <span>(0)</span>
              : <span>({counts[t]})</span>}
          </Link>
        ))}
      </nav>

      {showDeptFilter ? (
        depts.length ? (
          <nav aria-label="Department" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="mr-1 text-ink-soft">Department:</span>
            <Link href={q(tab)} aria-current={!dept ? "page" : undefined}
              className="rounded-md border border-line bg-panel px-3 py-1 font-medium hover:border-steel aria-[current=page]:border-steel aria-[current=page]:bg-steel aria-[current=page]:text-white">All Departments</Link>
            {depts.map((d) => (
              <Link key={d.id} href={q(tab, d.id)} aria-current={dept === d.id ? "page" : undefined}
                className="rounded-md border border-line bg-panel px-3 py-1 font-medium hover:border-steel aria-[current=page]:border-steel aria-[current=page]:bg-steel aria-[current=page]:text-white">
                {d.name} ({d.count})
              </Link>
            ))}
          </nav>
        ) : null
      ) : (
        <p className={cn("mb-4 flex items-center gap-2 rounded-md border border-signal-green/25 bg-signal-green/[0.06] px-4 py-2 text-sm")}>
          <User size={16} aria-hidden className="text-ink-soft" />
          Your Department: <span className="font-medium text-steel">{ownDept ?? "Not set — ask an Admin"}</span>
        </p>
      )}

      <AnnouncementList items={list} targets={targets} unread={counts.unread} emptyText={empty[tab]} />
    </>
  );
}
