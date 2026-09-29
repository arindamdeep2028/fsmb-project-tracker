# FSMB Project Tracker — Supabase migration package

SQL only (no Next.js code). Built from the FSMB Conversion Blueprint, Final Permission & Workflow
Blueprint v2, Development Blueprint, Supabase Database Implementation Blueprint and the approved
decisions: **PM / Department Head / Admin set task deadlines manually** (`tasks.planned_due_at`) and
**Admin has full system control**.

## 1. Folder structure

```
supabase/
├── migrations/
│   ├── 20261001000001_extensions.sql       pgcrypto, citext, pg_cron, pg_net, private schema `app`
│   ├── 20261001000002_enums.sql            10 enums
│   ├── 20261001000003_organisation.sql     departments, profiles, department_heads, workspace_settings
│   ├── 20261001000004_projects.sql         projects, project_members
│   ├── 20261001000005_tasks.sql            tasks (+ subtasks, planned_due_at), task_extensions,
│   │                                       task_contributions, task_comments
│   ├── 20261001000006_daily_reports.sql    daily_reports, daily_report_items, daily_report_attachments
│   ├── 20261001000007_notifications.sql    notifications, notification_preferences
│   ├── 20261001000008_audit.sql            activity_log, scan_runs
│   ├── 20261001000009_indexes.sql          unique + lookup indexes
│   ├── 20261001000010_access_helpers.sql   role/scope helpers used by RLS
│   ├── 20261001000011_rules_progress.sql   deadlines, breaches, deadline status, weights,
│   │                                       completion, contribution, audit + notification helpers
│   ├── 20261001000012_triggers.sql         20 trigger functions, 24 triggers
│   ├── 20261001000013_views.sql            task_flags, task_rollup, engineer / PM / department / admin views
│   ├── 20261001000014_rpc_jobs.sql         RPCs (daily report, complete, extension, deadline,
│   │                                       dashboards, performance) + job functions
│   ├── 20261001000015_rls_policies.sql     RLS per role and command
│   ├── 20261001000016_grants_auth.sql      grants/revokes + Custom Access Token Hook
│   ├── 20261001000017_schedules.sql        pg_cron jobs
│   ├── 20261001000018_storage.sql          bucket daily-report-files + storage policies
│   └── 20261001000019_final_decisions.sql  Mon–Fri week, Admin complete access, v2 alignment
├── seed.sql                                local/staging test data
├── rollback.sql                            full teardown for local/staging
├── tests/
│   └── database/
│       ├── 001_rls.test.sql                48 pgTAP tests (roles, isolation, field guard, storage)
│       └── 002_final_decisions.test.sql    30 pgTAP tests (working week, Admin access, v2 alignment)
└── README.md
```

Supabase CLI names migrations `<version>_<name>.sql` and applies them in version order, so the
timestamp prefixes fix the order. How they map to the example layout: profiles and departments are
in 03, projects and members in 04, tasks, contributions and comments in 05, reports and attachments
in 06, functions in 10, 11 and 14, triggers in 12, views in 13, RLS in 15, schedules in 17, and storage in 18.

Relationship chain: `auth.users → profiles → departments → projects → project_members → tasks →
subtasks (tasks.parent_id) → daily_report_items → daily_reports → daily_report_attachments`.

## 2. Order of execution

Run 01 → 19 in order; every file depends only on earlier files. 01 creates the `app` schema,
02 the types used by 03–08, 10–11 the functions used by 12–15, 13 the views read by 14, and
16 revokes Supabase's broad default grants after everything exists. `seed.sql` runs last and only
outside production.

## 3. Run locally

Requirements: Supabase CLI ≥ 1.200, Docker.

```bash
supabase init                       # once, if the repo has no supabase/ folder yet
# copy this package into ./supabase
supabase start
supabase db reset                   # drops the local DB, applies 01–19, runs seed.sql
supabase test db                    # runs tests/database/*.sql (pgTAP)
```

Add to `supabase/config.toml`:

```toml
[auth]
enable_signup = false               # accounts are created by an admin only

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

Seeded users sign in with `<login>@fsmb.local` / `Fsmb@12345`: rashidul (admin), morsalin (dept head
R&D + PM P01), abrar (PM P02), peash (PM P03), shorif, imam, masrur, deep, araf, arif, rafi
(engineers) and anik (inactive).

## 4. Deploy to staging and production

```bash
supabase link --project-ref <staging-ref>
supabase db push                    # applies migrations not yet recorded; never runs seed.sql
# after staging is verified:
supabase link --project-ref <production-ref>
supabase db push
```

Once per hosted project, after the first push:

1. **Authentication → Hooks → Customize Access Token**: select `public.custom_access_token_hook`.
2. **Authentication → Providers → Email**: turn off "Allow new users to sign up".
3. **Database → Extensions**: confirm `pg_cron` and `pg_net` are enabled. Migration 01 enables them,
   but some projects require enabling them in the dashboard first.
4. **Vault secrets** used by the cron jobs that call Edge Functions (SQL editor):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<long random string>', 'cron_secret');
   ```
5. Deploy the Edge Functions `red-mark-digest`, `notify-email` and `storage-orphans`. They are
   application code and are not part of this SQL package. Until they exist, the three HTTP cron jobs
   log a warning and do nothing. The SQL jobs (red-mark scan, deadline scan, lock and purge) work
   without them.
6. Create the first admin with the service role, passing role and department in **app_metadata**
   (users cannot edit app_metadata):
   `auth.admin.createUser({ email, password, app_metadata: { role: 'admin' }, user_metadata: { full_name, login_name } })`.

Jobs run in UTC (Dhaka = UTC+6):

| Job | UTC | Dhaka |
|---|---|---|
| fsmb-red-mark-scan | 03:05 daily | 09:05 |
| fsmb-red-mark-digest | 03:07 daily | 09:07 |
| fsmb-deadline-scan | every 15 min, 02:00–13:45 | 08:00–19:45 |
| fsmb-notify-email | every 5 min | — |
| fsmb-lock-and-purge | 18:05 daily | 00:05 |
| fsmb-storage-orphans | 20:00 daily | 02:00 |

## 5. Business rules enforced in the database

- **Roles.** `profiles.role` is the global role. Project roles come from `project_members.member_role`,
  and department scope from `department_heads`. Inactive users match no policy.
- **Admin** has complete system access (decision 28 Sep 2026): every department, project, user,
  role, membership, task field, report, file, setting, dashboard and log, including hard delete of
  projects, tasks and reports that have no daily-report history. Only security protections still refuse
  an Admin: the append-only audit trail, the last-active-admin guard, accounts managed through Supabase
  Auth, and database-calculated columns (see the end of migration 19).
- **Engineer field guard** (`app.tasks_before_write`). Engineers may change status (forward only),
  progress on leaf items, priority, blocker note, contribution while it is unlocked, and submit a plan
  on their own tasks. On tasks they created they may change contribution (unless locked) at any
  status, and title, description and assignee (self or an engineer member) while Not started. They can never set deadlines,
  extensions, codes or archive flags.
- **Working week.** Monday–Friday; Saturday and Sunday are non-working for every deadline,
  overdue, daily-update and deadline-status calculation (`workspace_settings.workdays = {1,2,3,4,5}`).
- **Deadlines.** `effective_due_at = coalesce(extended_deadline, planned_due_at, exec_due_at)`.
  Managers set `planned_due_at` with `set_task_deadline()` or a direct update. Changing the rules in
  `workspace_settings` recalculates open tasks.
- **Mark Done** sets status `Completed`, progress 100 and `completed_on`.
- **Progress.** Sibling contribution weights are normalised (blank weights share the remainder).
  Project completion = Σ leaf weight × leaf progress (`app.task_weights`, `app.project_completion`).
- **Daily reports.** One per user, project and day, for today only. Editable until the day ends, then
  locked by the 00:05 job. "Report status" is the `locked` column; there is no separate enum.
  Items may list only the author's own tasks and subtasks, and saving applies their progress and
  status to those tasks.
- **Notifications** are created by triggers and jobs, only for recipients who can see the task,
  never for the actor, and according to each user's preferences.

## 6. Rollback

- **Local:** `supabase db reset` rebuilds from scratch. To undo only the latest migration while
  developing, delete or fix the file and reset again.
- **Staging (or local without reset):** run `rollback.sql`. It removes jobs, storage
  policies, the bucket, the auth hook function, RPCs, views, tables, the `app` schema, the enums and
  the seeded users, then clears the recorded versions so `supabase db push` can re-apply. Disable the
  auth hook in the dashboard first, and on hosted projects empty the bucket through the Storage API
  (SQL cannot delete stored files). Extensions are left installed.
- **Production:** never run the teardown. Fix forward with a new migration
  (`supabase migration new fix_<topic>`). For data loss, restore from the Supabase daily backup
  (7 days on Pro) or the nightly `pg_dump` kept 90 days, and restore Storage from its separate
  nightly sync, because database backups do not include files.

## 7. Testing RLS

**Automated.** `supabase test db` runs `tests/database/001_rls.test.sql` against the seed. It has
48 checks: department-head scope, PM limits, engineer isolation (projects, tasks, profiles,
notifications, log), the field guard (deadlines, extensions, backward status), task creation and
assignment rules, daily report ownership, removed and inactive users, storage upload, read and
delete per role, admin global access, and anonymous denial. Everything runs in one transaction and
is rolled back.

**Manual, in the SQL editor or psql.** Impersonate a user the same way PostgREST does:

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select code, name from projects;              -- Shorif (engineer): P01 only
select code from tasks;                       -- only his assigned/created tasks
update tasks set planned_due_at = now()
 where code = 'P01-T02b';                     -- ERROR 42501: engineers cannot set deadlines
rollback;
```

Swap the `sub` for other personas: …0002 department head, …0003 PM, …0001 admin, …0018 inactive.
In the app, also confirm with two browser sessions that an engineer's API calls to
`/rest/v1/tasks?project_id=eq.<other project>` return `[]`.
