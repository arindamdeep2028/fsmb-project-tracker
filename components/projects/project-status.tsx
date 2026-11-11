import { CircleCheck, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectStatusLabel, projectStatusTone, type ProjectStatus } from "@/lib/project-status";

const tone = {
  running: "bg-life-running-wash text-life-running",
  halted: "bg-life-halted-wash text-life-halted",
  closed: "bg-life-closed-wash text-life-closed",
} as const;

/** Lifecycle badge: Running green, Halted orange, Completed neutral grey. Separate from the At risk badge. */
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = projectStatusTone(status);
  const Icon = status === "Active" ? Play : status === "On hold" ? Pause : status === "Completed" ? CircleCheck : null;
  return (
    <span data-testid="project-status" className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap", tone[t], className)}>
      {Icon ? <Icon size={14} aria-hidden className={status === "Active" || status === "On hold" ? "fill-current" : undefined} /> : null}
      {projectStatusLabel(status)}
    </span>
  );
}

/** Compact chip for the status history table. `null` = the project's creation (or the history baseline). */
export function StatusChip({ status, kind }: { status: ProjectStatus | null; kind?: string }) {
  if (!status) {
    return <span className="inline-flex rounded px-2 py-0.5 text-[13px] font-medium bg-line-soft text-ink-soft">{kind === "baseline" ? "Recorded" : "Created"}</span>;
  }
  return <span className={cn("inline-flex rounded px-2 py-0.5 text-[13px] font-medium", tone[projectStatusTone(status)])}>{projectStatusLabel(status)}</span>;
}
