"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Flag, Loader2 } from "lucide-react";
import { caretLines, caretToStart, cellInColumn, cellKeyAction, editableField, isCtrlEnter, toCellStart } from "@/lib/sheet-keys";
import { PRIORITY_TONE } from "@/lib/sheet";
import { priorityChoices } from "@/lib/labels";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/utils";

export type Priority = Enums<"task_priority">;
/** A cell's save state, shown in its corner. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Ctrl+Enter for a whole sheet (Responsibilities, Tasklist), caught before any cell sees it: in every editable cell
 * it goes back to the start of the cell (text: caret to the start of the first line; dropdown, date, number: the
 * focus stays) and nothing is inserted, saved or submitted. Outside an editable cell (read-only) nothing happens.
 */
export function onSheetKeyDownCapture(e: React.KeyboardEvent<HTMLElement>): void {
  if (!isCtrlEnter(e)) return;
  const el = editableField(e.target);
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  toCellStart(el);
}

/** Small mark in a cell's corner: spinner while saving, a tick once saved, a red mark when it was refused. */
export function SaveMark({ state, message }: { state: SaveState; message?: string }) {
  if (state === "idle") return null;
  return (
    <span data-testid="cell-save" data-state={state} title={state === "error" ? message : undefined} aria-live="polite"
      className={cn("pointer-events-none absolute right-0.5 top-0.5", state === "error" ? "text-[#b3261e]" : state === "saved" ? "text-[#1d6b40]" : "text-ink-soft")}>
      {state === "saving" ? <Loader2 size={12} className="animate-spin" aria-label="Saving" />
        : state === "saved" ? <Check size={12} aria-label="Saved" /> : <AlertCircle size={12} aria-label={message ? `Not saved: ${message}` : "Not saved"} />}
    </span>
  );
}

/** Runs a save and keeps a cell's state: saving → saved (for a moment) or error. */
export function useCellSave() {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function run(save: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    setState("saving");
    const r = await save().catch(() => ({ ok: false, message: "Couldn't reach the server. Try again." }));
    setState(r.ok ? "saved" : "error");
    setMessage(r.ok ? undefined : r.message);
    if (r.ok) timer.current = setTimeout(() => setState("idle"), 1800);
    return r.ok;
  }
  return { state, message, run, clear: () => setState("idle") };
}

/**
 * A spreadsheet text cell: type in place, Enter saves and goes down the column, Shift+Enter is a new line,
 * Esc puts the saved text back, Ctrl+Enter takes the caret to the start of the first line (nothing inserted or
 * saved). Arrow Up / Down on the first / last line move along the column. A refused save keeps the text, marked red.
 */
export function EditCell({ value, label, col, onSave, placeholder, maxLength = 5000, required, multiline, testId, autoFocus, className, disabled }: {
  value: string; label: string; col: string; onSave: (v: string) => Promise<{ ok: boolean; message?: string }>;
  placeholder?: string; maxLength?: number; required?: boolean; multiline?: boolean; testId?: string; autoFocus?: boolean;
  className?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { state, message, run, clear } = useCellSave();
  const bad = state === "error";
  useEffect(() => { if (!focused && !bad) setDraft(value); }, [value, focused, bad]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  async function commit() {
    const v = multiline ? draft.replace(/\s+$/, "") : draft.trim();
    if (v === value.trim() || (required && !v.trim())) { setDraft(value); if (bad) clear(); return; }
    await run(() => onSave(v));
  }
  const go = (dir: 1 | -1) => { const next = ref.current && cellInColumn(ref.current, dir); if (next) { next.focus(); return true; } return false; };

  return (
    <div className="relative">
      <textarea ref={ref} rows={1} aria-label={label} placeholder={placeholder} maxLength={maxLength} value={draft} data-testid={testId}
        data-col={col} disabled={disabled} aria-invalid={bad || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); void commit(); }}
        onChange={(e) => { setDraft(e.target.value); if (bad) clear(); }}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          const action = cellKeyAction(e, caretLines(el.value, el.selectionStart, el.selectionEnd));
          if (action === "caret-start") { e.preventDefault(); e.stopPropagation(); caretToStart(el); return; }
          if (action === "newline") { if (!multiline) e.preventDefault(); return; }
          if (action === "commit-down") { e.preventDefault(); if (!go(1)) el.blur(); return; }
          if (action === "cancel") { e.preventDefault(); setDraft(value); clear(); requestAnimationFrame(() => ref.current?.blur()); return; }
          if (action === "up" || action === "down") { if (go(action === "up" ? -1 : 1)) e.preventDefault(); }
        }}
        className={cn(`block min-h-7 w-full resize-none rounded border bg-transparent px-1.5 py-1 pr-4 text-[13px] leading-snug [field-sizing:content]
          placeholder:italic placeholder:text-ink-faint hover:border-line focus:border-steel focus:bg-[#fffdf3] focus:outline-none focus:ring-2 focus:ring-[#e9c46a]/50
          disabled:cursor-not-allowed disabled:hover:border-transparent`,
          bad ? "border-[#b3261e] bg-[#fbeceb]" : "border-transparent", className)} />
      <SaveMark state={state} message={message} />
    </div>
  );
}

/** A date cell (Dhaka calendar date): saves as soon as a date is chosen; Esc puts the saved one back. */
export function DateCell({ value, label, col, onSave, testId, overdue }: {
  value: string; label: string; col: string; onSave: (day: string) => Promise<{ ok: boolean; message?: string }>; testId?: string; overdue?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const { state, message, run, clear } = useCellSave();
  useEffect(() => { if (state !== "error") setDraft(value); }, [value, state]);
  async function commit(v: string) {
    if (!v || v === value) { setDraft(value); return; }
    await run(() => onSave(v));
  }
  return (
    <div className="relative">
      <input type="date" aria-label={label} value={draft} data-col={col} data-testid={testId} title={overdue ? "Past the deadline" : undefined}
        onChange={(e) => { setDraft(e.target.value); if (state === "error") clear(); }}
        onBlur={(e) => void commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(e.currentTarget.value); const n = cellInColumn(e.currentTarget, 1); n?.focus(); }
          if (e.key === "Escape") { e.preventDefault(); setDraft(value); clear(); }
        }}
        className={cn("h-8 w-full rounded border bg-transparent px-1 text-center text-[13px] font-medium hover:border-line focus:border-steel focus:bg-[#fffdf3] focus:outline-none focus:ring-2 focus:ring-[#e9c46a]/50",
          state === "error" ? "border-[#b3261e] bg-[#fbeceb]" : "border-transparent", overdue && "text-signal-red")} />
      <SaveMark state={state} message={message} />
    </div>
  );
}

const ICON: Partial<Record<string, typeof Flag>> = { Urgent: AlertTriangle, Important: Flag };

/** Priority as a coloured label: Normal plain, Important orange with a flag, Urgent red with a warning sign. */
export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const [bg, fg] = PRIORITY_TONE[priority] ?? PRIORITY_TONE.Normal;
  const Icon = ICON[priority];
  return (
    <span data-testid="priority" data-priority={priority}
      className={cn("inline-flex items-center justify-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", className)} style={{ background: bg, color: fg }}>
      {Icon ? <Icon size={12} aria-hidden /> : null}{priority}
    </span>
  );
}

/** Priority dropdown (Normal / Important / Urgent), coloured like its badge, with the same flag / warning icon. */
export function PrioritySelect({ value, label, onChange, disabled, col, className }: {
  value: string; label: string; onChange: (v: Priority) => void; disabled?: boolean; col?: string; className?: string;
}) {
  const [bg, fg] = PRIORITY_TONE[value] ?? PRIORITY_TONE.Normal;
  const Icon = ICON[value];
  return (
    <div className="relative">
      {Icon ? <Icon size={12} aria-hidden data-testid="priority-icon" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: fg }} /> : null}
      <select aria-label={label} value={value} disabled={disabled} data-col={col} data-testid="priority-select" data-priority={value}
        onChange={(e) => onChange(e.target.value as Priority)}
        className={cn("h-7 w-full rounded-md border-0 px-1 text-center text-xs font-semibold disabled:cursor-not-allowed", Icon && "pl-5", className)}
        style={{ background: bg, color: fg }}>
        {priorityChoices().map((x) => <option key={x} value={x} style={{ background: "#fff", color: "#26332b" }}>{x}</option>)}
      </select>
    </div>
  );
}
