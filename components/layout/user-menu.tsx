"use client";
import * as DM from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-steel-wash">
        <span className="grid size-7 place-items-center rounded-full bg-steel text-xs font-semibold text-white">{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden text-left leading-tight sm:block"><span className="block font-medium">{name}</span><span className="block text-xs text-ink-faint">{roleLabel}</span></span>
        <ChevronDown size={16} className="text-ink-faint" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
          <DM.Item asChild><Link href="/settings" className="block rounded px-3 py-2 outline-none hover:bg-steel-wash data-[highlighted]:bg-steel-wash">My account</Link></DM.Item>
          <DM.Item asChild><Link href="/my-activity" className="block rounded px-3 py-2 outline-none hover:bg-steel-wash data-[highlighted]:bg-steel-wash">My activity</Link></DM.Item>
          <DM.Separator className="my-1 h-px bg-line-soft" />
          <form action="/auth/signout" method="post">
            <button type="submit" className="w-full rounded px-3 py-2 text-left hover:bg-steel-wash">Sign out</button>
          </form>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
