import { breachLabel, deadlineSignal, deadlineStatusLabel } from "@/lib/labels";
import { fmt } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Effective deadline in Dhaka time, on a signal rail coloured by the database's deadline status. */
export function DeadlineChip({ due, status, isRed, className }: { due: string | null | undefined; status: string | null | undefined; isRed?: boolean | null; className?: string }) {
  const signal = deadlineSignal(status, isRed);
  return (
    <span className={cn("rail inline-flex flex-col py-0.5 pl-3 text-sm leading-tight", `rail-${signal}`, className)}>
      <span className="font-medium">{fmt(due)}</span>
      {status ? <span className="text-xs text-ink-soft">{deadlineStatusLabel[status] ?? status}</span> : null}
    </span>
  );
}

export function RedReasons({ reasons }: { reasons: string[] | null | undefined }) {
  if (!reasons?.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-signal-red">
      {reasons.map((r) => <li key={r}>{breachLabel[r as keyof typeof breachLabel] ?? r}</li>)}
    </ul>
  );
}
