/**
 * Where a sign-in or an email link may send the browser afterwards: only a path inside this app.
 * Safe for middleware (no server-only imports). Pure; tests in tests/unit/security.test.ts.
 *
 * Refused: anything that is not a single-slash path — absolute URLs, scheme-relative "//host", the
 * backslash forms browsers treat like "//" ("/\host", "\/host"), control characters and whitespace
 * (tab/newline tricks), and the auth endpoints themselves (no bouncing through sign-out).
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  if (next[0] !== "/" || next[1] === "/" || next.includes("\\")) return fallback;
  for (let i = 0; i < next.length; i++) { const c = next.charCodeAt(i); if (c <= 0x20 || c === 0x7f) return fallback; }
  let url: URL;
  try { url = new URL(next, "http://app.invalid"); } catch { return fallback; }
  if (url.origin !== "http://app.invalid") return fallback;
  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A state-changing request must come from this site: the Origin header, when present, names this host. */
export function sameOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader || !hostHeader) return false;
  try { return new URL(originHeader).host === hostHeader; } catch { return false; }
}
