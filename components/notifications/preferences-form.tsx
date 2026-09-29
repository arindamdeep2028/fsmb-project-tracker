"use client";
import { useState } from "react";
import { savePreferences } from "@/lib/actions/notifications";
import { notificationLabel } from "@/lib/labels";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Enums } from "@/types/database";

type T = Enums<"notification_type">;
const TYPES = Object.keys(notificationLabel) as T[];
const MANDATORY = new Set<T>(["task_assigned", "task_overdue"]);

export function PreferencesForm({ initial }: { initial: { type: T; in_app: boolean; email: boolean }[] }) {
  const map = new Map(initial.map((p) => [p.type, p]));
  const [rows, setRows] = useState(TYPES.map((t) => ({ type: t, in_app: map.get(t)?.in_app ?? true, email: map.get(t)?.email ?? false })));
  const { pending, run } = useAction();
  const set = (t: T, k: "in_app" | "email", v: boolean) => setRows((rs) => rs.map((r) => (r.type === t ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2 font-medium">Notification</th><th className="w-24 font-medium">In app</th><th className="w-24 font-medium">Email</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} className="border-t border-line-soft">
              <td className="py-2.5">{notificationLabel[r.type]}{MANDATORY.has(r.type) ? <span className="ml-2 text-xs text-ink-faint">always in app</span> : null}</td>
              <td><input type="checkbox" aria-label={`${notificationLabel[r.type]} in app`} checked={r.in_app} disabled={MANDATORY.has(r.type)} onChange={(e) => set(r.type, "in_app", e.target.checked)} /></td>
              <td><input type="checkbox" aria-label={`${notificationLabel[r.type]} by email`} checked={r.email} onChange={(e) => set(r.type, "email", e.target.checked)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button pending={pending} onClick={() => run(() => savePreferences(rows))}>Save preferences</Button>
    </div>
  );
}
