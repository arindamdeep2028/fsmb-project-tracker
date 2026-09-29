# FSMB Edge Functions

| Function | Called by | Sign-in | Purpose |
| --- | --- | --- | --- |
| `auth-admin` | Next.js Server Actions (`lib/edge.ts`) | `status`/`setup` no; others Admin | First admin, invite user, reset link |
| `resolve-login` | Sign-in Server Action | No | Login name → email |
| `notify-email`, `red-mark-digest`, `storage-orphans` | pg_cron (migration 17) | Shared secret | Email queue (`public.pending_emails()`), digest, orphan cleanup — Phase 3, not yet written |

Deploy:

```bash
supabase functions deploy auth-admin --no-verify-jwt     # checks the caller itself; setup must work signed out
supabase functions deploy resolve-login --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.
The service-role key is never placed in the Next.js environment.
