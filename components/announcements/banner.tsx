import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";

/**
 * Dashboard banner: only the megaphone, the word and an arrow. Opens the Announcements page.
 * `compact`: the slimmer bar of the Engineer dashboard (the other dashboards keep the default).
 */
export function AnnouncementBanner({ compact = false }: { compact?: boolean } = {}) {
  if (compact) {
    return (
      <Link href="/announcements" data-testid="announcement-banner"
        className="group flex items-center gap-3 rounded-lg border border-signal-amber/30 bg-[#fdf6e3] px-4 py-2.5 transition-colors hover:border-signal-amber/60 hover:bg-[#fbefd2]">
        <Megaphone size={22} aria-hidden className="shrink-0 text-signal-amber" />
        <span className="flex-1 text-[15px] font-semibold text-ink">Announcement</span>
        <ArrowRight size={20} aria-hidden className="shrink-0 text-signal-amber transition-transform group-hover:translate-x-1" />
      </Link>
    );
  }
  return (
    <Link href="/announcements" data-testid="announcement-banner"
      className="group mb-6 flex items-center gap-4 rounded-lg border border-signal-amber/30 border-l-4 border-l-signal-amber bg-[#fdf6e3] px-5 py-4 transition-colors hover:border-signal-amber/60 hover:bg-[#fbefd2]">
      <Megaphone size={28} aria-hidden className="shrink-0 text-signal-red" />
      <span className="flex-1 text-xl font-semibold tracking-tight text-ink">Announcement</span>
      <ArrowRight size={24} aria-hidden className="shrink-0 text-signal-amber transition-transform group-hover:translate-x-1" />
    </Link>
  );
}
