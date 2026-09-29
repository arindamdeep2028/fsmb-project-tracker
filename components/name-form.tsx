"use client";
import { useActionState } from "react";
import { updateMyName } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateMyName, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Name" htmlFor="full_name"><Input id="full_name" name="full_name" defaultValue={name} required maxLength={120} /></Field>
      <FormMessage result={state} />
      <Button type="submit" size="sm" pending={pending}>Save name</Button>
    </form>
  );
}
