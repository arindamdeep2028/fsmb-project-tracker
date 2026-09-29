-- =============================================================================
-- Migration 05 · Tasks (responsibilities + subtasks), extensions, progress history, comments
-- (Implementation Blueprint §2.7–2.10)
--
-- Approved decision (Pre-SQL Blueprint §5, option B): PM / Department Head / Admin set a
-- task deadline manually → column `planned_due_at`.
--   effective_due_at = coalesce(extended_deadline, planned_due_at, exec_due_at)
-- Engineers cannot set planned_due_at or extended_deadline (enforced in migration 12).
-- =============================================================================

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  parent_id            uuid references public.tasks (id) on delete restrict,       -- subtasks: one level only
  code                 text not null check (length(code) between 1 and 30),       -- set by trigger
  type                 public.task_type not null default 'Task',
  title                text not null check (length(title) between 1 and 300),
  description          text check (length(description) <= 5000),
  priority             public.task_priority not null default 'Normal',
  assigned_to          uuid not null references public.profiles (id) on delete restrict,
  assigned_by          uuid not null references public.profiles (id) on delete restrict,
  assigned_on          timestamptz not null default now(),
  status               public.task_status not null default 'Not started',
  plan_submitted_at    timestamptz,
  progress_pct         numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  contribution_pct     numeric(5,2) check (contribution_pct between 0 and 100),
  contribution_locked  boolean not null default false,
  last_update          date,
  last_update_at       timestamptz,
  last_update_by       uuid references public.profiles (id) on delete set null,
  completed_on         timestamptz,
  planned_due_at       timestamptz,                                               -- manager-set deadline
  extended_deadline    timestamptz,
  extended_by          uuid references public.profiles (id) on delete set null,
  blocker_note         text check (length(blocker_note) <= 1000),
  clock_start_at       timestamptz,                                               -- stored by trigger
  plan_due_at          timestamptz,                                               -- stored by trigger
  exec_due_at          timestamptz,                                               -- stored by trigger
  effective_due_at     timestamptz,                                               -- stored by trigger
  subtask_seq          smallint not null default 0 check (subtask_seq >= 0),
  archived             boolean not null default false,
  archived_at          timestamptz,
  archived_by          uuid references public.profiles (id) on delete set null,
  legacy_row           integer,
  created_at           timestamptz not null default now(),
  created_by           uuid not null references public.profiles (id) on delete restrict,
  updated_at           timestamptz not null default now(),
  constraint task_code_unique      unique (project_id, code),
  constraint subtask_has_parent    check ((type = 'Subtask') = (parent_id is not null)),
  constraint completed_has_date    check ((status = 'Completed') = (completed_on is not null)),
  constraint completed_is_100      check (status <> 'Completed' or progress_pct = 100),
  constraint not_own_parent        check (parent_id is null or parent_id <> id)
);
alter table public.tasks enable row level security;

create table public.task_extensions (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks (id) on delete cascade,
  previous_deadline  timestamptz,
  new_deadline       timestamptz not null,
  reason             text check (length(reason) <= 1000),
  granted_by         uuid references public.profiles (id) on delete set null,     -- null only for imports
  granted_at         timestamptz not null default now(),
  source             text not null default 'app' check (source in ('app', 'excel_import'))
);
alter table public.task_extensions enable row level security;

-- Progress and contribution history (the FK to daily_report_items is added in migration 06).
create table public.task_contributions (
  id                    bigint generated always as identity primary key,
  task_id               uuid not null references public.tasks (id) on delete cascade,
  user_id               uuid references public.profiles (id) on delete set null,
  progress_before       numeric(5,2),
  progress_after        numeric(5,2),
  contribution_before   numeric(5,2),
  contribution_after    numeric(5,2),
  daily_report_item_id  uuid,
  recorded_at           timestamptz not null default now()
);
alter table public.task_contributions enable row level security;

create table public.task_comments (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks (id) on delete cascade,
  author_id           uuid not null references public.profiles (id) on delete restrict,
  parent_comment_id   uuid references public.task_comments (id) on delete set null,
  body                text not null check (length(body) between 1 and 4000),
  is_manager_comment  boolean not null default false,
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  deleted_at          timestamptz
);
alter table public.task_comments enable row level security;
