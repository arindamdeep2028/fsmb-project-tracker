# FSMB Edge Functions

| Function | Called by | Who may call | Purpose |
| --- | --- | --- | --- |
| `auth-admin` | Next.js Server Actions (`lib/edge.ts`) | `status`: anyone. `setup`: only with the `SETUP_TOKEN` secret, while no active admin exists. Everything else: an active Admin | First admin, create user, set password, reset link |
| `resolve-login` | Sign-in Server Action | Only the app server, with the `LOGIN_RESOLVER_SECRET` shared secret | Login name → email, for the password check on the server |
| `notify-email`, `red-mark-digest`, `storage-orphans` | pg_cron (migration 17) | Shared secret | Email queue (`public.pending_emails()`), digest, orphan cleanup — Phase 3, not yet written |

Each function keeps its rules in `handler.ts` (no Deno or Supabase imports, covered by `tests/unit/auth-admin.test.ts`
and `tests/unit/resolve-login.test.ts`); `index.ts` only wires in the database and Auth calls.

## Secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.
The service-role key is never placed in the Next.js environment. Two more secrets are optional; never commit their values.

| Secret | Set on | Unset means |
| --- | --- | --- |
| `SETUP_TOKEN` (16+ random characters) | `auth-admin` | First-time setup is switched off: `setup` is refused and `/setup` is a 404. Leave it unset on a system that already has an admin. |
| `LOGIN_RESOLVER_SECRET` (16+ random characters) | `resolve-login` **and** the Next.js server environment (Vercel, not `NEXT_PUBLIC_`) — the same value in both | `resolve-login` refuses every request and the sign-in page asks for an email address only. |

```bash
supabase secrets set LOGIN_RESOLVER_SECRET=<random value>     # then add the same value to the Vercel project and redeploy
supabase secrets set SETUP_TOKEN=<random value>               # only to create the first admin of an empty system
supabase secrets unset SETUP_TOKEN                            # afterwards
```

First admin of an empty system: set `SETUP_TOKEN`, open `/setup`, enter that value as the setup code, then unset it.
`setup` never treats a failed database check as "no admin yet": it answers 503 and creates nothing.

## Deploy

```bash
supabase functions deploy auth-admin --no-verify-jwt     # checks the caller itself
supabase functions deploy resolve-login --no-verify-jwt  # checks the shared secret itself
```
