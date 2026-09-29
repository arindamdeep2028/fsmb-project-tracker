"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabs({ base, tabs }: { base: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Project" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? path === base : path.startsWith(href);
        return (
          <Link key={t.href} href={href} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-[15px]", active ? "border-steel font-medium text-steel" : "border-transparent text-ink-soft hover:text-ink")}>{t.label}</Link>
        );
      })}
    </nav>
  );
}
