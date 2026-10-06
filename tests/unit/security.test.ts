import { describe, expect, it } from "vitest";
import { safeNext, sameOrigin } from "@/lib/auth/redirects";
import { routeFor } from "@/lib/auth/routing";
import { buildCsp, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("SEC-9: where sign-in and email links may send the browser", () => {
  it("keeps a path inside the app, with its query and hash", () => {
    expect(safeNext("/projects/abc/tasks?filter=red#t1", "/dashboard")).toBe("/projects/abc/tasks?filter=red#t1");
    expect(safeNext("/reset-password", "/")).toBe("/reset-password");
    expect(safeNext("/", "/dashboard")).toBe("/");
  });
  it("REGRESSION: refuses every way of pointing at another site", () => {
    for (const bad of [
      "//evil.example", "//evil.example/path", "/\\evil.example", "\\/evil.example", "\\\\evil.example", "/\\/evil.example",
      "https://evil.example", "http://evil.example/login", "javascript:alert(1)", "data:text/html,x", "evil.example", "@evil.example",
      "/\tevil", "/\n/evil.example", "/ /evil.example", " //evil.example", "/%0a", "", "/".repeat(2001),
    ]) {
      const out = safeNext(bad, "/dashboard");
      // either the fallback, or (for "/%0a") a harmless same-origin path — never another origin
      expect(new URL(out, "https://app.test").origin, JSON.stringify(bad)).toBe("https://app.test");
      if (bad !== "/%0a") expect(out, JSON.stringify(bad)).toBe("/dashboard");
    }
    expect(safeNext(null, "/dashboard")).toBe("/dashboard");
    expect(safeNext(undefined, "/dashboard")).toBe("/dashboard");
  });
  it("does not bounce through the auth endpoints", () => {
    expect(safeNext("/auth/signout", "/dashboard")).toBe("/dashboard");
    expect(safeNext("/auth/callback?next=//evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNext("/auth", "/dashboard")).toBe("/dashboard");
    expect(safeNext("/authors", "/dashboard")).toBe("/authors");
  });
  it("sign-out is accepted only from this site", () => {
    expect(sameOrigin("https://fsmb.example", "fsmb.example")).toBe(true);
    expect(sameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(sameOrigin("https://evil.example", "fsmb.example")).toBe(false);
    expect(sameOrigin("https://fsmb.example.evil.example", "fsmb.example")).toBe(false);
    expect(sameOrigin(null, "fsmb.example")).toBe(false);          // no Origin header: refused
    expect(sameOrigin("null", "fsmb.example")).toBe(false);        // sandboxed frame
    expect(sameOrigin("not a url", "fsmb.example")).toBe(false);
  });
});

describe("SEC-5 / SEC-6: the middleware's routing decision", () => {
  const user = { signedIn: true, role: "engineer", active: true, mustChangePassword: false };
  it("signed out: public pages pass, everything else goes to sign-in", () => {
    const out = { signedIn: false, active: true, mustChangePassword: false };
    expect(routeFor({ ...out, path: "/login" })).toEqual({ do: "pass" });
    expect(routeFor({ ...out, path: "/reset-password" })).toEqual({ do: "pass" });
    expect(routeFor({ ...out, path: "/auth/callback" })).toEqual({ do: "pass" });
    expect(routeFor({ ...out, path: "/dashboard" })).toEqual({ do: "redirect", to: "/login" });
    expect(routeFor({ ...out, path: "/loginx" })).toEqual({ do: "redirect", to: "/login" });
  });
  it("REGRESSION SEC-6: a deactivated session is signed out and shown sign-in — no /login ↔ dashboard loop", () => {
    const off = { ...user, active: false };
    for (const path of ["/login", "/dashboard", "/projects/p1/tasks", "/admin/users", "/change-password", "/", "/reset-password"]) {
      expect(routeFor({ ...off, path }), path).toEqual({ do: "signOutAndShowLogin" });
    }
    expect(routeFor({ ...off, path: "/auth/signout" })).toEqual({ do: "pass" });
    // the old behaviour sent /login to the landing page for any signed-in session, which looped for an inactive one
    expect(routeFor({ ...off, path: "/login" }).do).not.toBe("landing");
  });
  it("REGRESSION SEC-5: a must-change session reaches only /change-password and /auth/*", () => {
    const must = { ...user, mustChangePassword: true };
    for (const path of ["/dashboard", "/projects", "/projects/p1/daily-reports", "/daily-reports/new", "/settings", "/admin/users", "/login", "/", "/change-passwordx"]) {
      expect(routeFor({ ...must, path }), path).toEqual({ do: "redirect", to: "/change-password" });
    }
    expect(routeFor({ ...must, path: "/change-password" })).toEqual({ do: "pass" });
    expect(routeFor({ ...must, path: "/auth/signout" })).toEqual({ do: "pass" });
    expect(routeFor({ ...must, role: "admin", path: "/admin/users" })).toEqual({ do: "redirect", to: "/change-password" });
  });
  it("deactivated wins over must-change", () => {
    expect(routeFor({ ...user, active: false, mustChangePassword: true, path: "/change-password" })).toEqual({ do: "signOutAndShowLogin" });
  });
  it("an ordinary session is routed as before", () => {
    expect(routeFor({ ...user, path: "/login" })).toEqual({ do: "landing" });
    expect(routeFor({ ...user, path: "/dashboard" })).toEqual({ do: "pass" });
    expect(routeFor({ ...user, path: "/admin/users" })).toEqual({ do: "landing" });
    expect(routeFor({ ...user, path: "/dashboard/admin" })).toEqual({ do: "landing" });
    expect(routeFor({ ...user, path: "/performance" })).toEqual({ do: "landing" });
    expect(routeFor({ ...user, path: "/dashboard/projects" })).toEqual({ do: "redirect", to: "/dashboard" });
    expect(routeFor({ ...user, role: "pm", path: "/dashboard/projects" })).toEqual({ do: "pass" });
    expect(routeFor({ ...user, role: "dept_head", path: "/performance" })).toEqual({ do: "pass" });
    expect(routeFor({ ...user, role: "dept_head", path: "/admin/users" })).toEqual({ do: "landing" });
    expect(routeFor({ ...user, role: "admin", path: "/admin/users" })).toEqual({ do: "pass" });
    expect(routeFor({ ...user, path: "/change-password" })).toEqual({ do: "pass" });
  });
});

describe("SEC-17: browser security headers", () => {
  const header = (k: string) => STATIC_SECURITY_HEADERS.find((h) => h.key.toLowerCase() === k)?.value;
  it("sends nosniff, a referrer policy, clickjacking protection and a permissions policy on every path", () => {
    expect(header("x-content-type-options")).toBe("nosniff");
    expect(header("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(header("x-frame-options")).toBe("DENY");
    expect(header("permissions-policy")).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });
  const csp = buildCsp({ nonce: "Tm9uY2U=", supabaseUrl: "https://abcdefgh.supabase.co" });
  const directive = (name: string, policy = csp) => policy.split("; ").find((d) => d.startsWith(name + " ")) ?? "";
  it("scripts run only with the request's nonce: no inline script, no eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-Tm9uY2U=' 'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("default-src")).toBe("default-src 'self'");
  });
  it("nothing may frame the app, forms post only to it, no plugins, no <base> hijack", () => {
    for (const d of ["frame-ancestors 'none'", "form-action 'self'", "object-src 'none'", "base-uri 'self'"]) expect(csp.split("; ")).toContain(d);
  });
  it("keeps what the app needs: the Supabase project (REST, Auth, Storage, Realtime) and Google Fonts", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co");
    expect(directive("img-src")).toBe("img-src 'self' data: blob: https://abcdefgh.supabase.co");
    expect(directive("style-src")).toContain("https://fonts.googleapis.com");
    expect(directive("font-src")).toBe("font-src 'self' https://fonts.gstatic.com");
  });
  it("names no wildcard and no other host", () => {
    expect(csp).not.toMatch(/\*|https?:\/\/(?!abcdefgh\.supabase\.co|fonts\.g)/);
  });
  it("a local stack gets ws://, development gets eval for hot reload, a missing URL breaks nothing", () => {
    expect(directive("connect-src", buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321" }))).toBe("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(buildCsp({ nonce: "n", supabaseUrl: "https://x.supabase.co", dev: true })).toContain("'unsafe-eval'");
    expect(directive("connect-src", buildCsp({ nonce: "n", supabaseUrl: undefined }))).toBe("connect-src 'self'");
  });
});
