-- =============================================================================
-- Migration 03 · Organisation: departments, profiles, department_heads, workspace_settings
-- (Implementation Blueprint §2.1–2.4). RLS is enabled here; policies arrive in migration 15.
-- =============================================================================

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        extensions.citext not null unique check (length(name) between 1 and 80),
  sort_order  smallint not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.departments enable row level security;

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  full_name             text not null check (length(full_name) between 1 and 120),
  login_name            extensions.citext not null unique check (length(login_name) between 1 and 60),
  email                 extensions.citext unique,
  department_id         uuid references public.departments (id) on delete set null,
  role                  public.user_role not null default 'engineer',
  active                boolean not null default true,
  must_change_password  boolean not null default true,
  legacy_name           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.department_heads (
  department_id  uuid not null references public.departments (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  assigned_by    uuid references public.profiles (id) on delete set null,
  assigned_at    timestamptz not null default now(),
  primary key (department_id, user_id)
);
alter table public.department_heads enable row level security;

create table public.workspace_settings (
  id                           smallint primary key default 1 check (id = 1),
  office_start                 smallint not null default 9  check (office_start between 0 and 23),
  office_end                   smallint not null default 18 check (office_end between 1 and 24),
  plan_hours                   smallint not null default 3  check (plan_hours between 1 and 24),
  exec_days                    smallint not null default 1  check (exec_days between 1 and 10),
  workdays                     smallint[] not null default '{1,2,3,4,5}'
                                 check (cardinality(workdays) > 0 and workdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  timezone                     text not null default 'Asia/Dhaka',
  score_weight_on_time         numeric(3,2) not null default 0.70 check (score_weight_on_time between 0 and 1),
  score_weight_clean           numeric(3,2) not null default 0.30 check (score_weight_clean between 0 and 1),
  review_window_days           smallint not null default 120 check (review_window_days between 7 and 730),
  deadline_warning_hours       smallint not null default 3 check (deadline_warning_hours between 1 and 48),
  daily_scan_time              time not null default '09:05',
  digest_email                 extensions.citext,
  notification_retention_days  smallint not null default 90 check (notification_retention_days between 7 and 730),
  report_edit_until            time not null default '23:59',
  attachment_max_mb            smallint not null default 10 check (attachment_max_mb between 1 and 50),
  attachment_max_files         smallint not null default 10 check (attachment_max_files between 1 and 50),
  schema_version               smallint not null default 1,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id) on delete set null,
  constraint office_hours_order check (office_end > office_start),
  constraint score_weights_sum  check (score_weight_on_time + score_weight_clean = 1.00)
);
alter table public.workspace_settings enable row level security;

-- The rule functions read this row, so it is created with the schema (not only in seed.sql).
insert into public.workspace_settings (id) values (1) on conflict (id) do nothing;
