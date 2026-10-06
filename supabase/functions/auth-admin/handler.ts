// FSMB · auth-admin: the request logic, free of Deno and Supabase imports so it runs under the unit tests
// (tests/unit/auth-admin.test.ts). index.ts supplies the real database and Auth calls.
//
// Rules this file guarantees:
//   - "setup" (first admin) is refused unless the function secret SETUP_TOKEN is configured AND the caller sends
//     it AND the database positively reports zero active admins. A failed count is never read as "no admin".
//   - Every other action needs a signed-in caller whose profile, read from the database, is an active admin
//     who is not themselves waiting for a forced password change. A failed profile read is a refusal.
//   - A password an admin sets for someone is temporary: that person must replace it at their next sign-in.
//   - change_own_password is the ONLY thing that clears "must change password": it stores a new password for the
//     signed-in caller after checking that it is not the password they have now, then clears the flag. If it
//     cannot check, it changes nothing. (Supabase Auth rewrites the stored hash at sign-in when it re-encrypts,
//     so "the hash changed" proves nothing; "we stored a different password" does.)
//   - sync_access makes the Auth account follow the profile: a deactivated person can no longer sign in or
//     refresh a session; reactivating lifts that.

export type Result = { status: number; body: Record<string, unknown> };

export type AuthAdminDeps = {
  /** function secret SETUP_TOKEN; undefined or shorter than 16 characters = first-time setup is disabled */
  setupToken: string | undefined;
  /** number of active admins; MUST throw when the query fails */
  activeAdminCount(): Promise<number>;
  createUser(u: { email: string; password: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> }): Promise<{ id: string | null; error: string | null }>;
  /** id of the user the Authorization header belongs to, or null */
  callerId(authHeader: string): Promise<string | null>;
  /** role, status, email and login name of a profile, or null; MUST throw when the query fails */
  profile(id: string): Promise<{ role: string; active: boolean; email: string | null; login_name: string | null; must_change_password?: boolean } | null>;
  loginNameTaken(loginName: string): Promise<boolean>;
  setPassword(userId: string, password: string): Promise<string | null>;
  /** true when `password` is the account's current password; MUST throw when that cannot be determined */
  passwordIsCurrent(email: string, password: string): Promise<boolean>;
  /** records that the person has replaced their password; returns an error message or null */
  clearPasswordChange(userId: string): Promise<string | null>;
  /** marks the account as needing a password change at next sign-in; returns an error message or null */
  requirePasswordChange(userId: string): Promise<string | null>;
  /** blocks (true) or unblocks (false) the Auth account itself; returns an error message or null */
  setBanned(userId: string, banned: boolean): Promise<string | null>;
  logPasswordChange(userId: string, actorId: string): Promise<void>;
  sendResetLink(authHeader: string, email: string, redirectTo: string | undefined): Promise<string | null>;
  temporaryPassword(): string;
};

const ROLES = ["admin", "dept_head", "pm", "engineer"];
const MIN_SETUP_TOKEN = 16;
const res = (status: number, body: Record<string, unknown>): Result => ({ status, body });

/** Compares two strings without stopping at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function handleAuthAdmin(req: { method: string; authHeader: string | null; body: unknown }, deps: AuthAdminDeps): Promise<Result> {
  if (req.method !== "POST") return res(405, { message: "Use POST" });
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res(400, { message: "Invalid request" });
  const body = req.body as Record<string, unknown>;
  const setupEnabled = typeof deps.setupToken === "string" && deps.setupToken.length >= MIN_SETUP_TOKEN;

  if (body.action === "status") {
    // Used by /setup to decide whether to show the form. Unknown (query failed) is reported as "exists".
    try { return res(200, { admin_exists: (await deps.activeAdminCount()) > 0, setup_enabled: setupEnabled }); }
    catch { return res(200, { admin_exists: true, setup_enabled: false }); }
  }

  if (body.action === "setup") {
    if (!setupEnabled) return res(403, { message: "First-time setup is switched off." });
    if (typeof body.setup_token !== "string" || !safeEqual(body.setup_token, deps.setupToken!)) return res(403, { message: "The setup code is not correct." });
    let admins: number;
    try { admins = await deps.activeAdminCount(); }
    catch { return res(503, { message: "Setup is not available right now. Try again in a minute." }); }
    if (admins > 0) return res(403, { message: "Setup is already complete. Sign in instead." });
    const { email, password, full_name, login_name } = body as Record<string, string>;
    if (typeof email !== "string" || typeof password !== "string" || typeof full_name !== "string" || typeof login_name !== "string"
      || !email || password.length < 10 || password.length > 72 || !full_name || !login_name) return res(400, { message: "Fill in every field." });
    const created = await deps.createUser({
      email, password,
      app_metadata: { role: "admin", must_change_password: false },
      user_metadata: { full_name, login_name },
    });
    return created.error ? res(400, { message: "The admin account could not be created. Check the email address and try again." }) : res(200, { ok: true });
  }

  // Everything below needs a signed-in, active Admin.
  if (!req.authHeader) return res(401, { message: "Sign in first." });
  const callerId = await deps.callerId(req.authHeader).catch(() => null);
  if (!callerId) return res(401, { message: "Sign in first." });
  const caller = await deps.profile(callerId).catch(() => null);

  // Any signed-in, active person, for their own account only (also while "must change password" is set).
  if (body.action === "change_own_password") {
    if (!caller || caller.active !== true || !caller.email) return res(403, { message: "You don't have permission to do that." });
    const password = body.password;
    if (typeof password !== "string" || password.length < 10 || password.length > 72) return res(400, { message: "Use a password of 10 to 72 characters." });
    let same: boolean;
    try { same = await deps.passwordIsCurrent(caller.email, password); }
    catch { return res(503, { message: "Your password could not be changed right now. Nothing was changed; try again in a minute." }); }
    if (same) return res(400, { message: "Choose a password that is different from your current one." });
    const error = await deps.setPassword(callerId, password);
    if (error) return res(400, { message: "That password can't be used. Choose a different one." });
    const flagError = await deps.clearPasswordChange(callerId);
    if (flagError) return res(500, { message: "Your password was changed, but the change could not be recorded. Sign in with the new password; you may be asked to choose another." });
    return res(200, { ok: true });
  }

  if (caller?.role !== "admin" || caller.active !== true || caller.must_change_password === true) return res(403, { message: "You don't have permission to do that." });

  // Creates the Auth user; the on_auth_user_created trigger builds the profile from the metadata.
  // Password: the admin's choice, or a generated one (returned once) when none is given.
  if (body.action === "invite") {
    const { email, full_name, role, department_id, password } = body as Record<string, string | null>;
    const login_name = String(body.login_name ?? "").trim().toLowerCase();
    if (!email || !full_name || !login_name || !ROLES.includes(String(role))) return res(400, { message: "Fill in name, login name, email and role." });
    if (password != null && (typeof password !== "string" || password.length < 10 || password.length > 72)) return res(400, { message: "Use a password of 10 to 72 characters." });
    if (await deps.loginNameTaken(login_name)) return res(400, { message: "That login name is already taken." });
    const temporary_password = password ? null : deps.temporaryPassword();
    const created = await deps.createUser({
      email, password: password || temporary_password!,
      app_metadata: { role, department_id: department_id ?? null, must_change_password: body.must_change_password !== false },
      user_metadata: { full_name, login_name },
    });
    if (created.error || !created.id) return res(400, { message: created.error?.includes("already") ? "That email already has an account." : created.error ?? "The account could not be created." });
    const profile = await deps.profile(created.id).catch(() => null);
    return res(200, { ok: true, user_id: created.id, login_name: profile?.login_name ?? login_name, temporary_password });
  }

  if (body.action === "set_password") {
    const userId = String(body.user_id ?? "");
    const password = body.password;
    if (typeof password !== "string" || password.length < 10 || password.length > 72) return res(400, { message: "Use a password of 10 to 72 characters." });
    if (userId === callerId) return res(400, { message: "Change your own password in Settings." });
    const target = await deps.profile(userId).catch(() => null);
    if (!target) return res(404, { message: "That user doesn't exist." });
    const error = await deps.setPassword(userId, password);
    if (error) return res(400, { message: error });
    // the admin knows this password, so it is temporary (storing it cleared the flag; set it again)
    const flagError = await deps.requirePasswordChange(userId);
    await deps.logPasswordChange(userId, callerId);
    if (flagError) return res(500, { message: "The password was changed, but the account could not be marked for a password change. Tick \"must change password\" for this user." });
    return res(200, { ok: true });
  }

  if (body.action === "sync_access") {
    const userId = String(body.user_id ?? "");
    if (userId === callerId) return res(400, { message: "You can't change your own access." });
    const target = await deps.profile(userId).catch(() => null);
    if (!target) return res(404, { message: "That user doesn't exist." });
    const error = await deps.setBanned(userId, target.active !== true);
    return error ? res(502, { message: error }) : res(200, { ok: true, banned: target.active !== true });
  }

  if (body.action === "reset_link") {
    const target = await deps.profile(String(body.user_id)).catch(() => null);
    if (!target?.email) return res(400, { message: "That user has no email address." });
    const error = await deps.sendResetLink(req.authHeader, target.email, String(body.redirect_to ?? "") || undefined);
    return error ? res(400, { message: error }) : res(200, { ok: true });
  }

  return res(400, { message: "Unknown action" });
}
