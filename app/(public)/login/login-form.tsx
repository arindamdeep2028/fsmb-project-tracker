"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="space-y-4">
      {notice && !state ? <FormMessage result={{ ok: false, message: notice }} /> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email or login name" htmlFor="identifier">
        <Input id="identifier" name="identifier" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage result={state} />
      <Button type="submit" className="w-full" pending={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <Link href="/reset-password" className="block text-center text-sm text-steel hover:underline">Forgot your password?</Link>
    </form>
  );
}
