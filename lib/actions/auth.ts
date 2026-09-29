"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { callEdge } from "@/lib/edge";
import type { ActionResult } from "@/lib/errors";
import { password } from "@/lib/validation";
import { landingForRole } from "@/lib/auth/landing";

const GENERIC = "Email, login name or password is incorrect.";

/** Sign in with an email or a login name (resolved by the resolve-login Edge Function). */
export async function signIn(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const identifier = String(form.get("identifier") ?? "").trim();
  const pw = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  if (!identifier || !pw) return { ok: false, message: "Enter your email or login name and your password." };
  let email = identifier;
  if (!identifier.includes("@")) {
    const r = await callEdge<{ email: string | null }>("resolve-login", { login: identifier }, { asUser: false });
    if (!r.ok || !r.data.email) return { ok: false, message: GENERIC };
    email = r.data.email;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
  if (error || !data.user) return { ok: false, message: GENERIC };
  const { data: profile } = await supabase.from("profiles").select("role, active, must_change_password").eq("id", data.user.id).maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { ok: false, message: "Your account is inactive. Contact your admin." };
  }
  if (profile.must_change_password) redirect("/change-password");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : landingForRole(profile.role));
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
  await supabase.from("profiles").update({ must_change_password: false }).eq("id", auth.user.id);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  redirect(landingForRole(profile?.role));
}

/** First-time setup: allowed only while no active admin exists (checked inside auth-admin). */
export async function setupFirstAdmin(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const body = {
    action: "setup",
    full_name: String(form.get("full_name") ?? "").trim(),
    login_name: String(form.get("login_name") ?? "").trim().toLowerCase(),
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  };
  const p = password.safeParse(body.password);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  if (!body.full_name || !body.login_name || !body.email.includes("@")) return { ok: false, message: "Fill in every field." };
  const r = await callEdge("auth-admin", body, { asUser: false });
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, message: "Admin account created. Sign in to continue." };
}
