import { describe, expect, it, vi } from "vitest";
import { handleAuthAdmin, safeEqual, type AuthAdminDeps } from "../../supabase/functions/auth-admin/handler";

const TOKEN = "setup-code-for-tests-0123456789";
const ADMIN = "11111111-0000-4000-8000-000000000001", ENGINEER = "11111111-0000-4000-8000-000000000012", OTHER = "11111111-0000-4000-8000-000000000015";

/** A system with one active admin and one engineer; every write is a spy. */
function deps(over: Partial<AuthAdminDeps> = {}): AuthAdminDeps {
  const people: Record<string, { role: string; active: boolean; email: string | null; login_name: string | null }> = {
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
  it("rejects other methods and malformed bodies", async () => {
    expect((await handleAuthAdmin({ method: "GET", authHeader: null, body: null }, deps())).status).toBe(405);
    expect((await handleAuthAdmin(post(null), deps())).status).toBe(400);
    expect((await handleAuthAdmin(post({ action: "promote" }, "Bearer admin"), deps())).status).toBe(400);
  });
});
