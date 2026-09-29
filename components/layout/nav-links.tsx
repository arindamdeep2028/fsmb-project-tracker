"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
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
      className={cn("block rounded-md px-3 py-2 text-[15px] text-white/75 hover:bg-white/8 hover:text-white",
        isActive(path, i.href) && "bg-white/12 font-medium text-white")}>
      {i.label}
    </Link>
  );
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {main.map(link)}
      {admin.length ? <div className="px-3 pb-1 pt-5 text-xs text-white/45">Administration</div> : null}
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
