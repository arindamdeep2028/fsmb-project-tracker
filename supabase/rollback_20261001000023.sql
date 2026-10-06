-- =============================================================================
-- Rollback of migration 23 (security hardening). Restores every function and policy it replaced to the
-- definition from migrations 01-22 and drops what it added. No table, column or row is touched.
-- Generated from those migrations (scripts are not needed to run it) and verified on a local database:
-- after it, functions, triggers and policies are identical to a database built without migration 23.
--
-- Apply only if migration 23 has to be undone:
--   psql "$DATABASE_URL" -1 -f supabase/rollback_20261001000023.sql
--   supabase migration repair --status reverted 20261001000023
-- The app and the auth-admin function from the same release keep working against the rolled-back database
-- (the database-side enforcement of SEC-3, 4, 5, 6 and 14 is then off again).
-- =============================================================================
begin;

-- ---------- what migration 23 added ----------
drop trigger if exists profiles_after_role_change on public.profiles;
drop trigger if exists tasks_a_guard on public.tasks;
drop trigger if exists task_extensions_before_insert on public.task_extensions;
drop trigger if exists task_extensions_after_insert on public.task_extensions;

-- ---------- policies, as before ----------
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()))
  with check (id = (select auth.uid()) or (select app.is_admin()));   -- 20261001000015_rls_policies.sql
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));   -- 20261001000015_rls_policies.sql
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));   -- 20261001000015_rls_policies.sql
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));   -- 20261001000015_rls_policies.sql
drop policy if exists prefs_read on public.notification_preferences;
create policy prefs_read on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));   -- 20261001000015_rls_policies.sql
drop policy if exists prefs_insert on public.notification_preferences;
create policy prefs_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));   -- 20261001000015_rls_policies.sql
drop policy if exists prefs_update on public.notification_preferences;
create policy prefs_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));   -- 20261001000015_rls_policies.sql
drop policy if exists comments_update on public.task_comments;
create policy comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid()) or (select app.is_admin()))
  with check (author_id = (select auth.uid()) or (select app.is_admin()));   -- 20261001000019_final_decisions.sql
drop policy if exists log_read on public.activity_log;
create policy log_read on public.activity_log for select to authenticated
  using ((select app.is_admin())
         or (scope = 'project' and app.manages_project(project_id))
         or subject_user_id = (select auth.uid())
         or actor_user_id = (select auth.uid()));   -- 20261001000015_rls_policies.sql
drop policy if exists report_files_upload on storage.objects;
create policy report_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-report-files'
              and ((select app.is_admin()) or app.can_upload_report_file(name)));   -- 20261001000018_storage.sql

-- ---------- functions, as before ----------
-- from 20261001000010_access_helpers.sql
create or replace function app.user_heads_department(p_uid uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_admin(p_uid)
      or exists (select 1
                   from public.department_heads dh
                   join public.profiles p on p.id = dh.user_id
                  where dh.department_id = p_dept and dh.user_id = p_uid and p.active);
$$;

-- from 20261001000010_access_helpers.sql
create or replace function app.user_is_pm(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.project_members m
                   join public.profiles p on p.id = m.user_id
                  where m.project_id = p_project and m.user_id = p_uid
                    and m.member_role = 'pm' and m.removed_at is null and p.active);
$$;

-- from 20261001000010_access_helpers.sql
create or replace function app.current_app_role() returns public.user_role                 -- (3)
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active;
$$;

-- from 20261001000010_access_helpers.sql
create or replace function app.is_active_user() returns boolean                             -- (4)
language sql stable security definer set search_path = '' as $$ select app.user_is_active(auth.uid()); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.is_admin() returns boolean                                   -- (5)
language sql stable security definer set search_path = '' as $$ select app.user_is_admin(auth.uid()); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.heads_department(p_dept uuid) returns boolean                 -- (6)
language sql stable security definer set search_path = '' as $$ select app.user_heads_department(auth.uid(), p_dept); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.is_project_member(p_project uuid) returns boolean             -- (7)
language sql stable security definer set search_path = '' as $$ select app.user_is_member(auth.uid(), p_project); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.is_project_pm(p_project uuid) returns boolean                 -- (8)
language sql stable security definer set search_path = '' as $$ select app.user_is_pm(auth.uid(), p_project); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.manages_project(p_project uuid) returns boolean               -- (9)
language sql stable security definer set search_path = '' as $$ select app.user_manages_project(auth.uid(), p_project); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.can_see_project(p_project uuid) returns boolean               -- (10)
language sql stable security definer set search_path = '' as $$ select app.user_can_see_project(auth.uid(), p_project); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.can_see_task(p_task uuid) returns boolean                     -- (11)
language sql stable security definer set search_path = '' as $$ select app.user_can_see_task(auth.uid(), p_task); $$;

-- from 20261001000010_access_helpers.sql
create or replace function app.in_my_department(p_uid uuid) returns boolean                  -- (14)
language sql stable security definer set search_path = '' as $$
  select app.is_active_user()
     and (exists (select 1 from public.profiles p
                    join public.department_heads dh on dh.department_id = p.department_id
                   where p.id = p_uid and dh.user_id = auth.uid())
          or exists (select 1 from public.project_members m
                       join public.projects pr on pr.id = m.project_id
                       join public.department_heads dh on dh.department_id = pr.department_id
                      where m.user_id = p_uid and m.removed_at is null and dh.user_id = auth.uid()));
$$;

-- from 20261001000012_triggers.sql
create or replace function app.profiles_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or app.is_admin() then
    if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
       and not exists (select 1 from public.profiles p where p.role = 'admin' and p.active and p.id <> old.id) then
      raise exception 'At least one active admin is required' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_uid <> old.id then
    raise exception 'You can only change your own profile' using errcode = '42501';
  end if;
  if not (app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ array['full_name', 'must_change_password', 'updated_at']) then
    raise exception 'Only an admin can change role, department, login name, email or status' using errcode = '42501';
  end if;
  if not old.must_change_password and new.must_change_password then
    raise exception 'must_change_password can only be cleared by the user' using errcode = '42501';
  end if;
  return new;
end $$;

-- from 20261001000016_grants_auth.sql
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}');
  v_role   public.user_role;
  v_active boolean;
begin
  select p.role, p.active into v_role, v_active from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_role::text, 'none')));
  v_claims := jsonb_set(v_claims, '{user_active}', to_jsonb(coalesce(v_active, false)));
  return jsonb_set(event, '{claims}', v_claims);
end $$;

-- from 20261001000014_rpc_jobs.sql
create or replace function public.my_performance(p_from date default null, p_to date default null)
returns table (user_id uuid, full_name text, department text, assigned bigint, completed bigint, late bigint,
               on_time_pct numeric, red_events bigint, daily_updates bigint, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := coalesce(p_to, app.dhaka_today());
        v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  return query select * from app.performance_rows(v_from, v_to, null, auth.uid());
end $$;

-- from 20261001000019_final_decisions.sql
create or replace function app.tasks_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_changed  text[];
  v_other    text[];
  v_source   text := case when auth.uid() is null then 'system' else 'app' end;
  v_reason   text;
  r          record;
begin
  if tg_op = 'INSERT' then
    perform app.log_event('Task created', new.project_id, new.id, new.assigned_to, new.code || ' ' || new.title, null, v_source);
    perform app.log_event('Assigned', new.project_id, new.id, new.assigned_to,
      'by ' || coalesce((select p.full_name from public.profiles p where p.id = new.assigned_by), '—'), null, v_source);
    perform app.notify(new.assigned_to, 'task_assigned', 'New task: ' || new.code, new.title, new.project_id, new.id);
    return null;
  end if;

  v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
  if v_changed <@ array['subtask_seq', 'updated_at', 'clock_start_at', 'plan_due_at', 'exec_due_at', 'effective_due_at'] then
    return null;                                                       -- counters and deadline sweeps
  end if;

  if 'assigned_to' = any (v_changed) then
    perform app.log_event('Assigned', new.project_id, new.id, new.assigned_to,
      'reassigned by ' || coalesce((select p.full_name from public.profiles p where p.id = v_uid), 'system'));
    perform app.notify(new.assigned_to, 'task_assigned', 'Task assigned to you: ' || new.code, new.title, new.project_id, new.id);
  end if;

  if old.plan_submitted_at is null and new.plan_submitted_at is not null then
    perform app.log_event('Plan submitted', new.project_id, new.id, new.assigned_to);
  end if;

  if 'status' = any (v_changed) then
    if new.status = 'Completed' then
      perform app.log_event('Completed', new.project_id, new.id, new.assigned_to,
        case when new.completed_on > new.effective_due_at then 'late' else 'on time' end);
    else
      perform app.log_event('Status change', new.project_id, new.id, new.assigned_to, old.status || ' → ' || new.status);
    end if;
    -- v2 §9: only when someone other than the assignee changes the status, or on completion
    for r in
      select distinct u from (
        select new.assigned_to as u
        union select new.created_by
        union select m.user_id from public.project_members m
               where m.project_id = new.project_id and m.member_role = 'pm' and m.removed_at is null) x
       where u is not null and u is distinct from v_uid
         and (v_uid is distinct from new.assigned_to or new.status = 'Completed')
    loop
      perform app.notify(r.u, 'status_changed', new.code || ' is now ' || new.status, new.title, new.project_id, new.id);
    end loop;
  end if;

  if v_changed && array['progress_pct', 'contribution_pct'] then
    insert into public.task_contributions (task_id, user_id, progress_before, progress_after,
                                           contribution_before, contribution_after, daily_report_item_id)
    values (new.id, v_uid,
            old.progress_pct, new.progress_pct,
            case when 'contribution_pct' = any (v_changed) then old.contribution_pct end,
            case when 'contribution_pct' = any (v_changed) then new.contribution_pct end,
            nullif(current_setting('app.report_item', true), '')::uuid);
    if 'progress_pct' = any (v_changed) then
      perform app.log_event('Progress updated', new.project_id, new.id, new.assigned_to,
        old.progress_pct || '% → ' || new.progress_pct || '%');
    end if;
    if 'contribution_pct' = any (v_changed) then
      perform app.log_event('Contribution changed', new.project_id, new.id, new.assigned_to,
        coalesce(old.contribution_pct::text, 'auto') || '% → ' || coalesce(new.contribution_pct::text, 'auto') || '%');
    end if;
  end if;

  if 'extended_deadline' = any (v_changed) and new.extended_deadline is not null then
    select e.reason into v_reason from public.task_extensions e
     where e.task_id = new.id and e.new_deadline = new.extended_deadline
     order by e.granted_at desc limit 1;
    perform app.log_event('Extension granted', new.project_id, new.id, new.assigned_to,
      'until ' || app.fmt_ts(new.extended_deadline) || coalesce(' — ' || v_reason, ''));
  end if;

  if 'planned_due_at' = any (v_changed) then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to,
      'Deadline set to ' || coalesce(app.fmt_ts(new.planned_due_at), 'rule default'));
  end if;

  v_other := array(select unnest(v_changed) intersect
                   select unnest(array['title', 'description', 'priority', 'parent_id', 'blocker_note',
                                       'archived', 'assigned_on', 'code', 'project_id', 'contribution_locked']));
  if cardinality(v_other) > 0 then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to, array_to_string(v_other, ', '));
  end if;
  return null;
end $$;

-- from 20261001000012_triggers.sql
create or replace function app.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := auth.uid() is null or app.is_admin();
  r public.daily_reports;
  s public.workspace_settings;
begin
  select * into r from public.daily_reports where id = new.report_id;
  select * into s from public.workspace_settings where id = 1;
  if not v_admin and (r.locked or r.report_date < app.dhaka_today() or r.user_id <> auth.uid()) then
    raise exception 'Files can be added only to your own open report' using errcode = '42501';
  end if;
  if (select count(*) from public.daily_report_attachments a where a.report_id = new.report_id) >= s.attachment_max_files then
    raise exception 'This report already has % files (the maximum)', s.attachment_max_files using errcode = '23514';
  end if;
  if new.size_bytes > s.attachment_max_mb * 1048576 then
    raise exception 'Files are limited to % MB', s.attachment_max_mb using errcode = '23514';
  end if;
  if split_part(new.storage_path, '/', 1) <> r.project_id::text or split_part(new.storage_path, '/', 2) <> r.id::text then
    raise exception 'The file path must start with project_id/report_id/' using errcode = '23514';
  end if;
  if auth.uid() is not null then new.uploaded_by := auth.uid(); end if;
  new.uploaded_at := now();
  return new;
end $$;

-- grants on the token hook, as migration 16 left them
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------- functions migration 23 added (after the policies and functions that used them are restored) ----------
drop function if exists app.profiles_after_role_change();
drop function if exists app.tasks_guard();
drop function if exists app.task_extensions_before_insert();
drop function if exists app.task_extensions_after_insert();
drop function if exists app.report_has_file_room(text);
drop function if exists app.session_ok();

commit;
