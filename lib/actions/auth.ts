"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { callEdge } from "@/lib/edge";
import type { ActionResult } from "@/lib/errors";
import { password } from "@/lib/validation";
import { landingForRole } from "@/lib/auth/landing";
import { emailForSignIn, loginNamesEnabled, signInCopy } from "@/lib/auth/sign-in";
import { safeNext } from "@/lib/auth/redirects";

/**
 * Sign in with an email address, or with a login name when the server holds LOGIN_RESOLVER_SECRET (lib/auth/sign-in.ts).
 * A login name is resolved by the resolve-login Edge Function, server to server with that secret; the email it
 * returns is used only for the password check below and never reaches the browser. A wrong password, an unknown
 * email and an unknown login name get the same answer.
 */
export async function signIn(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const identifier = String(form.get("identifier") ?? "").trim();
  const pw = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  const secret = process.env.LOGIN_RESOLVER_SECRET;
  const loginNames = loginNamesEnabled(secret);
  const copy = signInCopy(loginNames);
  if (!identifier || !pw) return { ok: false, message: loginNames ? "Enter your email or login name and your password." : "Enter your email address and your password." };
  const who = await emailForSignIn(identifier, {
    loginNames,
    resolve: async (login) => {
      const r = await callEdge<{ email: string | null }>("resolve-login", { login }, { asUser: false, headers: { "x-login-resolver-secret": secret ?? "" } });
      return r.ok ? { ok: true, email: r.data.email ?? null } : { ok: false };
    },
  });
  if ("message" in who) return { ok: false, message: who.message };
  const supabase = await createClient();
  // an unknown login name still gets a password check (against an address that cannot exist), like a wrong password
  const { data, error } = await supabase.auth.signInWithPassword({ email: "email" in who ? who.email : "unknown-login@invalid.invalid", password: pw });
  if (error || !data.user || !("email" in who)) return { ok: false, message: copy.generic };
  const { data: profile } = await supabase.from("profiles").select("role, active, must_change_password").eq("id", data.user.id).maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { ok: false, message: "Your account is inactive. Contact your admin." };
  }
  if (profile.must_change_password) redirect("/change-password");
  redirect(safeNext(next, landingForRole(profile.role)));
}

export async function requestPasswordReset(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim();
  if (!email.includes("@")) return { ok: false, message: "Enter the email address on your account." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });
  // Same answer whether or not the address exists.
  return { ok: true, message: "If that address has an account, a reset link is on its way." };
}

/** Used by /change-password (forced first change) and /reset-password (after the email link). */
export async function setNewPassword(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const pw = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const p = password.safeParse(pw);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  if (pw !== confirm) return { ok: false, message: "The two passwords don't match." };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Your link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { ok: false, message: error.message };
  // The database clears must_change_password when Supabase Auth stores the new password (migration 23); users can
  // no longer clear it themselves. The update below is a no-op there and keeps older databases working.
  await supabase.from("profiles").update({ must_change_password: false }).eq("id", auth.user.id);
  await supabase.auth.refreshSession();   // new token: its must_change_password claim is now false
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  redirect(landingForRole(profile?.role));
}

/**
 * First-time setup: allowed only while no active admin exists and only with the setup code (the SETUP_TOKEN
 * secret of the auth-admin Edge Function, which checks both). The code is passed on, never stored or logged.
 */
export async function setupFirstAdmin(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const body = {
    action: "setup",
    setup_token: String(form.get("setup_token") ?? ""),
    full_name: String(form.get("full_name") ?? "").trim(),
    login_name: String(form.get("login_name") ?? "").trim().toLowerCase(),
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  };
  const p = password.safeParse(body.password);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  if (!body.full_name || !body.login_name || !body.email.includes("@") || !body.setup_token) return { ok: false, message: "Fill in every field." };
  const r = await callEdge("auth-admin", body, { asUser: false });
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, message: "Admin account created. Sign in to continue." };
}
