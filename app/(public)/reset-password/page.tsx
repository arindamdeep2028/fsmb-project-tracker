import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "@/components/password-form";
import { FormMessage } from "@/components/ui/form";
import { RequestResetForm } from "./request-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    return (
      <>
        <h1 className="mb-1 text-2xl font-semibold">Choose a new password</h1>
        <p className="mb-6 text-ink-soft">You'll go straight to your dashboard afterwards.</p>
        <PasswordForm />
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-ink-soft">We'll email you a link to set a new one.</p>
      {expired ? <div className="mb-4"><FormMessage result={{ ok: false, message: "That link has expired. Request a new one." }} /></div> : null}
      <RequestResetForm />
      <Link href="/login" className="mt-4 block text-center text-sm text-steel hover:underline">Back to sign in</Link>
    </>
  );
}
