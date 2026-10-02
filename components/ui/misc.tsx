import Link from "next/link";
import * as React from "react";
import { cn, pct } from "@/lib/utils";
import type { Signal } from "@/lib/labels";

export function PageHeader({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lead ? <p className="mt-1 max-w-[70ch] text-ink-soft">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const signalText: Record<Signal, string> = {
  red: "text-signal-red", amber: "text-signal-amber", green: "text-signal-green", neutral: "text-ink", done: "text-ink-soft",
};

/** A figure with its label; the figure takes the signal colour when it means trouble. */
export function Kpi({ label, value, signal = "neutral", href }: { label: string; value: React.ReactNode; signal?: Signal; href?: string }) {
  const body = (
    <>
      <div className={cn("text-3xl font-semibold leading-none", signalText[signal])}>{value}</div>
      <div className="mt-2 text-sm text-ink-soft">{label}</div>
    </>
  );
  const cls = "block rounded-lg border border-line bg-panel px-4 py-4";
  if (!href) return <div className={cls}>{body}</div>;
  // same-page sections (#…) use a plain anchor so the browser jumps; pages use client navigation
  return href.startsWith("#") ? <a href={href} className={cn(cls, "hover:border-steel")}>{body}</a> : <Link href={href} className={cn(cls, "hover:border-steel")}>{body}</Link>;
}

export function Badge({ children, signal = "neutral", className }: { children: React.ReactNode; signal?: Signal; className?: string }) {
  const tone: Record<Signal, string> = {
    red: "bg-signal-red/10 text-signal-red", amber: "bg-signal-amber/12 text-signal-amber", green: "bg-signal-green/10 text-signal-green",
    neutral: "bg-steel-wash text-steel-dark", done: "bg-line-soft text-ink-soft",
  };
  return <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tone[signal], className)}>{children}</span>;
}

/** Measurement bar: value with an optional planned marker (the tick shows where the schedule says it should be). */
export function Meter({ value, planned, label, className }: { value: number | null | undefined; planned?: number | null; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  return (
    <div className={cn("w-full", className)}>
      <div className="relative h-2 rounded-full bg-line-soft" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label ?? "Progress"}>
        <div className="h-2 rounded-full bg-steel" style={{ width: `${v}%` }} />
        {planned != null ? <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `calc(${Math.min(100, planned)}% - 1px)` }} title={`Planned ${pct(planned)}`} /> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-soft">{children}</div> : null}
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-ink-soft">
        {children}
      </table>
    </div>
  );
}

/**
 * A dashboard figure that opens the records it counts. Same colour as before; a dotted underline says it's
 * clickable. Nothing to open (0 or no value) → plain text, so no empty list is offered as if it had records.
 */
export function CountLink({ href, value, children, className, label }: { href: string; value: number | null | undefined; children?: React.ReactNode; className?: string; label?: string }) {
  const body = children ?? value ?? 0;
  if (!value) return <span className={className}>{body}</span>;
  return <Link href={href} aria-label={label} className={cn("underline decoration-dotted underline-offset-4 hover:text-steel hover:decoration-solid", className)}>{body}</Link>;
}
