"use client";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { MessageCircle, UserRound } from "lucide-react";
import { avatarColor, initials } from "@/lib/chat";
import { cn } from "@/lib/utils";
import type { PersonRow } from "./types";

export function Avatar({ id, name, size = 36, online, className }: { id: string | null | undefined; name: string | null | undefined; size?: number; online?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: avatarColor(id), fontSize: Math.round(size * 0.38) }} aria-hidden>
      {initials(name)}
      {online ? <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-signal-green" /> : null}
    </span>
  );
}

/** A mention inside a message: opens the person's card (profile where the app has one). */
export function MentionChip({ name, userId, person, mine, canSeeProfile, onMessage }: {
  name: string; userId: string; person?: PersonRow; mine: boolean; canSeeProfile: boolean; onMessage?: (userId: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" data-testid="mention-chip"
          className={cn("rounded px-1 font-medium underline-offset-2 hover:underline", mine ? "bg-white/20 text-white" : "bg-steel-wash text-steel")}>
          @{person?.full_name ?? name}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-64 rounded-lg border border-line bg-panel p-3 text-sm shadow-lg" data-testid="mention-card">
          <div className="flex items-center gap-3">
            <Avatar id={userId} name={person?.full_name ?? name} size={40} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{person?.full_name ?? name}</div>
              <div className="text-xs text-ink-soft">{person ? roleText(person) : "No longer has access to this conversation"}</div>
            </div>
          </div>
          {person?.joined_at ? <div className="mt-2 text-xs text-ink-faint">On this project since {new Date(person.joined_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {canSeeProfile ? (
              <Link href={`/performance/${userId}`} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:border-steel hover:text-steel">
                <UserRound size={14} /> Open profile
              </Link>
            ) : null}
            {onMessage && person ? (
              <button type="button" onClick={() => onMessage(userId)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:border-steel hover:text-steel">
                <MessageCircle size={14} /> Message
              </button>
            ) : null}
          </div>
          <Popover.Arrow className="fill-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function roleText(p: PersonRow): string {
  const role = p.role === "admin" ? "Admin" : p.role === "dept_head" ? "Department Head" : p.role === "pm" ? "Project Manager" : "Engineer";
  if (p.access === "pm") return "Project Manager";
  if (p.access === "member") return role === "Project Manager" ? "Engineer" : role;
  if (p.access === "admin") return "Admin";
  return "Department Head";
}
