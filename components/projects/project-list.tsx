"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ArrowLeftRight, ArrowRight, ChevronRight, Clock, EllipsisVertical, Pencil, Search, Settings } from "lucide-react";
import { changeProjectStatus } from "@/lib/actions/projects";
import { nextStatuses, projectStatusLabel, transitionLabel, type ProjectStatus } from "@/lib/project-status";
import { fmt, fmtDate } from "@/lib/time";
import { cn, pct } from "@/lib/utils";
import type { StatusHistoryRow } from "@/lib/data/projects";
import { Badge, EmptyState, Meter, Table } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import { ProjectStatusBadge, StatusChip } from "./project-status";

export type ProjectRow = {
  id: string; code: string; name: string; department: string | null; pm: string | null;
  completion: number | null; planned: number | null; atRisk: boolean; status: ProjectStatus; targetEnd: string | null;
  canManage: boolean;
};
export type StatusPill = { key: string; label: string; count: number; href: string; active: boolean; dot?: "running" | "halted" | "closed" };

const dot = { running: "bg-life-running", halted: "bg-life-halted", closed: "bg-signal-neutral" } as const;
const item = "flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 outline-none data-[highlighted]:bg-steel-wash data-[disabled]:cursor-default data-[disabled]:text-ink-faint";

type Open = { kind: "status"; project: ProjectRow; to: ProjectStatus } | { kind: "history"; project: ProjectRow } | null;

/** Projects of one category: status filters, search, table, Actions menu, status change and status history. */
export function ProjectList({ rows, pills, history, emptyText }: {
  rows: ProjectRow[]; pills: StatusPill[]; history: Record<string, StatusHistoryRow[]>; emptyText: React.ReactNode;
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<Open>(null);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => [r.code, r.name, r.department, r.pm].some((v) => v?.toLowerCase().includes(needle)))
    : rows;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Project status" className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <Link key={p.key} href={p.href} aria-current={p.active ? "page" : undefined} data-testid={`status-filter-${p.key}`}
              className={cn("inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                p.active ? "border-steel bg-steel text-white" : "border-line bg-panel text-ink hover:border-steel hover:text-steel")}>
              {p.dot ? <span aria-hidden className={cn("size-2.5 rounded-full", dot[p.dot])} /> : null}
              {p.label} ({p.count})
            </Link>
          ))}
        </nav>
        <label className="relative block w-full sm:w-80">
          <span className="sr-only">Search projects</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…"
            className="h-10 w-full rounded-md border border-line bg-panel pl-9 pr-3 text-[15px] placeholder:text-ink-faint focus:border-steel focus:outline-none" />
        </label>
      </div>

      {shown.length === 0 ? <EmptyState title={needle ? "No projects match your search" : "No projects here yet"}>{needle ? null : emptyText}</EmptyState> : (
        <Table className="rounded-lg border border-line bg-panel">
          <thead><tr><th>Project</th><th>Department</th><th>Lead PM</th><th className="w-48">Completion</th><th>Status</th><th>Target end</th><th className="w-16 text-right">Actions</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} data-testid={`project-row-${p.code}`}>
                <td><Link href={`/projects/${p.id}`} className="font-medium hover:text-steel hover:underline">{p.code}</Link> <span className="text-ink-soft">{p.name}</span>
                  {p.atRisk ? <Badge signal="red" className="ml-2">At risk</Badge> : null}</td>
                <td>{p.department ?? "—"}</td>
                <td>{p.pm ?? "—"}</td>
                <td><div className="flex items-center gap-2"><Meter value={p.completion} planned={p.planned} className="w-28" label={`${p.code} completion`} /><span>{pct(p.completion)}</span></div></td>
                <td><ProjectStatusBadge status={p.status} /></td>
                <td className="whitespace-nowrap">{fmtDate(p.targetEnd)}</td>
                <td className="text-right"><ActionsMenu project={p} onOpen={setOpen} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open?.kind === "status"} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open?.kind === "status" ? <StatusDialog project={open.project} to={open.to} onDone={() => setOpen(null)} /> : null}
      </Dialog>
      <Dialog open={open?.kind === "history"} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open?.kind === "history" ? <HistoryDialog project={open.project} rows={history[open.project.id] ?? []} /> : null}
      </Dialog>
    </>
  );
}

function ActionsMenu({ project: p, onOpen }: { project: ProjectRow; onOpen: (o: Open) => void }) {
  const next = nextStatuses(p.status);
  return (
    // modal={false}: the menu hands focus straight to the dialog it opens
    <DM.Root modal={false}>
      <DM.Trigger aria-label={`Actions for ${p.code}`} data-testid={`actions-${p.code}`}
        className="inline-grid size-8 place-items-center rounded-md text-ink-soft hover:bg-steel-wash hover:text-ink data-[state=open]:bg-steel-wash">
        <EllipsisVertical size={18} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-40 min-w-52 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
          {p.canManage ? (
            <DM.Item asChild className={item}><Link href={`/projects/${p.id}/settings`}><Pencil size={16} aria-hidden />Edit project</Link></DM.Item>
          ) : null}
          {p.canManage ? (
            <DM.Sub>
              <DM.SubTrigger className={cn(item, "data-[state=open]:bg-steel-wash")}><ArrowLeftRight size={16} aria-hidden />Change status<ChevronRight size={16} aria-hidden className="ml-auto" /></DM.SubTrigger>
              <DM.Portal>
                <DM.SubContent sideOffset={6} className="z-40 min-w-52 rounded-md border border-line bg-panel p-1 text-sm shadow-lg">
                  {next.map((to) => (
                    <DM.Item key={to} className={item} onSelect={() => onOpen({ kind: "status", project: p, to })}>
                      <ProjectStatusDot status={to} />{transitionLabel(p.status, to)}
                    </DM.Item>
                  ))}
                  {p.status === "Active" || p.status === "On hold" || p.status === "Completed" ? (
                    <DM.Item className={cn(item, "font-medium")}><ProjectStatusDot status={p.status} />Keep as {projectStatusLabel(p.status)}</DM.Item>
                  ) : null}
                </DM.SubContent>
              </DM.Portal>
            </DM.Sub>
          ) : null}
          <DM.Item className={item} onSelect={() => onOpen({ kind: "history", project: p })}><Clock size={16} aria-hidden />View status history</DM.Item>
          {p.canManage ? (
            <DM.Item asChild className={item}><Link href={`/projects/${p.id}/settings`}><Settings size={16} aria-hidden />Project settings</Link></DM.Item>
          ) : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function ProjectStatusDot({ status }: { status: ProjectStatus }) {
  const c = status === "Active" ? "bg-life-running" : status === "On hold" ? "bg-life-halted" : "bg-signal-neutral";
  return <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", c)} />;
}

function StatusDialog({ project: p, to, onDone }: { project: ProjectRow; to: ProjectStatus; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ ok: boolean; message?: string } | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await changeProjectStatus(p.id, to, reason.trim() || undefined);
      setResult(r);
      if (r.ok) { toast(r); onDone(); router.refresh(); }
    });
  }
  return (
    <DialogContent persistent title={transitionLabel(p.status, to)}
      description={`${p.code} ${p.name}: ${projectStatusLabel(p.status)} → ${projectStatusLabel(to)}. The change is kept in the project's status history.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason (optional)" htmlFor="status-reason" hint="For example: hardware availability issue">
          <Textarea id="status-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormMessage result={result && !result.ok ? result : null} />
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
          <Button type="submit" pending={pending}>{transitionLabel(p.status, to)}</Button>
        </div>
      </form>
    </DialogContent>
  );
}

function HistoryDialog({ project: p, rows }: { project: ProjectRow; rows: StatusHistoryRow[] }) {
  return (
    <DialogContent title="Project Status History" className="max-w-3xl">
      <h3 className="mb-3 font-semibold"><span className="text-ink-soft">{p.code}</span> {p.name}</h3>
      {rows.length === 0 ? <p className="text-sm text-ink-soft">No status changes recorded yet.</p> : (
        <Table className="rounded-md border border-line">
          <thead><tr><th>Date &amp; Time</th><th>Change</th><th>By</th><th>Reason</th></tr></thead>
          <tbody data-testid="status-history">
            {rows.map((h) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap">{fmt(h.changed_at, "dd MMM yyyy, HH:mm")}</td>
                <td className="whitespace-nowrap">
                  {h.kind === "baseline"
                    ? <span className="inline-flex items-center gap-2"><span className="text-ink-soft">Status on record</span><StatusChip status={h.to_status} /></span>
                    : <span className="inline-flex items-center gap-2"><StatusChip status={h.from_status} kind={h.kind} /><ArrowRight size={14} aria-label="to" /><StatusChip status={h.to_status} /></span>}
                </td>
                <td className="whitespace-nowrap">{h.changed_by_name ?? "—"}</td>
                <td className="text-ink-soft">{h.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </DialogContent>
  );
}
