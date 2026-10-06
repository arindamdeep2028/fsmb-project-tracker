/**
 * Browser security headers. The fixed ones are sent for every path by next.config.ts; the Content-Security-Policy
 * is built per request in middleware.ts because it carries a nonce. No imports: used by both. Tests:
 * tests/unit/security.test.ts.
 */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },                       // clickjacking, for browsers without frame-ancestors
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * What the app loads, and from where:
 *   scripts   its own bundles, started by Next's inline bootstrap (nonce + strict-dynamic); no eval in production
 *   styles    its stylesheet, Google Fonts' stylesheet, and inline style attributes (charts, progress bars)
 *   fonts     Google Fonts
 *   images    its own, data:/blob: previews, and signed Storage URLs on the Supabase project
 *   connect   itself and the Supabase project (REST, Auth, Storage uploads, Realtime over wss)
 * Nothing may frame the app; forms post only to the app; no plugins; <base> cannot be redirected.
 */
export function buildCsp(o: { nonce: string; supabaseUrl: string | undefined; dev?: boolean }): string {
  let supabase = "", realtime = "";
  try {
    const u = new URL(o.supabaseUrl ?? "");
    supabase = u.origin;
    realtime = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
  } catch { /* not configured: the policy simply names no Supabase origin */ }
  const list = (...parts: string[]) => parts.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    list("script-src", "'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", o.dev ? "'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    list("img-src", "'self'", "data:", "blob:", supabase),
    list("connect-src", "'self'", supabase, realtime),
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
