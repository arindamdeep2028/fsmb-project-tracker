-- =============================================================================
-- Migration 08 · Audit log and job history (Implementation Blueprint §2.16–2.17)
-- =============================================================================

create table public.activity_log (
  id               bigint generated always as identity primary key,
  ts               timestamptz not null default now(),
  log_date         date generated always as ((ts at time zone 'Asia/Dhaka')::date) stored,
  scope            public.log_scope not null,         -- filled by trigger when omitted
  action           public.log_action not null,
  subject_user_id  uuid references public.profiles (id) on delete set null,
  subject_name     text,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  project_code     text,
  task_id          uuid references public.tasks (id) on delete set null,
  task_code        text,
  details          text,
  reason_code      public.breach_reason,
  source           text not null default 'app' check (source in ('app', 'scan', 'excel_import', 'system')),
  constraint project_scope_has_code check (scope <> 'project' or project_code is not null),
  constraint red_mark_has_reason    check (action <> 'Red mark' or reason_code is not null)
);
alter table public.activity_log enable row level security;

create table public.scan_runs (
  id                     bigint generated always as identity primary key,
  job                    text not null check (job in ('red-mark-scan', 'deadline-scan', 'notify-email',
                           'lock-and-purge', 'storage-orphans', 'recompute-deadlines', 'backup-db', 'backup-storage')),
  trigger                text not null default 'cron' check (trigger in ('cron', 'manual')),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  flagged_tasks          integer,
  new_red_marks          integer,
  notifications_created  integer,
  emails_sent            integer,
  error                  text
);
alter table public.scan_runs enable row level security;
