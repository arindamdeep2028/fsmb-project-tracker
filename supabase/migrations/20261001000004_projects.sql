-- =============================================================================
-- Migration 04 · Projects and project membership (Implementation Blueprint §2.5–2.6)
-- Relationship chain: departments → projects → project_members ← profiles
-- =============================================================================

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null check (length(code) between 1 and 20),
  name               text not null check (length(name) between 1 and 200),
  description        text check (length(description) <= 5000),
  department_id      uuid not null references public.departments (id) on delete restrict,
  pm_id              uuid references public.profiles (id) on delete set null,   -- lead PM
  status             public.project_status not null default 'Active',
  start_date         date,
  target_end         date,
  notes              text check (length(notes) <= 5000),
  task_seq           integer not null default 0 check (task_seq >= 0),         -- top-level task code counter
  archived           boolean not null default false,
  archived_at        timestamptz,
  archived_by        uuid references public.profiles (id) on delete set null,
  is_demo            boolean not null default false,
  legacy_sheet_name  text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint project_dates_order check (target_end is null or start_date is null or target_end >= start_date)
);
alter table public.projects enable row level security;

create table public.project_members (
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  member_role  public.project_member_role not null,
  added_by     uuid references public.profiles (id) on delete set null,
  added_at     timestamptz not null default now(),
  removed_at   timestamptz,
  removed_by   uuid references public.profiles (id) on delete set null,
  primary key (project_id, user_id)
);
alter table public.project_members enable row level security;
