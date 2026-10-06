// FSMB · auth-admin Edge Function
// Holds the service-role key (v2 §14.10). Actions (logic and rules: ./handler.ts):
//   status      – { admin_exists, setup_enabled }        (no sign-in needed; used by /setup)
//   setup       – create the first admin                (needs the SETUP_TOKEN function secret and its value from the
//                                                        caller, and zero active admins; switched off when the secret is unset)
//   invite      – create a user with role/department/password (caller must be an active Admin)
//   reset_link  – email a password-reset link to a user (caller must be an active Admin)
//   change_own_password – the signed-in caller replaces their own password (any active user); stores it through the
//                  Admin Auth API after checking it differs from the current one, then clears "must change password".
//                  Supabase Auth signs the account out everywhere on a password change, so they sign in again.
//   sync_access – make a user's Auth account follow their profile: banned while inactive (caller must be an active Admin)
//   set_password – set ANOTHER user's password through the Admin Auth API (caller must be an active Admin);
//                  the account is then marked "must change password".
//                  The caller's own password and session are never touched; passwords are never stored,
//                  returned or logged — only the fact of the change goes to the activity log.
// Role and department go in app_metadata, which users cannot change; migration 12 builds the profile.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/http.ts";
import { handleAuthAdmin, type AuthAdminDeps } from "./handler.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const asCaller = (authHeader: string) => createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });

const deps: AuthAdminDeps = {
  setupToken: Deno.env.get("SETUP_TOKEN") ?? undefined,
  async activeAdminCount() {
    const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
    if (error || typeof count !== "number") throw new Error("admin count unavailable");
    return count;
  },
  async createUser(u) {
    const { data, error } = await admin.auth.admin.createUser({ ...u, email_confirm: true });
    return { id: data?.user?.id ?? null, error: error?.message ?? null };
  },
  async callerId(authHeader) {
    const { data } = await asCaller(authHeader).auth.getUser();
    return data.user?.id ?? null;
  },
  async profile(id) {
    const { data, error } = await admin.from("profiles").select("role, active, email, login_name, must_change_password").eq("id", id).maybeSingle();
    if (error) throw new Error("profile unavailable");
    return data;
  },
  async loginNameTaken(loginName) {
    const { data } = await admin.from("profiles").select("id").eq("login_name", loginName).maybeSingle();
    return Boolean(data);
  },
  async setPassword(userId, password) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    return error?.message ?? null;
  },
  async passwordIsCurrent(email, password) {
    // The only way to know: try to sign in with it. A fresh client, so no session is kept.
    const probe = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (data?.session) { await probe.auth.signOut().catch(() => {}); return true; }
    if (error && (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message))) return false;
    throw new Error("could not check the current password");
  },
  async clearPasswordChange(userId) {
    const { error } = await admin.from("profiles").update({ must_change_password: false }).eq("id", userId);
    return error?.message ?? null;
  },
  async requirePasswordChange(userId) {
    const { error } = await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
    return error?.message ?? null;
  },
  async setBanned(userId, banned) {
    // ~100 years, or lifted. A banned account cannot sign in or refresh its session.
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
    return error?.message ?? null;
  },
  async logPasswordChange(userId, actorId) {
    await admin.from("activity_log").insert({
      action: "Edited", scope: "user", subject_user_id: userId, actor_user_id: actorId, source: "app",
      details: "Password changed by an administrator",
    });
  },
  async sendResetLink(authHeader, email, redirectTo) {
    const { error } = await asCaller(authHeader).auth.resetPasswordForEmail(email, { redirectTo });
    return error?.message ?? null;
  },
  temporaryPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    return Array.from(bytes, (b) => chars[b % chars.length]).join("") + "!7";
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: unknown = null;
  if (req.method === "POST") {
    try { body = await req.json(); } catch { return json({ message: "Invalid request" }, 400); }
  }
  const r = await handleAuthAdmin({ method: req.method, authHeader: req.headers.get("Authorization"), body }, deps);
  return json(r.body, r.status);
});
