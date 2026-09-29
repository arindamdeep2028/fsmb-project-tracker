import * as React from "react";
import { cn } from "@/lib/utils";

const control = "w-full rounded-md border border-line bg-panel px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-steel focus:outline-none disabled:bg-paper disabled:text-ink-faint";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2", className)} {...p} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(control, "h-10 pr-8", className)} {...p} />;
});

export function Field({ label, hint, error, htmlFor, children, className }: {
  label: string; hint?: string; error?: string; htmlFor?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? <p className="text-sm text-signal-red" role="alert">{error}</p> : hint ? <p className="text-sm text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function FormMessage({ result }: { result?: { ok: boolean; message?: string } | null }) {
  if (!result?.message) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={cn("rounded-md px-3 py-2 text-sm", result.ok ? "bg-signal-green/10 text-signal-green" : "bg-signal-red/10 text-signal-red")}>
      {result.message}
    </p>
  );
}
