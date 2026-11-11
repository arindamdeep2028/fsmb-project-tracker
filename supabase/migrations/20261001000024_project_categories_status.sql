-- =============================================================================
-- Migration 24 · Project categories and project lifecycle status history
--
-- Additive only: no project is deleted, recreated or renumbered; members, tasks, reports, attachments,
-- settings and logs are untouched. Rollback: supabase/rollback_20261001000024.sql.
--
-- A. Category. Four categories; every existing project is placed in Software (the column default fills it).
--    A new project gets the category of the tab it was created from. Changing a project's category is a
--    structural change: Admin or the head of the project's department (same rule as code and department).
--
-- B. Lifecycle status. The stored values stay as they are so every view, dashboard figure, performance
--    calculation and job that reads projects.status keeps working unchanged. The app shows them as:
--        'Active'  → Running      'On hold' → Halted      'Completed' → Completed
--    Allowed changes (anyone who may already edit the project: Admin, the department's head, the project PM):
--        Running → Halted, Halted → Running, Running → Completed, Halted → Completed, Completed → Running
--    'Cancelled' stays in the enum for old data but is no longer offered or reachable.
--    Database-internal writes (no signed-in user) are not restricted, as in the other project triggers.
--
-- C. History. Every status change is recorded in project_status_history (previous status, new status, when,
--    who, optional reason) by a trigger, whichever way the status was changed. Rows are read-only for users.
--    The optional reason is passed by public.set_project_status() for the length of its own transaction.
--    Existing projects get one baseline row so their history is never empty (see D).
-- =============================================================================

-- ---------- A. Category ----------
create type public.project_category as enum ('Software', 'Embedded', 'Optical', 'Mechanical');

alter table public.projects
  add column category public.project_category not null default 'Software';

create index projects_category_idx on public.projects (category, code) where not archived;

create or replace function app.projects_category_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not (app.is_admin() or app.heads_department(old.department_id)) then
    raise exception 'Only an admin or the head of this department can change a project''s category'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger projects_category_guard before update of category on public.projects
  for each row when (old.category is distinct from new.category)
  execute function app.projects_category_guard();

-- ---------- B. Allowed status changes ----------
create or replace function app.project_status_label(p_status public.project_status) returns text
language sql immutable set search_path = '' as $$
  select case p_status when 'Active' then 'Running' when 'On hold' then 'Halted' else p_status::text end;
$$;

create or replace function app.projects_status_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_step text := old.status::text || ' > ' || new.status::text;
begin
  if auth.uid() is null then return new; end if;                -- database-internal write
  if v_step not in ('Active > On hold', 'On hold > Active', 'Active > Completed', 'On hold > Completed', 'Completed > Active') then
    raise exception 'A project can''t move from % to %', app.project_status_label(old.status), app.project_status_label(new.status)
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger projects_status_guard before update of status on public.projects
  for each row when (old.status is distinct from new.status)
  execute function app.projects_status_guard();

-- ---------- C. Status history ----------
create table public.project_status_history (
  id               bigint generated always as identity primary key,
  project_id       uuid not null references public.projects (id) on delete cascade,
  kind             text not null default 'change' check (kind in ('created', 'change', 'baseline')),
  from_status      public.project_status,                      -- null for 'created' and 'baseline'
  to_status        public.project_status not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid references public.profiles (id) on delete set null,
  changed_by_name  text,                                       -- kept so the name shows to every viewer
  reason           text check (length(reason) <= 1000),
  constraint status_history_from check ((kind = 'change') = (from_status is not null))
);
alter table public.project_status_history enable row level security;
create index project_status_history_project_idx on public.project_status_history (project_id, changed_at desc, id desc);

create policy project_status_history_read on public.project_status_history for select to authenticated
  using (app.can_see_project(project_id));
revoke all on public.project_status_history from public, anon, authenticated;
grant select on public.project_status_history to authenticated;
-- No insert/update/delete grant: rows are written only by the trigger below and are never edited.

create or replace function app.projects_record_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := coalesce(auth.uid(), case when tg_op = 'INSERT' then new.created_by end);
  v_reason text := nullif(btrim(coalesce(current_setting('app.project_status_reason', true), '')), '');
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  insert into public.project_status_history (project_id, kind, from_status, to_status, changed_by, changed_by_name, reason)
  values (new.id,
          case when tg_op = 'INSERT' then 'created' else 'change' end,
          case when tg_op = 'UPDATE' then old.status end,
          new.status, v_uid,
          (select p.full_name from public.profiles p where p.id = v_uid),
          case when tg_op = 'INSERT' then coalesce(v_reason, 'Project created') else left(v_reason, 1000) end);
  return null;
end $$;

create trigger projects_record_status after insert or update of status on public.projects
  for each row execute function app.projects_record_status();

/**
 * Change a project's status with an optional reason. Runs as the caller, so the projects RLS policy and
 * triggers decide whether it is allowed exactly as for any other project edit.
 */
create or replace function public.set_project_status(p_project uuid, p_status public.project_status, p_reason text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.project_status;
  v_rows    integer;
begin
  if length(p_reason) > 1000 then
    raise exception 'Keep the reason under 1000 characters' using errcode = '23514';
  end if;
  select status into v_current from public.projects where id = p_project;
  if not found then
    raise exception 'Project not found' using errcode = '42501';
  end if;
  if v_current = p_status then
    raise exception 'The project is already %', app.project_status_label(p_status) using errcode = '23514';
  end if;
  perform set_config('app.project_status_reason', coalesce(p_reason, ''), true);
  update public.projects set status = p_status where id = p_project;
  get diagnostics v_rows = row_count;
  perform set_config('app.project_status_reason', '', true);
  if v_rows = 0 then
    raise exception 'Not allowed' using errcode = '42501';     -- RLS hid the row from this user's update
  end if;
end $$;
revoke execute on function public.set_project_status(uuid, public.project_status, text) from public, anon;
grant execute on function public.set_project_status(uuid, public.project_status, text) to authenticated;
revoke execute on function app.project_status_label(public.project_status) from public, anon;
grant execute on function app.project_status_label(public.project_status) to authenticated, service_role;

-- ---------- D. Baseline history for projects that already exist ----------
-- If the project log shows the status was never edited, the current status is the one it was created with:
-- record it as "created" at the project's creation time, by its creator. Otherwise the earlier changes are
-- only in the project Log (which never stored the values), so record a baseline at the time of this upgrade.
insert into public.project_status_history (project_id, kind, from_status, to_status, changed_at, changed_by, changed_by_name, reason)
select p.id,
       case when s.edited then 'baseline' else 'created' end,
       null,
       p.status,
       case when s.edited then now() else p.created_at end,
       case when s.edited then null else p.created_by end,
       case when s.edited then null else (select pr.full_name from public.profiles pr where pr.id = p.created_by) end,
       case when s.edited then 'Status when status history started; earlier changes are in the project Log'
            else 'Project created' end
  from public.projects p
  cross join lateral (
    select exists (select 1 from public.activity_log l
                    where l.project_id = p.id and l.action = 'Edited' and l.task_id is null
                      and l.details like 'Project: %'
                      and 'status' = any (string_to_array(substr(l.details, 10), ', '))) as edited
  ) s
 where not exists (select 1 from public.project_status_history h where h.project_id = p.id);
