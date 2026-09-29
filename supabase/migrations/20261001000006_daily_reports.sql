-- =============================================================================
-- Migration 06 · Daily reports, report items (tasks/subtasks) and attachments
-- (Implementation Blueprint §2.11–2.13). Chain: tasks → daily_report_items → daily_reports → attachments
-- "Report status" is represented by `locked` (open for editing until the day ends).
-- =============================================================================

create table public.daily_reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  project_id      uuid not null references public.projects (id) on delete restrict,
  report_date     date not null,                     -- set by trigger (Dhaka today) when omitted
  day_name        text not null,                     -- set by trigger; to_char() is not immutable
  update_text     text not null check (length(update_text) between 1 and 5000),
  issues          text check (length(issues) <= 3000),
  next_task_id    uuid references public.tasks (id) on delete set null,
  next_task_text  text check (length(next_task_text) <= 1000),
  remarks         text check (length(remarks) <= 3000),
  locked          boolean not null default false,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint one_report_per_day unique (user_id, project_id, report_date)
);
alter table public.daily_reports enable row level security;

create table public.daily_report_items (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.daily_reports (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete restrict,
  parent_task_id  uuid references public.tasks (id) on delete set null,
  task_code       text not null,                     -- snapshot, set by trigger
  task_title      text not null,                     -- snapshot, set by trigger
  progress_after  numeric(5,2) check (progress_after between 0 and 100),
  status_after    public.task_status,
  note            text check (length(note) <= 3000),
  created_at      timestamptz not null default now(),
  constraint task_once_per_report unique (report_id, task_id)
);
alter table public.daily_report_items enable row level security;

create table public.daily_report_attachments (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.daily_reports (id) on delete cascade,
  storage_path  text not null unique,                -- {project_id}/{report_id}/{uuid}-{file name}
  file_name     text not null check (length(file_name) between 1 and 255),
  mime_type     text not null check (mime_type in (
                  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  size_bytes    integer not null check (size_bytes between 1 and 10485760),
  uploaded_by   uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  uploaded_at   timestamptz not null default now()
);
alter table public.daily_report_attachments enable row level security;

alter table public.task_contributions
  add constraint task_contributions_report_item_fk
  foreign key (daily_report_item_id) references public.daily_report_items (id) on delete set null;
