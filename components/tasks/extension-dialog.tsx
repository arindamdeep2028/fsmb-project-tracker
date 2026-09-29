"use client";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, FormMessage } from "@/components/ui/form";
import { grantExtension } from "@/lib/actions/tasks";
import { fmt } from "@/lib/time";
import { useToast } from "@/components/toast";

export function ExtensionDialog({ open, onOpenChange, task }: { open: boolean; onOpenChange: (o: boolean) => void; task: { id: string; code: string; effective_due_at: string | null } }) {
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const toast = useToast();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Grant an extension for ${task.code}`} description={`Current deadline: ${fmt(task.effective_due_at)} (Dhaka)`}>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setPending(true);
          const r = await grantExtension(task.id, when, reason);
          setPending(false); setResult(r);
          if (r.ok) { toast({ ok: true, message: r.message }); onOpenChange(false); }
        }}>
          <Field label="New deadline (Dhaka time)" htmlFor="x-when"><Input id="x-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
          <Field label="Reason" htmlFor="x-reason" hint="Kept in the task's extension history."><Textarea id="x-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
          <FormMessage result={result && !result.ok ? result : null} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" pending={pending}>Grant extension</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
