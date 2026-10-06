// FSMB · resolve-login: the request logic, free of Deno and Supabase imports so it runs under the unit tests
// (tests/unit/resolve-login.test.ts). index.ts supplies the real database lookup.
//
// The lookup answers only the app's own server: every request must carry the shared secret
// LOGIN_RESOLVER_SECRET in the x-login-resolver-secret header. Without the secret configured on the function,
// or with a wrong or missing header, nothing is looked up — so the function is not a public directory of
// login names or email addresses.

export type Result = { status: number; body: Record<string, unknown> };

export type ResolveLoginDeps = {
  /** function secret LOGIN_RESOLVER_SECRET; undefined or shorter than 16 characters = the function refuses everything */
  secret: string | undefined;
  /** email and status for a login name, or null; MUST throw when the query fails */
  lookup(loginName: string): Promise<{ email: string | null; active: boolean } | null>;
};

export const LOGIN_NAME = /^[a-z0-9._-]{1,60}$/;
const MIN_SECRET = 16;
const res = (status: number, body: Record<string, unknown>): Result => ({ status, body });

/** Compares two strings without stopping at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function handleResolveLogin(req: { method: string; secretHeader: string | null; body: unknown }, deps: ResolveLoginDeps): Promise<Result> {
  if (req.method !== "POST") return res(405, { message: "Use POST" });
  if (typeof deps.secret !== "string" || deps.secret.length < MIN_SECRET) return res(503, { message: "Login-name sign-in is not configured." });
  if (typeof req.secretHeader !== "string" || !safeEqual(req.secretHeader, deps.secret)) return res(401, { message: "Not allowed." });
  const login = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).login : null;
  const name = typeof login === "string" ? login.trim().toLowerCase() : "";
  if (!LOGIN_NAME.test(name)) return res(200, { email: null });
  let row: { email: string | null; active: boolean } | null;
  try { row = await deps.lookup(name); }
  catch { return res(503, { message: "The lookup is not available right now." }); }
  return res(200, { email: row?.active ? row.email : null });
}
