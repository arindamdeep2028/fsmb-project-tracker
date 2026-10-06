import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { loginNamesEnabled, signInCopy } from "@/lib/auth/sign-in";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  // login names are offered only when the server can resolve them (LOGIN_RESOLVER_SECRET); otherwise email only
  const loginNames = loginNamesEnabled(process.env.LOGIN_RESOLVER_SECRET);
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-ink-soft">{loginNames ? "Use the login your admin gave you." : "Use the email address and password your admin gave you."}</p>
      <LoginForm identifierLabel={signInCopy(loginNames).label} emailOnly={!loginNames} next={next} notice={reason === "inactive" ? "Your account is inactive. Contact your admin." : undefined} />
    </>
  );
}
