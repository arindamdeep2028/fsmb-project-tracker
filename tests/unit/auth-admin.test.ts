import { describe, expect, it, vi } from "vitest";
import { handleAuthAdmin, safeEqual, type AuthAdminDeps } from "../../supabase/functions/auth-admin/handler";

const TOKEN = "setup-code-for-tests-0123456789";
const ADMIN = "11111111-0000-4000-8000-000000000001", ENGINEER = "11111111-0000-4000-8000-000000000012", OTHER = "11111111-0000-4000-8000-000000000015";

/** A system with one active admin and one engineer; every write is a spy. */
function deps(over: Partial<AuthAdminDeps> = {}): AuthAdminDeps {
  const people: Record<string, { role: string; active: boolean; email: string | null; login_name: string | null; must_change_password?: boolean }> = {
    [ADMIN]: { role: "admin", active: true, email: "admin@example.test", login_name: "admin" },
    [ENGINEER]: { role: "engineer", active: true, email: "eng@example.test", login_name: "eng" },
    [OTHER]: { role: "engineer", active: true, email: "other@example.test", login_name: "other" },
  };
  return {
    setupToken: undefined,
    activeAdminCount: vi.fn(async () => 1),
    createUser: vi.fn(async () => ({ id: "22222222-0000-4000-8000-000000000001", error: null })),
    callerId: vi.fn(async (h: string) => ({ "Bearer admin": ADMIN, "Bearer engineer": ENGINEER } as Record<string, string>)[h] ?? null),
    profile: vi.fn(async (id: string) => people[id] ?? null),
    loginNameTaken: vi.fn(async () => false),
    setPassword: vi.fn(async () => null),
    requirePasswordChange: vi.fn(async () => null),
    passwordIsCurrent: vi.fn(async (_email: string, password: string) => password === "the-current-password"),
    clearPasswordChange: vi.fn(async () => null),
    setBanned: vi.fn(async () => null),
    logPasswordChange: vi.fn(async () => {}),
    sendResetLink: vi.fn(async () => null),
    temporaryPassword: () => "Temp-Password-1234!7",
    ...over,
  };
}
const setup = (extra: Record<string, unknown> = {}) => ({ action: "setup", email: "first@example.test", password: "a-long-password", full_name: "First Admin", login_name: "first", ...extra });
const post = (body: unknown, authHeader: string | null = null) => ({ method: "POST", authHeader, body });

describe("auth-admin setup fails closed", () => {
  it("is switched off when no SETUP_TOKEN secret is configured, even with zero admins", async () => {
    const d = deps({ activeAdminCount: vi.fn(async () => 0) });
    const r = await handleAuthAdmin(post(setup({ setup_token: "anything" })), d);
    expect(r.status).toBe(403);
    expect(d.createUser).not.toHaveBeenCalled();
  });
  it("treats a too-short secret as switched off", async () => {
    const d = deps({ setupToken: "short", activeAdminCount: vi.fn(async () => 0) });
    expect((await handleAuthAdmin(post(setup({ setup_token: "short" })), d)).status).toBe(403);
    expect(d.createUser).not.toHaveBeenCalled();
  });
  it("refuses a caller without the setup code or with a wrong one (the public key alone is not enough)", async () => {
    const d = deps({ setupToken: TOKEN, activeAdminCount: vi.fn(async () => 0) });
    for (const body of [setup(), setup({ setup_token: "" }), setup({ setup_token: `${TOKEN}x` }), setup({ setup_token: 12345 })]) {
      expect((await handleAuthAdmin(post(body), d)).status).toBe(403);
    }
    expect(d.createUser).not.toHaveBeenCalled();
    expect(d.activeAdminCount).not.toHaveBeenCalled();
  });
  it("refuses a signed-in ordinary user, with or without the right code once an admin exists", async () => {
    const d = deps({ setupToken: TOKEN });
    expect((await handleAuthAdmin(post(setup(), "Bearer engineer"), d)).status).toBe(403);
    expect((await handleAuthAdmin(post(setup({ setup_token: TOKEN }), "Bearer engineer"), d)).status).toBe(403);
    expect(d.createUser).not.toHaveBeenCalled();
  });
  it("never reads a failed admin count as 'no admin exists'", async () => {
    const d = deps({ setupToken: TOKEN, activeAdminCount: vi.fn(async () => { throw new Error("database unavailable"); }) });
    const r = await handleAuthAdmin(post(setup({ setup_token: TOKEN })), d);
    expect(r.status).toBe(503);
    expect(d.createUser).not.toHaveBeenCalled();
    expect((await handleAuthAdmin(post({ action: "status" }), d)).body).toEqual({ admin_exists: true, setup_enabled: false });
  });
  it("refuses once an active admin exists", async () => {
    const d = deps({ setupToken: TOKEN });
    expect((await handleAuthAdmin(post(setup({ setup_token: TOKEN })), d)).status).toBe(403);
    expect(d.createUser).not.toHaveBeenCalled();
  });
  it("creates the first admin only with the code, zero admins and a complete form", async () => {
    const d = deps({ setupToken: TOKEN, activeAdminCount: vi.fn(async () => 0) });
    expect((await handleAuthAdmin(post(setup({ setup_token: TOKEN, password: "short" })), d)).status).toBe(400);
    expect(d.createUser).not.toHaveBeenCalled();
    const r = await handleAuthAdmin(post(setup({ setup_token: TOKEN })), d);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(d.createUser).toHaveBeenCalledTimes(1);
    expect(d.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "first@example.test", app_metadata: { role: "admin", must_change_password: false } }));
  });
  it("does not pass Auth error details to an anonymous caller", async () => {
    const d = deps({ setupToken: TOKEN, activeAdminCount: vi.fn(async () => 0), createUser: vi.fn(async () => ({ id: null, error: "duplicate key value violates unique constraint users_email_key" })) });
    const r = await handleAuthAdmin(post(setup({ setup_token: TOKEN })), d);
    expect(r.status).toBe(400);
    expect(String(r.body.message)).not.toMatch(/constraint|duplicate/);
  });
  it("status reports whether setup is possible", async () => {
    expect((await handleAuthAdmin(post({ action: "status" }), deps())).body).toEqual({ admin_exists: true, setup_enabled: false });
    expect((await handleAuthAdmin(post({ action: "status" }), deps({ setupToken: TOKEN, activeAdminCount: vi.fn(async () => 0) }))).body).toEqual({ admin_exists: false, setup_enabled: true });
  });
  it("compares the code in full", () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true);
    expect(safeEqual(TOKEN, TOKEN.slice(0, -1))).toBe(false);
    expect(safeEqual("", TOKEN)).toBe(false);
  });
});

describe("auth-admin user management stays Admin-only", () => {
  const invite = { action: "invite", email: "new@example.test", full_name: "New Person", login_name: "New.Person", role: "admin", department_id: null, password: "a-long-password" };
  it("refuses a signed-out caller, an unknown token and a non-admin for every admin action", async () => {
    for (const action of [invite, { action: "set_password", user_id: OTHER, password: "a-long-password" }, { action: "reset_link", user_id: OTHER }]) {
      const d = deps();
      expect((await handleAuthAdmin(post(action), d)).status).toBe(401);
      expect((await handleAuthAdmin(post(action, "Bearer nobody"), d)).status).toBe(401);
      expect((await handleAuthAdmin(post(action, "Bearer engineer"), d)).status).toBe(403);
      expect(d.createUser).not.toHaveBeenCalled();
      expect(d.setPassword).not.toHaveBeenCalled();
      expect(d.sendResetLink).not.toHaveBeenCalled();
    }
  });
  it("refuses when the caller's profile cannot be read, or the admin is inactive", async () => {
    const down = deps({ profile: vi.fn(async () => { throw new Error("database unavailable"); }) });
    expect((await handleAuthAdmin(post(invite, "Bearer admin"), down)).status).toBe(403);
    const inactive = deps({ profile: vi.fn(async () => ({ role: "admin", active: false, email: null, login_name: null })) });
    expect((await handleAuthAdmin(post(invite, "Bearer admin"), inactive)).status).toBe(403);
    expect(down.createUser).not.toHaveBeenCalled();
    expect(inactive.createUser).not.toHaveBeenCalled();
  });
  it("an Admin creates a user (including another admin) with the role in app metadata", async () => {
    const d = deps();
    const r = await handleAuthAdmin(post(invite, "Bearer admin"), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, temporary_password: null });
    expect(d.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@example.test", app_metadata: { role: "admin", department_id: null, must_change_password: true }, user_metadata: { full_name: "New Person", login_name: "new.person" },
    }));
  });
  it("an Admin sets another user's password, not their own, and the change is logged", async () => {
    const d = deps();
    expect((await handleAuthAdmin(post({ action: "set_password", user_id: OTHER, password: "a-long-password" }, "Bearer admin"), d)).status).toBe(200);
    expect(d.setPassword).toHaveBeenCalledWith(OTHER, "a-long-password");
    expect(d.logPasswordChange).toHaveBeenCalledWith(OTHER, ADMIN);
    expect((await handleAuthAdmin(post({ action: "set_password", user_id: ADMIN, password: "a-long-password" }, "Bearer admin"), d)).status).toBe(400);
    expect(d.setPassword).toHaveBeenCalledTimes(1);
  });
  it("SEC-5: a password set by an Admin is temporary — the account is marked 'must change password'", async () => {
    const d = deps();
    expect((await handleAuthAdmin(post({ action: "set_password", user_id: OTHER, password: "a-long-password" }, "Bearer admin"), d)).status).toBe(200);
    expect(d.requirePasswordChange).toHaveBeenCalledWith(OTHER);
    const failing = deps({ requirePasswordChange: vi.fn(async () => "update failed") });
    const r = await handleAuthAdmin(post({ action: "set_password", user_id: OTHER, password: "a-long-password" }, "Bearer admin"), failing);
    expect(r.status).toBe(500);                                   // never reported as a clean success
    expect(failing.logPasswordChange).toHaveBeenCalled();
  });
  it("SEC-5: an Admin who must change their own password first cannot use admin actions", async () => {
    const d = deps({ profile: vi.fn(async () => ({ role: "admin", active: true, email: null, login_name: null, must_change_password: true })) });
    expect((await handleAuthAdmin(post(invite, "Bearer admin"), d)).status).toBe(403);
    expect(d.createUser).not.toHaveBeenCalled();
  });
  it("SEC-6: sync_access bans the Auth account of a deactivated user and lifts the ban on reactivation", async () => {
    const inactive = deps();
    (inactive.profile as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => (id === ADMIN ? { role: "admin", active: true, email: null, login_name: null } : { role: "engineer", active: false, email: null, login_name: null }));
    expect(await handleAuthAdmin(post({ action: "sync_access", user_id: OTHER }, "Bearer admin"), inactive)).toEqual({ status: 200, body: { ok: true, banned: true } });
    expect(inactive.setBanned).toHaveBeenCalledWith(OTHER, true);
    const active = deps();
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: OTHER }, "Bearer admin"), active)).body).toEqual({ ok: true, banned: false });
    expect(active.setBanned).toHaveBeenCalledWith(OTHER, false);
  });
  it("SEC-6: sync_access is Admin-only, never on oneself, and reports a failure", async () => {
    const d = deps();
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: OTHER }), d)).status).toBe(401);
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: OTHER }, "Bearer engineer"), d)).status).toBe(403);
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: ADMIN }, "Bearer admin"), d)).status).toBe(400);
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: "22222222-0000-4000-8000-00000000dead" }, "Bearer admin"), d)).status).toBe(404);
    expect(d.setBanned).not.toHaveBeenCalled();
    const failing = deps({ setBanned: vi.fn(async () => "auth service unavailable") });
    expect((await handleAuthAdmin(post({ action: "sync_access", user_id: OTHER }, "Bearer admin"), failing)).status).toBe(502);
  });
  it("REGRESSION SEC-5: the flag is cleared only after a different password has really been stored", async () => {
    const d = deps();
    const r = await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer engineer"), d);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(d.passwordIsCurrent).toHaveBeenCalledWith("eng@example.test", "a-brand-new-password");
    expect(d.setPassword).toHaveBeenCalledWith(ENGINEER, "a-brand-new-password");
    expect(d.clearPasswordChange).toHaveBeenCalledWith(ENGINEER);
    // order: check → store → clear
    const order = [d.passwordIsCurrent, d.setPassword, d.clearPasswordChange].map((f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });
  it("REGRESSION SEC-5: submitting the current password changes nothing and does not clear the flag", async () => {
    const d = deps();
    const r = await handleAuthAdmin(post({ action: "change_own_password", password: "the-current-password" }, "Bearer engineer"), d);
    expect(r.status).toBe(400);
    expect(d.setPassword).not.toHaveBeenCalled();
    expect(d.clearPasswordChange).not.toHaveBeenCalled();
  });
  it("SEC-5: if the current password cannot be checked, nothing is changed and the flag stays", async () => {
    const d = deps({ passwordIsCurrent: vi.fn(async () => { throw new Error("auth unavailable"); }) });
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer engineer"), d)).status).toBe(503);
    expect(d.setPassword).not.toHaveBeenCalled();
    expect(d.clearPasswordChange).not.toHaveBeenCalled();
  });
  it("SEC-5: if the password cannot be stored, the flag stays", async () => {
    const d = deps({ setPassword: vi.fn(async () => "Password is too weak") });
    const r = await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer engineer"), d);
    expect(r.status).toBe(400);
    expect(String(r.body.message)).not.toMatch(/weak/i);            // no service detail
    expect(d.clearPasswordChange).not.toHaveBeenCalled();
  });
  it("SEC-5: a change that could not be recorded is not reported as success", async () => {
    const d = deps({ clearPasswordChange: vi.fn(async () => "update failed") });
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer engineer"), d)).status).toBe(500);
  });
  it("SEC-5: change_own_password is for the signed-in caller only: no target id, not signed out, not inactive", async () => {
    const d = deps();
    // a user id in the body is ignored: the caller's own account is changed
    await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password", user_id: OTHER }, "Bearer engineer"), d);
    expect(d.setPassword).toHaveBeenCalledWith(ENGINEER, "a-brand-new-password");
    expect(d.clearPasswordChange).toHaveBeenCalledWith(ENGINEER);
    const out = deps();
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }), out)).status).toBe(401);
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer nobody"), out)).status).toBe(401);
    const inactive = deps({ profile: vi.fn(async () => ({ role: "engineer", active: false, email: "eng@example.test", login_name: "eng" })) });
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer engineer"), inactive)).status).toBe(403);
    for (const x of [out, inactive]) { expect(x.setPassword).not.toHaveBeenCalled(); expect(x.clearPasswordChange).not.toHaveBeenCalled(); }
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "short" }, "Bearer engineer"), deps())).status).toBe(400);
  });
  it("SEC-5: it works for a person whose flag is set, and nothing else does for them", async () => {
    const flagged = () => deps({ profile: vi.fn(async (id: string) => ({ role: id === ADMIN ? "admin" : "engineer", active: true, email: "x@example.test", login_name: "x", must_change_password: true })) });
    const d = flagged();
    expect((await handleAuthAdmin(post({ action: "change_own_password", password: "a-brand-new-password" }, "Bearer admin"), d)).status).toBe(200);
    expect((await handleAuthAdmin(post(invite, "Bearer admin"), flagged())).status).toBe(403);
  });
  it("rejects other methods and malformed bodies", async () => {
    expect((await handleAuthAdmin({ method: "GET", authHeader: null, body: null }, deps())).status).toBe(405);
    expect((await handleAuthAdmin(post(null), deps())).status).toBe(400);
    expect((await handleAuthAdmin(post({ action: "promote" }, "Bearer admin"), deps())).status).toBe(400);
  });
});
