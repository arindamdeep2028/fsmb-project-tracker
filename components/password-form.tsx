"use client";
import { useActionState } from "react";
import { setNewPassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function PasswordForm({ submitLabel = "Save new password" }: { submitLabel?: string }) {
  const [state, action, pending] = useActionState(setNewPassword, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password" htmlFor="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label="Type it again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <FormMessage result={state} />
      <Button type="submit" className="w-full" pending={pending}>{submitLabel}</Button>
    </form>
  );
}
