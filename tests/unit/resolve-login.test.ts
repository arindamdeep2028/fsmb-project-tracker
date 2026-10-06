import { describe, expect, it, vi } from "vitest";
import { handleResolveLogin, type ResolveLoginDeps } from "../../supabase/functions/resolve-login/handler";
import { classifyIdentifier, emailForSignIn, loginNamesEnabled, signInCopy, type ResolveResult } from "@/lib/auth/sign-in";

const SECRET = "resolver-secret-for-tests-0123456789";
const deps = (over: Partial<ResolveLoginDeps> = {}): ResolveLoginDeps => ({
  secret: SECRET,
  lookup: vi.fn(async (name: string) => (name === "rahim" ? { email: "rahim@example.test", active: true } : name === "gone" ? { email: "gone@example.test", active: false } : null)),
  ...over,
});
const post = (login: unknown, secretHeader: string | null = SECRET) => ({ method: "POST", secretHeader, body: { login } });

describe("resolve-login Edge Function: no public directory", () => {
  it("refuses a caller without the shared secret, or with a wrong one, and looks nothing up", async () => {
    const d = deps();
    for (const header of [null, "", "wrong", `${SECRET}x`, SECRET.slice(0, -1)]) {
      const r = await handleResolveLogin(post("rahim", header), d);
      expect(r.status).toBe(401);
      expect(r.body).not.toHaveProperty("email");
    }
    expect(d.lookup).not.toHaveBeenCalled();
  });
  it("refuses everything when the function has no secret configured (or a too-short one)", async () => {
    for (const secret of [undefined, "", "short"]) {
      const d = deps({ secret });
      const r = await handleResolveLogin(post("rahim", secret ?? ""), d);
      expect(r.status).toBe(503);
      expect(d.lookup).not.toHaveBeenCalled();
    }
  });
  it("returns the email of an active login name to the app server; null for unknown or inactive", async () => {
    expect(await handleResolveLogin(post("rahim"), deps())).toEqual({ status: 200, body: { email: "rahim@example.test" } });
    expect(await handleResolveLogin(post("  Rahim "), deps())).toEqual({ status: 200, body: { email: "rahim@example.test" } });
    expect(await handleResolveLogin(post("nobody"), deps())).toEqual({ status: 200, body: { email: null } });
    expect(await handleResolveLogin(post("gone"), deps())).toEqual({ status: 200, body: { email: null } });
  });
  it("answers null without a lookup for anything that is not a login name", async () => {
    const d = deps();
    for (const bad of ["", "a b", "x".repeat(61), "rahim';--", "ra*", "%", 42, null, { $ne: "" }]) {
      expect(await handleResolveLogin(post(bad), d)).toEqual({ status: 200, body: { email: null } });
    }
    expect(d.lookup).not.toHaveBeenCalled();
  });
  it("reports a failed lookup as unavailable, not as 'unknown name'", async () => {
    const r = await handleResolveLogin(post("rahim"), deps({ lookup: vi.fn(async () => { throw new Error("database unavailable"); }) }));
    expect(r.status).toBe(503);
    expect(r.body).not.toHaveProperty("email");
  });
  it("accepts POST only", async () => {
    expect((await handleResolveLogin({ method: "GET", secretHeader: SECRET, body: null }, deps())).status).toBe(405);
  });
});

describe("sign-in identifiers", () => {
  it("recognises email addresses, login names and junk", () => {
    expect(classifyIdentifier(" rahim@fsmb.example ")).toEqual({ kind: "email", email: "rahim@fsmb.example" });
    expect(classifyIdentifier("Rahim.Uddin")).toEqual({ kind: "login", login: "rahim.uddin" });
    for (const bad of ["", "   ", "a b", "rahim@", "@fsmb.example", "a@b", "two@@fsmb.example", "x".repeat(61), "né", `${"a".repeat(250)}@b.co`]) {
      expect(classifyIdentifier(bad).kind).toBe("invalid");
    }
  });
  it("login names are on only with a real secret on the server", () => {
    expect(loginNamesEnabled(undefined)).toBe(false);
    expect(loginNamesEnabled("")).toBe(false);
    expect(loginNamesEnabled("short")).toBe(false);
    expect(loginNamesEnabled(SECRET)).toBe(true);
    expect(signInCopy(false).label).toBe("Email");
    expect(signInCopy(true).label).toBe("Email or login name");
  });
});

describe("which email the password is checked against", () => {
  const resolver = (r: ResolveResult | Error) => vi.fn(async (_login: string): Promise<ResolveResult> => { if (r instanceof Error) throw r; return r; });

  it("an email address goes straight to the password check, resolver or not", async () => {
    const resolve = resolver({ ok: true, email: "someone@else.test" });
    expect(await emailForSignIn("rahim@fsmb.example", { loginNames: true, resolve })).toEqual({ email: "rahim@fsmb.example" });
    expect(await emailForSignIn("rahim@fsmb.example", { loginNames: false, resolve })).toEqual({ email: "rahim@fsmb.example" });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("without the resolver configured, a login name is turned away clearly and never looked up", async () => {
    const resolve = resolver({ ok: true, email: "rahim@fsmb.example" });
    expect(await emailForSignIn("rahim", { loginNames: false, resolve })).toEqual({ message: signInCopy(false).emailOnly });
    expect(await emailForSignIn("not an email", { loginNames: false, resolve })).toEqual({ message: signInCopy(false).emailOnly });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("with the resolver, a known login name resolves to its email", async () => {
    const resolve = resolver({ ok: true, email: "rahim@fsmb.example" });
    expect(await emailForSignIn("  Rahim ", { loginNames: true, resolve })).toEqual({ email: "rahim@fsmb.example" });
    expect(resolve).toHaveBeenCalledWith("rahim");
  });
  it("an unknown login name is 'unknown' (the action then answers like a wrong password)", async () => {
    expect(await emailForSignIn("nobody", { loginNames: true, resolve: resolver({ ok: true, email: null }) })).toEqual({ unknown: true });
    expect(await emailForSignIn("nobody", { loginNames: true, resolve: resolver({ ok: true, email: "not-an-email" }) })).toEqual({ unknown: true });
  });
  it("an invalid identifier gets the generic answer without a lookup", async () => {
    const resolve = resolver({ ok: true, email: "rahim@fsmb.example" });
    for (const bad of ["a b", "rahim@", "x".repeat(61), "ra*him"]) {
      expect(await emailForSignIn(bad, { loginNames: true, resolve })).toEqual({ message: signInCopy(true).generic });
    }
    expect(resolve).not.toHaveBeenCalled();
  });
  it("a resolver failure or refusal says login names are unavailable, whatever the name", async () => {
    const down = { message: signInCopy(true).resolverDown };
    expect(await emailForSignIn("rahim", { loginNames: true, resolve: resolver({ ok: false }) })).toEqual(down);
    expect(await emailForSignIn("nobody", { loginNames: true, resolve: resolver(new Error("network")) })).toEqual(down);
  });
});
