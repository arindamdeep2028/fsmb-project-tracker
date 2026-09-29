-- =============================================================================
-- Migration 07 · Notifications and preferences (Implementation Blueprint §2.14–2.15)
-- =============================================================================

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,   -- recipient
  type          public.notification_type not null,
  project_id    uuid references public.projects (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  actor_id      uuid references public.profiles (id) on delete set null,
  title         text not null check (length(title) between 1 and 200),
  body          text check (length(body) <= 2000),
  link          text,
  dedup_key     text,
  email_wanted  boolean not null default false,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  emailed_at    timestamptz
);
alter table public.notifications enable row level security;

create table public.notification_preferences (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  type     public.notification_type not null,
  in_app   boolean not null default true,
  email    boolean not null default false,
  primary key (user_id, type),
  constraint mandatory_in_app check (in_app or type not in ('task_assigned', 'task_overdue'))
);
alter table public.notification_preferences enable row level security;
