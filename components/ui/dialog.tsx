"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/**
 * `persistent`: only the dialog's own buttons (and the X) close it — clicks outside it and the Escape key do
 * nothing, so a half-filled form is never lost by accident.
 */
export function DialogContent({ title, description, children, className, persistent }: {
  title: string; description?: string; children: React.ReactNode; className?: string; persistent?: boolean;
}) {
  const keepOpen = persistent ? (e: Event) => e.preventDefault() : undefined;
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-graphite/40" />
      <D.Content onPointerDownOutside={keepOpen} onInteractOutside={keepOpen} onEscapeKeyDown={keepOpen} className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-panel p-6 shadow-xl", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-ink-soft">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close aria-label="Close" className="rounded p-1 text-ink-faint hover:text-ink"><X size={18} /></D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
