"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Megaphone, Menu, X } from "lucide-react";
import type { NavItem } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";

function isActive(path: string, href: string) {
  if (href === "/dashboard") return path === "/dashboard";
  return path === href || path.startsWith(href + "/");
}

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  const main = items.filter((i) => i.group !== "admin");
  const admin = items.filter((i) => i.group === "admin");
  const link = (i: NavItem) => (
    <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={isActive(path, i.href) ? "page" : undefined}
      data-testid={i.icon ? `nav-${i.icon}` : undefined}
      className={cn("block rounded-md px-3 py-2 text-[15px] text-white/75 hover:bg-white/8 hover:text-white",
        i.icon && "flex items-center gap-2",
        isActive(path, i.href) && "bg-nav-active font-medium text-white")}>
      {i.icon === "megaphone" ? <Megaphone size={17} aria-hidden className="shrink-0" /> : null}
      {i.icon ? <span className="flex-1">{i.label}</span> : i.label}
      {i.count ? (
        <span data-testid="nav-count" aria-label={`${i.count} unread`}
          className="grid h-5 min-w-5 place-items-center rounded-full bg-signal-red px-1.5 text-xs font-semibold text-white">{i.count > 99 ? "99+" : i.count}</span>
      ) : null}
    </Link>
  );
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {main.map(link)}
      {admin.length ? <div className="px-3 pb-1 pt-5 text-xs text-sage">Administration</div> : null}
      {admin.map(link)}
    </nav>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} className="rounded p-2 text-ink">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open ? (
        <div className="fixed inset-x-0 top-14 z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto bg-graphite p-3">
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
