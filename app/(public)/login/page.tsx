import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-ink-soft">Use the login your admin gave you.</p>
      <LoginForm next={next} notice={reason === "inactive" ? "Your account is inactive. Contact your admin." : undefined} />
    </>
  );
}
