import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { PasswordForm } from "@/components/password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const s = await requireSession({ allowPasswordChange: true });
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Set your own password</h1>
        <p className="mb-6 text-ink-soft">
          {s.profile.must_change_password ? `Welcome, ${s.profile.full_name}. Replace the temporary password before you continue.` : "Choose a new password for your account."}
        </p>
        <PasswordForm submitLabel="Save and continue" />
      </div>
    </main>
  );
}
