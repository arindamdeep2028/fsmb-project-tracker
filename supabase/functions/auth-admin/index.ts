// FSMB · auth-admin Edge Function
// Holds the service-role key (v2 §14.10). Actions:
//   status      – { admin_exists }                      (no sign-in needed; used by /setup)
//   setup       – create the first admin                (no sign-in; refused once an active admin exists)
//   invite      – create a user with role/department    (caller must be an active Admin)
//   reset_link  – email a password-reset link to a user (caller must be an active Admin)
// Role and department go in app_metadata, which users cannot change; migration 12 builds the profile.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/http.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ROLES = ["admin", "dept_head", "pm", "engineer"];

async function adminExists(): Promise<boolean> {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
  return (count ?? 0) > 0;
}

function temporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("") + "!7";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ message: "Use POST" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ message: "Invalid request" }, 400); }

  if (body.action === "status") return json({ admin_exists: await adminExists() });

  if (body.action === "setup") {
    if (await adminExists()) return json({ message: "Setup is already complete. Sign in instead." }, 403);
    const { email, password, full_name, login_name } = body as Record<string, string>;
    if (!email || !password || password.length < 10 || !full_name || !login_name) return json({ message: "Fill in every field." }, 400);
    const { error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { role: "admin", must_change_password: false },
      user_metadata: { full_name, login_name },
    });
    return error ? json({ message: error.message }, 400) : json({ ok: true });
  }

  // Everything below needs a signed-in, active Admin.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ message: "Sign in first." }, 401);
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who } = await caller.auth.getUser();
  if (!who.user) return json({ message: "Sign in first." }, 401);
  const { data: profile } = await admin.from("profiles").select("role, active").eq("id", who.user.id).maybeSingle();
  if (profile?.role !== "admin" || !profile.active) return json({ message: "You don't have permission to do that." }, 403);

  if (body.action === "invite") {
    const { email, full_name, login_name, role, department_id } = body as Record<string, string | null>;
    if (!email || !full_name || !login_name || !ROLES.includes(String(role))) return json({ message: "Fill in name, login name, email and role." }, 400);
    const temporary_password = temporaryPassword();
    const { error } = await admin.auth.admin.createUser({
      email, password: temporary_password, email_confirm: true,
      app_metadata: { role, department_id: department_id ?? null, must_change_password: true },
      user_metadata: { full_name, login_name },
    });
    if (error) return json({ message: error.message.includes("already") ? "That email already has an account." : error.message }, 400);
    return json({ ok: true, temporary_password });
  }

  if (body.action === "reset_link") {
    const { data: target } = await admin.from("profiles").select("email").eq("id", String(body.user_id)).maybeSingle();
    if (!target?.email) return json({ message: "That user has no email address." }, 400);
    const { error } = await caller.auth.resetPasswordForEmail(target.email, { redirectTo: String(body.redirect_to ?? "") || undefined });
    return error ? json({ message: error.message }, 400) : json({ ok: true });
  }

  return json({ message: "Unknown action" }, 400);
});
