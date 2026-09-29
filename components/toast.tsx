"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; ok: boolean };
const Ctx = React.createContext<(t: { message?: string; ok: boolean }) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: { message?: string; ok: boolean }) => {
    if (!t.message) return;
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message: t.message!, ok: t.ok }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.ok ? 3500 : 7000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.ok ? "status" : "alert"} className={cn("rail rounded-md border border-line bg-panel py-3 pl-5 pr-4 text-sm shadow-lg", t.ok ? "rail-green" : "rail-red")}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => React.useContext(Ctx);

/** Runs a Server Action in a transition and shows its message as a toast. */
export function useAction() {
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const run = React.useCallback(<T,>(fn: () => Promise<{ ok: boolean; message?: string; data?: T }>, onOk?: (data?: T) => void) => {
    start(async () => {
      const r = await fn();
      toast({ ok: r.ok, message: r.message });
      if (r.ok) onOk?.(r.data);
    });
  }, [toast]);
  return { pending, run };
}
