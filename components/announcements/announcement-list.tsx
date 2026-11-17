"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Calendar, Check, Clock, Ellipsis, Folder, Megaphone, Pin, Plus, User } from "lucide-react";
import { deleteAnnouncement, markAllAnnouncementsRead, markAnnouncementRead, markAnnouncementUnread } from "@/lib/actions/announcements";
import { expiryDay, priorityTone, type Announcement, type AnnouncementTargets } from "@/lib/announcements";
import { roleLabel } from "@/lib/labels";
import { fmt, fmtDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AnnouncementForm } from "@/components/announcements/announcement-form";

const when = (ts: string) => fmt(ts, "dd-MMM-yy, hh:mm a");
const tone = {
  red: { card: "border-signal-red/25 bg-signal-red/[0.04]", icon: "text-signal-red" },
  amber: { card: "border-signal-amber/30 bg-signal-amber/[0.05]", icon: "text-signal-amber" },
  green: { card: "border-signal-green/25 bg-signal-green/[0.04]", icon: "text-signal-green" },
};

function person(name: string | null, role: Announcement["author_role"]) {
  if (!name) return "A former user";
  return role ? `${name} (${roleLabel[role]})` : name;
}

function Chips({ a }: { a: Announcement }) {
  return (
    <>
      {a.kind === "general"
        ? <span className="rounded bg-signal-red px-2 py-0.5 text-xs font-medium text-white">General</span>
        : <span className="rounded bg-signal-green px-2 py-0.5 text-xs font-medium text-white">Project: {a.project_code ? `${a.project_code} ${a.project_name ?? ""}`.trim() : "—"}</span>}
      {a.department_names.map((d) => <span key={d} className="rounded border border-line bg-panel px-2 py-0.5 text-xs font-medium text-steel">{d}</span>)}
      {a.priority !== "Normal" ? (
        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", a.priority === "Urgent" ? "bg-signal-red/10 text-signal-red" : "bg-signal-amber/12 text-signal-amber")}>{a.priority}</span>
      ) : null}
    </>
  );
}

function Meta({ a }: { a: Announcement }) {
  const exp = expiryDay(a.expires_at);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      <span className="inline-flex items-center gap-1"><User size={13} aria-hidden />Announced by: {person(a.author_name, a.author_role)}</span>
      <span aria-hidden className="text-line">|</span>
      <span className="inline-flex items-center gap-1"><Calendar size={13} aria-hidden />{when(a.published_at)}</span>
      {a.updated_at ? <span>· Edited {when(a.updated_at)}{a.updated_by_name ? ` by ${person(a.updated_by_name, a.updated_by_role)}` : ""}</span> : null}
      {exp ? <span className={cn("inline-flex items-center gap-1", a.expired && "text-signal-red")}><Clock size={13} aria-hidden />{a.expired ? "Expired" : "Until"} {fmtDate(exp)}</span> : null}
      {a.audience != null ? <span>· Read by {a.readers ?? 0} of {a.audience}</span> : null}
    </div>
  );
}

/**
 * The announcement cards. Opening one shows the full message and marks it read for this user (it stays in All).
 * The ⋯ menu offers mark unread, and edit / delete where the database says this user may manage it.
 */
export function AnnouncementList({ items, targets, unread, emptyText }: {
  items: Announcement[]; targets: AnnouncementTargets; unread: number; emptyText: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Announcement | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<Announcement | null>(null);
  const [localRead, setLocalRead] = React.useState<Set<string>>(new Set());
  const open = items.find((a) => a.id === openId) ?? null;

  function openItem(a: Announcement) {
    setOpenId(a.id);
    if (!a.read_at && !localRead.has(a.id)) {
      setLocalRead((s) => new Set(s).add(a.id));
      markAnnouncementRead(a.id).then(() => router.refresh());
    }
  }
  const isRead = (a: Announcement) => !!a.read_at || localRead.has(a.id);

  return (
    <>
      {unread > 0 ? (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" pending={pending} onClick={() => run(() => markAllAnnouncementsRead(), () => router.refresh())}>Mark all as read</Button>
        </div>
      ) : null}

      {items.length ? (
        <ul className="space-y-3" data-testid="announcement-list">
          {items.map((a) => {
            const t = tone[priorityTone(a.priority)];
            const read = isRead(a);
            const Icon = a.kind === "project" ? Folder : Megaphone;
            return (
              <li key={a.id} data-testid="announcement-card" data-title={a.title} data-read={read ? "1" : "0"}
                className={cn("relative rounded-lg border px-4 py-3.5 transition-colors", t.card, a.expired && "opacity-75")}>
                <div className="flex items-start gap-3.5">
                  <Icon size={28} aria-hidden className={cn("mt-0.5 shrink-0", t.icon)} fill={a.kind === "project" ? "currentColor" : "none"} fillOpacity={0.25} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => openItem(a)} className={cn("text-left text-[16px] hover:text-steel hover:underline", read ? "font-medium" : "font-semibold")}>
                        <span className="absolute inset-0" aria-hidden />
                        {a.title}
                      </button>
                      <Chips a={a} />
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-ink">{a.message}</p>
                    <Meta a={a} />
                  </div>
                  <div className="relative z-10 flex shrink-0 flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      {a.pinned ? <span className="inline-flex items-center gap-1 rounded bg-signal-amber/15 px-2 py-0.5 text-xs font-medium text-signal-amber"><Pin size={12} aria-hidden />Pinned</span> : null}
                      <DM.Root>
                        <DM.Trigger aria-label={`More actions for ${a.title}`} className="rounded p-1 text-ink-soft hover:bg-steel-wash hover:text-ink"><Ellipsis size={18} /></DM.Trigger>
                        <DM.Portal>
                          <DM.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
                            <DM.Item onSelect={() => openItem(a)} className="cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash">Open</DM.Item>
                            {read ? (
                              <DM.Item onSelect={() => { setLocalRead((s) => { const n = new Set(s); n.delete(a.id); return n; }); run(() => markAnnouncementUnread(a.id), () => router.refresh()); }}
                                className="cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash">Mark as unread</DM.Item>
                            ) : null}
                            {a.can_edit ? (
                              <>
                                <DM.Item onSelect={() => { setEditing(a); setFormOpen(true); }} className="cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash">Edit</DM.Item>
                                <DM.Item onSelect={() => setConfirmDelete(a)} className="cursor-pointer rounded px-3 py-2 text-signal-red outline-none data-[highlighted]:bg-signal-red/10">Delete</DM.Item>
                              </>
                            ) : null}
                          </DM.Content>
                        </DM.Portal>
                      </DM.Root>
                    </div>
                    {a.expired ? <span className="text-xs font-medium text-ink-soft">Expired</span>
                      : read ? <span className="inline-flex items-center gap-1 text-xs font-medium text-signal-green"><Check size={14} aria-hidden />Read</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-signal-red"><span className="size-2 rounded-full bg-signal-red" aria-hidden />Unread</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-ink-soft">{emptyText}</p>}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        {open ? (
          <DialogContent title={open.title} className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Chips a={open} />
              {open.pinned ? <span className="inline-flex items-center gap-1 rounded bg-signal-amber/15 px-2 py-0.5 text-xs font-medium text-signal-amber"><Pin size={12} aria-hidden />Pinned</span> : null}
            </div>
            <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed" data-testid="announcement-message">{open.message}</p>
            <div className="mt-4 border-t border-line-soft pt-3"><Meta a={open} /></div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        {confirmDelete ? (
          <DialogContent title="Delete this announcement?" description="It is removed for everyone, with its read marks. To keep it but stop showing it, edit it and set an expiry date instead.">
            <p className="mb-4 font-medium">{confirmDelete.title}</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" pending={pending} onClick={() => run(() => deleteAnnouncement(confirmDelete.id), () => { setConfirmDelete(null); router.refresh(); })}>Delete</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <AnnouncementForm open={formOpen} onOpenChange={setFormOpen} targets={targets} editing={editing} />
    </>
  );
}

/** Header button (desktop); opens the same form. */
export function NewAnnouncementButton({ targets }: { targets: AnnouncementTargets }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-announcement"><Plus size={18} aria-hidden />New Announcement</Button>
      <AnnouncementForm open={open} onOpenChange={setOpen} targets={targets} />
    </>
  );
}
