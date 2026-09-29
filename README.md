# FSMB Project Tracker — web app

Next.js front end for the FSMB Project Tracker (Frontier Semiconductor Bangladesh). It implements the
**Frontend Development Blueprint** on top of the validated Supabase package in `supabase/`
(migrations 01–19), following **Permission & Workflow Blueprint v2** with its §14 amendments.

## Stack

| Part | Version | Note |
| --- | --- | --- |
| Next.js (App Router) | 15.5 | Server Components, Server Actions, `middleware.ts` |
| React | 19 | |
| Supabase | `@supabase/ssr` 0.12, `supabase-js` 2.117 | anon key + user session only |
| TypeScript | 5.9 | pinned: TypeScript 7 lacks the compiler API Next 15 uses |
| Tailwind CSS | 4 | tokens in `app/globals.css` |
| Forms | React Hook Form + Zod 4 | same schemas client and server |
| Tables / charts | TanStack Table 8 (pinned), Recharts 3 | |
| Dialogs / menus | Radix | |

## How the app is built

- **The database decides.** Every rule (who may see or change what, deadlines, red marks, progress,
  scores) is enforced by RLS, triggers and RPCs. The UI mirrors the rules only to decide which controls to
  show (`lib/auth/capabilities.ts`).
- **Every call runs as the signed-in user.** The Next.js app never holds the service-role key. Setup,
  invites, reset links and login-name lookup run in the Edge Functions `auth-admin` and `resolve-login`.
- **Three routing layers.** `middleware.ts` (session, role prefix), server layouts (`requireSession`,
  `requireAdmin`, … re-read the live profile), and RLS.
- **Working week Monday–Friday.** The app never counts working days itself; it shows the database's
  deadlines and statuses.
- **Admin has complete access.** Only security protections (audit trail, last admin, Auth-only accounts,
  calculated columns) and three integrity rules refuse an Admin; the UI explains each refusal.
- **Errors.** A refused write shows one generic message; a broken rule shows the rule's sentence
  (`lib/errors.ts`).

```
app/(public)/        login, reset-password, setup          no shell
app/(app)/           signed-in shell + 31 pages             dashboards, tasks, reports, projects, admin
app/auth/            callback, signout                      route handlers
components/          ui primitives, tasks, reports, admin, dashboards, data tables, charts
lib/supabase/        server, browser and middleware clients
lib/auth/            session, capabilities, navigation, guards
lib/data/            reads (Server Components)
lib/actions/         every write (Server Actions)
lib/validation/      Zod schemas
types/database.ts    generated from the schema
supabase/            migrations, seed, pgTAP tests, rollback, Edge Functions
tests/unit/          Vitest
```

## Run it locally

Requires Node 20+, Docker and the Supabase CLI.

```bash
npm install
supabase init                  # once, if there is no supabase/config.toml yet
```

Add to `supabase/config.toml` (see `supabase/README.md` for why):

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"

[functions.auth-admin]
verify_jwt = false

[functions.resolve-login]
verify_jwt = false
```

Then:

```bash
supabase start                 # prints the API URL and anon key
supabase db reset              # applies migrations 01–19 and seed.sql
supabase test db               # 78 pgTAP tests
supabase functions serve       # auth-admin and resolve-login, in a second terminal
cp .env.example .env.local     # paste the API URL and anon key
npm run dev                    # http://localhost:3000
```

Seed users sign in with a login name (for example `rashidul` Admin, `morsalin` Department Head,
`abrar` PM, `imam` engineer) and the password `Fsmb@12345`. These are local test accounts only.

On an empty database with no admin, open `/setup` to create the first Admin; after that the page is a 404.

## Checks

```bash
npm run typecheck              # tsc against the generated database types
npm test                       # Vitest: capabilities, error mapping, Dhaka time, storage paths
npm run build
npm run db:types               # regenerate types/database.ts after any migration
```

`scripts/gen-types-from-pg.py` produces the same types from a plain Postgres when the Supabase CLI isn't
available.

## Deploy

1. Supabase project: `supabase link`, `supabase db push`, enable the Customize Access Token hook in the
   dashboard, then deploy both functions with `--no-verify-jwt` (`supabase/functions/README.md`).
2. Vercel (or any Node host): set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `NEXT_PUBLIC_SITE_URL`. Add `${SITE_URL}/auth/callback` to Supabase Auth redirect URLs.
3. Sign in as Admin, check Rules and settings (Monday–Friday is preset), add departments and users.

## Not included yet

- Edge Functions `notify-email`, `red-mark-digest`, `storage-orphans`: the database already queues emails
  (`public.pending_emails()`) and pg_cron calls them (migration 17).
- `scripts/import-excel`: one-off operator import of the current workbook.
- Playwright end-to-end tests.
