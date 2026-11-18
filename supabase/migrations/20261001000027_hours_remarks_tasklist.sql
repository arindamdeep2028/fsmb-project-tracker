-- =============================================================================
-- Migration 27 · Working hours, daily-report remarks, report reassignment, Tasklist
--
-- A. Working hours     daily_report_items.work_hours (hours on that task) and daily_reports.work_hours (hours not
--                      tied to a task). 0 < h <= 24, two decimals; a deferred constraint trigger keeps one report's
--                      total at 24 h or less. save_daily_report / save_daily_row carry the new fields.
-- B. Remarks           daily_report_remarks: an Admin's remark on a project day, addressed to one current member of
--                      the project. Admin-only writes (RLS + trigger), no delete; every version is kept in
--                      daily_report_remark_history; the recipient gets a 'daily_remark' notification. Readable by
--                      Admin, the recipient, and the project's managers (PM / Department Head).
--                      The old free-text daily_reports.remarks stays readable; only an Admin may change it now.
-- C. Reassignment      an Admin may change the person of a saved report (save_daily_row). The new person must be a
--                      current member; one report per person, project and day still holds (23505). Every change is
--                      recorded in daily_report_assignment_changes and in the activity log.
-- D. Tasklist          task_assignees (extra people on a task; tasks.assigned_to stays the owner every deadline,
--                      score and report rule uses) and task_list_comments (the Tasklist's short Comments column).
--
-- No existing rows are changed or removed. Existing policies and triggers stay; new ones are added beside them.
--
-- Rollback (drops only what this migration added; data in the new tables/columns is lost):
--   drop function if exists public.save_daily_row(jsonb); drop function if exists public.save_daily_report(jsonb);
--     → re-create both from migration 22
--   drop table public.task_list_comments, public.task_assignees, public.daily_report_assignment_changes,
--              public.daily_report_remark_history, public.daily_report_remarks;
--   drop trigger daily_reports_hours_total on public.daily_reports; drop trigger daily_report_items_hours_total on public.daily_report_items;
--   drop trigger daily_reports_remarks_guard on public.daily_reports; drop trigger daily_reports_reassign_guard on public.daily_reports;
--   drop trigger daily_reports_after_reassign on public.daily_reports;
--   drop function app.report_hours_check(), app.daily_reports_remarks_guard(), app.daily_reports_reassign_guard(),
--                 app.daily_reports_after_reassign(), app.remarks_before_write(), app.remarks_after_write(),
--                 app.task_assignees_before_insert(), app.task_assignees_after_insert(), app.task_list_comments_before_write();
--   alter table public.daily_report_items drop column work_hours; alter table public.daily_reports drop column work_hours;
--   (the enum value notification_type 'daily_remark' cannot be dropped; it is harmless when unused)
-- =============================================================================

alter type public.notification_type add value if not exists 'daily_remark';

-- ---------------------------------------------------------------- A. Working hours
alter table public.daily_report_items add column work_hours numeric(4,2)
  constraint daily_report_items_work_hours_range check (work_hours is null or (work_hours > 0 and work_hours <= 24));
alter table public.daily_reports add column work_hours numeric(4,2)
  constraint daily_reports_work_hours_range check (work_hours is null or (work_hours > 0 and work_hours <= 24));
comment on column public.daily_report_items.work_hours is 'Hours worked on this task that day (decimal, e.g. 1.5).';
comment on column public.daily_reports.work_hours is 'Hours worked that day that are not tied to a listed task.';

create or replace function app.report_hours_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_report uuid; v_total numeric;
begin
  if tg_table_name = 'daily_reports' then v_report := new.id; else v_report := new.report_id; end if;
  select coalesce((select r.work_hours from public.daily_reports r where r.id = v_report), 0)
       + coalesce((select sum(i.work_hours) from public.daily_report_items i where i.report_id = v_report), 0)
    into v_total;
  if v_total > 24 then
    raise exception 'The working hours of one daily report cannot add up to more than 24' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger daily_reports_hours_total after insert or update of work_hours on public.daily_reports
  deferrable initially deferred for each row execute function app.report_hours_check();
create constraint trigger daily_report_items_hours_total after insert or update of work_hours on public.daily_report_items
  deferrable initially deferred for each row execute function app.report_hours_check();

-- The old free-text remark on a report: only an Admin may write or change it (remarks are the Admin's now).
create or replace function app.daily_reports_remarks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or app.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.remarks is not null then raise exception 'Only an admin can write remarks' using errcode = '42501'; end if;
  elsif new.remarks is distinct from old.remarks then
    raise exception 'Only an admin can write remarks' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger daily_reports_remarks_guard before insert or update on public.daily_reports
  for each row execute function app.daily_reports_remarks_guard();

-- ---------------------------------------------------------------- C. Reassignment
create table public.daily_report_assignment_changes (
  id          bigint generated always as identity primary key,
  report_id   uuid not null references public.daily_reports (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  report_date date not null,
  from_user   uuid references public.profiles (id) on delete set null,
  to_user     uuid references public.profiles (id) on delete set null,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);
alter table public.daily_report_assignment_changes enable row level security;
create index daily_report_assignment_changes_report_idx on public.daily_report_assignment_changes (report_id);

create or replace function app.daily_reports_reassign_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not distinct from old.user_id then return new; end if;
  if auth.uid() is not null and not app.is_admin() then
    raise exception 'Only an admin can change who a daily report belongs to' using errcode = '42501';
  end if;
  if not app.user_is_member(new.user_id, new.project_id) then
    raise exception 'The person must be a current member of the project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger daily_reports_reassign_guard before update of user_id on public.daily_reports
  for each row execute function app.daily_reports_reassign_guard();

create or replace function app.daily_reports_after_reassign() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_from text; v_to text;
begin
  insert into public.daily_report_assignment_changes (report_id, project_id, report_date, from_user, to_user, changed_by)
  values (new.id, new.project_id, new.report_date, old.user_id, new.user_id, auth.uid());
  select full_name into v_from from public.profiles where id = old.user_id;
  select full_name into v_to from public.profiles where id = new.user_id;
  perform app.log_event('Edited', new.project_id, null, new.user_id,
    'Daily report ' || to_char(new.report_date, 'DD-Mon-YYYY') || ' reassigned from ' || coalesce(v_from, '?') || ' to ' || coalesce(v_to, '?'));
  return null;
end $$;
create trigger daily_reports_after_reassign after update of user_id on public.daily_reports
  for each row when (old.user_id is distinct from new.user_id) execute function app.daily_reports_after_reassign();

create policy assignment_changes_read on public.daily_report_assignment_changes for select to authenticated
  using ((select app.is_admin()) or app.manages_project(project_id) or from_user = (select auth.uid()) or to_user = (select auth.uid()));

-- ---------------------------------------------------------------- B. Remarks
create table public.daily_report_remarks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  report_date   date not null,
  recipient_id  uuid not null references public.profiles (id) on delete restrict,
  author_id     uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  -- names as they were when written (set by the trigger): the recipient may not be allowed to read the Admin's
  -- profile row, but must see who gave the remark
  author_name     text not null default '',
  recipient_name  text not null default '',
  body          text not null constraint remark_body_length check (length(btrim(body)) between 1 and 2000),
  edit_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.daily_report_remarks enable row level security;
create index daily_report_remarks_day_idx on public.daily_report_remarks (project_id, report_date);
create index daily_report_remarks_recipient_idx on public.daily_report_remarks (recipient_id);

create table public.daily_report_remark_history (
  id            bigint generated always as identity primary key,
  remark_id     uuid not null references public.daily_report_remarks (id) on delete cascade,
  action        text not null check (action in ('created', 'edited')),
  body          text not null,
  recipient_id  uuid references public.profiles (id) on delete set null,
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz not null default now()
);
alter table public.daily_report_remark_history enable row level security;
create index daily_report_remark_history_remark_idx on public.daily_report_remark_history (remark_id);

create or replace function app.remarks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_admin() then
    raise exception 'Only an admin can write remarks' using errcode = '42501';
  end if;
  new.body := btrim(new.body);
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now(); new.edit_count := 0;
    new.author_name := coalesce((select p.full_name from public.profiles p where p.id = new.author_id), '');
  else
    if new.project_id <> old.project_id or new.report_date <> old.report_date
       or new.author_id <> old.author_id or new.created_at <> old.created_at or new.author_name <> old.author_name then
      raise exception 'Only the remark text and its recipient can change' using errcode = '42501';
    end if;
    if new.body is not distinct from old.body and new.recipient_id is not distinct from old.recipient_id then
      return null;                                         -- nothing changed: no history, no notification
    end if;
    new.edit_count := old.edit_count + 1;
  end if;
  new.updated_at := now();
  new.recipient_name := coalesce((select p.full_name from public.profiles p where p.id = new.recipient_id), '');
  if new.report_date > app.dhaka_today() then
    raise exception 'A remark cannot be dated after today' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if not app.user_is_member(new.recipient_id, new.project_id) then
      raise exception 'The remark must go to a current member of the project' using errcode = '23514';
    end if;
  elsif new.recipient_id <> old.recipient_id and not app.user_is_member(new.recipient_id, new.project_id) then
    raise exception 'The remark must go to a current member of the project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger remarks_before_write before insert or update on public.daily_report_remarks
  for each row execute function app.remarks_before_write();

create or replace function app.remarks_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.daily_report_remark_history (remark_id, action, body, recipient_id, changed_by)
  values (new.id, case when tg_op = 'INSERT' then 'created' else 'edited' end, new.body, new.recipient_id, auth.uid());
  insert into public.notifications (user_id, type, title, body, project_id, link)
  values (new.recipient_id, 'daily_remark',
          case when tg_op = 'INSERT' then 'New remark on your daily report' else 'Remark updated on your daily report' end
            || ' · ' || to_char(new.report_date, 'DD-Mon-YY'),
          left(new.body, 300), new.project_id,
          '/projects/' || new.project_id || '/daily-reports?from=' || new.report_date || '&to=' || new.report_date || '&remark=' || new.id);
  perform app.log_event('Comment', new.project_id, null, new.recipient_id,
    case when tg_op = 'INSERT' then 'Remark on daily report ' else 'Remark edited on daily report ' end || to_char(new.report_date, 'DD-Mon-YYYY'));
  return null;
end $$;
create trigger remarks_after_write after insert or update on public.daily_report_remarks
  for each row execute function app.remarks_after_write();

create policy remarks_read on public.daily_report_remarks for select to authenticated
  using ((select app.is_admin()) or recipient_id = (select auth.uid()) or app.manages_project(project_id));
create policy remarks_insert on public.daily_report_remarks for insert to authenticated
  with check ((select app.is_admin()));
create policy remarks_update on public.daily_report_remarks for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
-- no delete policy: a remark, once given, stays (its history too)

create policy remark_history_read on public.daily_report_remark_history for select to authenticated
  using (exists (select 1 from public.daily_report_remarks r where r.id = remark_id));

-- ---------------------------------------------------------------- D. Tasklist
create table public.task_assignees (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.task_assignees enable row level security;
create index task_assignees_user_idx on public.task_assignees (user_id);

create or replace function app.task_assignees_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  if t.assigned_to = new.user_id then
    raise exception 'This person already owns the task' using errcode = '23505';
  end if;
  if not app.user_is_member(new.user_id, t.project_id) then
    raise exception 'The person must be a current member of the project' using errcode = '23514';
  end if;
  new.added_by := coalesce(auth.uid(), new.added_by); new.added_at := now();
  return new;
end $$;
create trigger task_assignees_before_insert before insert on public.task_assignees
  for each row execute function app.task_assignees_before_insert();

create or replace function app.task_assignees_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  -- a project-level notification (an extra assigned person reads the task through the project, like every member)
  insert into public.notifications (user_id, type, title, body, project_id, link)
  values (new.user_id, 'task_assigned', left('Added to task: ' || t.code, 200), left(t.title, 2000), t.project_id,
          '/projects/' || t.project_id || '/tasklist');
  perform app.log_event('Assigned', t.project_id, t.id, new.user_id, 'Added as an assigned person');
  return null;
end $$;
create trigger task_assignees_after_insert after insert on public.task_assignees
  for each row execute function app.task_assignees_after_insert();

-- read like the tasks themselves (tasks_read: everyone who can see the project)
create policy task_assignees_read on public.task_assignees for select to authenticated
  using (app.can_see_project(app.task_project(task_id)));
create policy task_assignees_insert on public.task_assignees for insert to authenticated
  with check (app.manages_project(app.task_project(task_id)));
create policy task_assignees_delete on public.task_assignees for delete to authenticated
  using (app.manages_project(app.task_project(task_id)));

create table public.task_list_comments (
  task_id     uuid primary key references public.tasks (id) on delete cascade,
  body        text not null constraint task_list_comment_length check (length(body) <= 500),
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.task_list_comments enable row level security;

create or replace function app.task_list_comments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.task_id <> old.task_id then
    raise exception 'The task of a comment cannot change' using errcode = '42501';
  end if;
  new.body := btrim(new.body);
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  return new;
end $$;
create trigger task_list_comments_before_write before insert or update on public.task_list_comments
  for each row execute function app.task_list_comments_before_write();

-- managers of the project, the task's owner, and its other assigned people
create or replace function app.can_comment_task_list(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.manages_project(app.task_project(p_task))
      or exists (select 1 from public.tasks t where t.id = p_task and t.assigned_to = auth.uid() and app.is_project_member(t.project_id))
      or exists (select 1 from public.task_assignees a join public.tasks t on t.id = a.task_id
                  where a.task_id = p_task and a.user_id = auth.uid() and app.is_project_member(t.project_id));
$$;

create policy task_list_comments_read on public.task_list_comments for select to authenticated
  using (app.can_see_project(app.task_project(task_id)));
create policy task_list_comments_insert on public.task_list_comments for insert to authenticated
  with check (app.can_comment_task_list(task_id));
create policy task_list_comments_update on public.task_list_comments for update to authenticated
  using (app.can_comment_task_list(task_id)) with check (app.can_comment_task_list(task_id));

-- ---------------------------------------------------------------- RPCs (A + C)
-- save_daily_report: as migration 22, plus work_hours (report and item). The free-text remark is written only by
-- an Admin, and only when the payload names it; otherwise the saved value stays.
create or replace function public.save_daily_report(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id     uuid;
  v_items  jsonb := case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]'::jsonb end;
  v_remove uuid[] := array(select x::uuid from jsonb_array_elements_text(
                       case when jsonb_typeof(p -> 'remove_task_ids') = 'array' then p -> 'remove_task_ids' else '[]'::jsonb end) x);
  v_set_remarks boolean := p ? 'remarks' and app.is_admin();
  v_set_hours   boolean := p ? 'work_hours';
begin
  insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_id, next_task_text, remarks, work_hours)
  values (auth.uid(), (p ->> 'project_id')::uuid, coalesce((p ->> 'report_date')::date, app.dhaka_today()),
          p ->> 'update_text', p ->> 'issues', nullif(p ->> 'next_task_id', '')::uuid, p ->> 'next_task_text',
          case when v_set_remarks then nullif(p ->> 'remarks', '') end, nullif(p ->> 'work_hours', '')::numeric)
  on conflict (user_id, project_id, report_date) do update
     set update_text = excluded.update_text, issues = excluded.issues, next_task_id = excluded.next_task_id,
         next_task_text = excluded.next_task_text,
         remarks = case when v_set_remarks then excluded.remarks else public.daily_reports.remarks end,
         work_hours = case when v_set_hours then excluded.work_hours else public.daily_reports.work_hours end
  returning id into v_id;

  if cardinality(v_remove) > 0 then
    delete from public.daily_report_items i
     where i.report_id = v_id
       and i.task_id = any (v_remove)
       and i.task_id not in (select (x ->> 'task_id')::uuid from jsonb_array_elements(v_items) x);
  end if;

  insert into public.daily_report_items (report_id, task_id, progress_after, status_after, note, work_hours)
  select v_id, (x ->> 'task_id')::uuid, (x ->> 'progress_after')::numeric,
         nullif(x ->> 'status_after', '')::public.task_status, x ->> 'note', nullif(x ->> 'work_hours', '')::numeric
    from jsonb_array_elements(v_items) x
  on conflict (report_id, task_id) do update
     set progress_after = excluded.progress_after, status_after = excluded.status_after, note = excluded.note,
         work_hours = excluded.work_hours;
  return v_id;
end $$;

-- save_daily_row: as migration 22, plus work_hours, and an Admin may give a saved report to another member
-- (user_id differs from the saved one: the reassign trigger checks and records it). The free-text remark changes
-- only when the payload names it.
create or replace function public.save_daily_row(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_report  uuid := nullif(p ->> 'report_id', '')::uuid;
  v_user    uuid := nullif(p ->> 'user_id', '')::uuid;
  v_project uuid := nullif(p ->> 'project_id', '')::uuid;
  v_date    date := nullif(p ->> 'report_date', '')::date;
  v_item    jsonb := case when jsonb_typeof(p -> 'item') = 'object' then p -> 'item' end;
  v_remove  uuid[] := array(select x::uuid from jsonb_array_elements_text(
                        case when jsonb_typeof(p -> 'remove_task_ids') = 'array' then p -> 'remove_task_ids' else '[]'::jsonb end) x);
  v_hours   numeric := nullif(p ->> 'work_hours', '')::numeric;
  v_id      uuid;
begin
  if v_user is null or v_project is null or v_date is null then
    raise exception 'A daily report needs a person, a project and a date' using errcode = '22023';
  end if;
  if v_date > app.dhaka_today() then
    raise exception 'A daily report cannot be dated after today' using errcode = '22023';
  end if;
  if not app.is_admin() and (v_user is distinct from auth.uid() or v_date <> app.dhaka_today()) then
    raise exception 'Only an admin can add or change a daily report for an earlier date or for another person'
      using errcode = '42501';
  end if;

  if v_report is null then
    if not app.user_is_member(v_user, v_project) then
      raise exception 'The person must be a current member of the project' using errcode = '23514';
    end if;
    insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_text, remarks, work_hours)
    values (v_user, v_project, v_date, p ->> 'update_text', nullif(p ->> 'issues', ''), nullif(p ->> 'next_task_text', ''),
            case when p ? 'remarks' then nullif(p ->> 'remarks', '') end, v_hours)
    returning id into v_id;                                   -- one_report_per_day: an existing report raises 23505
  else
    update public.daily_reports r
       set user_id = v_user,
           update_text = p ->> 'update_text', issues = nullif(p ->> 'issues', ''),
           next_task_text = nullif(p ->> 'next_task_text', ''),
           remarks = case when p ? 'remarks' then nullif(p ->> 'remarks', '') else r.remarks end,
           work_hours = case when p ? 'work_hours' then v_hours else r.work_hours end
     where r.id = v_report and r.project_id = v_project and r.report_date = v_date
    returning r.id into v_id;
    if v_id is null then
      raise exception 'Not found, or you no longer have access to it.' using errcode = 'P0002';
    end if;
  end if;

  if cardinality(v_remove) > 0 then
    delete from public.daily_report_items i
     where i.report_id = v_id
       and i.task_id = any (v_remove)
       and (v_item is null or i.task_id <> (v_item ->> 'task_id')::uuid);
  end if;

  if v_item is not null then
    insert into public.daily_report_items (report_id, task_id, progress_after, status_after, work_hours)
    values (v_id, (v_item ->> 'task_id')::uuid, (v_item ->> 'progress_after')::numeric,
            nullif(v_item ->> 'status_after', '')::public.task_status, nullif(v_item ->> 'work_hours', '')::numeric)
    on conflict (report_id, task_id) do update
       set progress_after = excluded.progress_after, status_after = excluded.status_after, work_hours = excluded.work_hours;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on public.daily_report_remarks, public.daily_report_remark_history, public.daily_report_assignment_changes,
              public.task_assignees, public.task_list_comments from anon, authenticated;
grant select on public.daily_report_remarks, public.daily_report_remark_history, public.daily_report_assignment_changes,
                public.task_assignees, public.task_list_comments to authenticated;
grant insert (project_id, report_date, recipient_id, body) on public.daily_report_remarks to authenticated;
grant update (recipient_id, body) on public.daily_report_remarks to authenticated;
grant insert (task_id, user_id), delete on public.task_assignees to authenticated;
grant insert (task_id, body), update (body) on public.task_list_comments to authenticated;
grant all on public.daily_report_remarks, public.daily_report_remark_history, public.daily_report_assignment_changes,
             public.task_assignees, public.task_list_comments to service_role;

revoke execute on function app.report_hours_check(), app.daily_reports_remarks_guard(), app.daily_reports_reassign_guard(),
  app.daily_reports_after_reassign(), app.remarks_before_write(), app.remarks_after_write(),
  app.task_assignees_before_insert(), app.task_assignees_after_insert(), app.task_list_comments_before_write()
  from public, anon, authenticated;
revoke execute on function app.can_comment_task_list(uuid) from public, anon;
grant execute on function app.can_comment_task_list(uuid) to authenticated, service_role;
revoke execute on function public.save_daily_report(jsonb), public.save_daily_row(jsonb) from public, anon;
grant execute on function public.save_daily_report(jsonb), public.save_daily_row(jsonb) to authenticated, service_role;
