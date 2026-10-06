/**
 * Sign-in identifiers. Everyone can sign in with their email address. Sign-in by login name works only when the
 * server holds LOGIN_RESOLVER_SECRET (the secret it shares with the resolve-login Edge Function); without it the
 * sign-in page asks for an email address and a login name is turned away with a clear message, not a silent failure.
 * Pure functions, shared by the sign-in action, the sign-in page and their tests.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_NAME = /^[a-z0-9._-]{1,60}$/;

export type Identifier = { kind: "email"; email: string } | { kind: "login"; login: string } | { kind: "invalid" };

export function classifyIdentifier(raw: string): Identifier {
  const v = raw.trim();
  if (v.includes("@")) return v.length <= 254 && EMAIL.test(v) ? { kind: "email", email: v } : { kind: "invalid" };
  const login = v.toLowerCase();
  return LOGIN_NAME.test(login) ? { kind: "login", login } : { kind: "invalid" };
}

/** True when the server is configured for sign-in by login name. */
export function loginNamesEnabled(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 16;
}

export const signInCopy = (loginNames: boolean) => ({
  label: loginNames ? "Email or login name" : "Email",
  /** one answer for a wrong password, an unknown email and an unknown login name */
  generic: loginNames ? "Email, login name or password is incorrect." : "Email or password is incorrect.",
  emailOnly: "Sign in with the email address on your account.",
  resolverDown: "Sign-in by login name isn't available right now. Use your email address instead.",
});

export type ResolveResult = { ok: true; email: string | null } | { ok: false };

/**
 * The email to check the password against.
 *   { email }            go on to the password check
 *   { unknown: true }    a well-formed login name nobody has: the caller still runs a password check, so the
 *                        answer and its timing match a wrong password, then shows the generic message
 *   { message }          stop with this message (it never depends on whether an account exists)
 */
export async function emailForSignIn(identifier: string, opts: { loginNames: boolean; resolve: (login: string) => Promise<ResolveResult> }):
  Promise<{ email: string } | { unknown: true } | { message: string }> {
  const copy = signInCopy(opts.loginNames);
  const id = classifyIdentifier(identifier);
  if (id.kind === "email") return { email: id.email };
  if (!opts.loginNames) return { message: copy.emailOnly };
  if (id.kind === "invalid") return { message: copy.generic };
  const r = await opts.resolve(id.login).catch((): ResolveResult => ({ ok: false }));
  if (!r.ok) return { message: copy.resolverDown };
  return r.email && classifyIdentifier(r.email).kind === "email" ? { email: r.email } : { unknown: true };
}
