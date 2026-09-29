"use client";
import { useActionState } from "react";
import Link from "next/link";
import { setupFirstAdmin } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupFirstAdmin, null);
  if (state?.ok) return (<div className="space-y-4"><FormMessage result={state} /><Link href="/login" className="font-medium text-steel hover:underline">Sign in</Link></div>);
  return (
    <form action={action} className="space-y-4">
      <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" required /></Field>
      <Field label="Login name" htmlFor="login_name" hint="Lower case, used to sign in."><Input id="login_name" name="login_name" required pattern="[a-zA-Z0-9._-]+" /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" required /></Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters."><Input id="password" name="password" type="password" minLength={10} required /></Field>
      <FormMessage result={state} />
      <Button type="submit" className="w-full" pending={pending}>Create admin account</Button>
    </form>
  );
}
