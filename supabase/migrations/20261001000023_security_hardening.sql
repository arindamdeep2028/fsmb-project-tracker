-- =============================================================================
-- Migration 23 · Security hardening (audit findings SEC-3, SEC-4, SEC-5, SEC-6, SEC-14)
--
-- A. SEC-3  Role demotion ends elevated access. Heading a department needs role dept_head or admin NOW, being a
--           project PM needs role pm, dept_head or admin NOW (the helpers used by every policy check the live
--           role, not only the membership row). Changing a role also removes the rows the new role may not hold.
-- B. SEC-5  A forced password change is enforced in the database: a session whose profile still has
--           must_change_password reads and writes nothing but its own profile. Users can no longer clear the
--           flag themselves. Nothing in the database clears it either: Supabase Auth rewrites the stored hash at
--           sign-in when it re-encrypts or re-hashes (not a password change), so a trigger on auth.users cannot
--           tell a real change. The auth-admin Edge Function clears it, after it has itself stored a password
--           that it checked is different from the current one. The access token carries the flag as a routing hint.
-- C. SEC-6  Deactivated accounts lose the remaining self-scoped access (notifications, preferences, own comments,
--           own log rows, own profile update).
-- D. SEC-4  Deadline and extension changes are attributable: extension records are stamped by the database
--           (who, when, previous deadline) and a task's extended deadline can change only through such a record;
--           the audit log states previous and new values; the timestamps that drive performance scores
--           (completion, plan, assignment, last update) can no longer be rewritten by a PM or department head.
-- E. SEC-14 An attachment row must point at a file that exists in Storage, and takes its size and type from the
--           stored object, not from the caller. Uploads stop at the per-report file limit in Storage too.
--
-- No table, column or row is dropped. The only data change: none at migration time (cleanup in A runs only on
-- future role changes). Backward compatible with the app version before it.
--
-- Rollback: re-create the replaced functions and policies from migrations 10, 12, 15, 16, 18 and 19, then
--   drop trigger profiles_after_role_change on public.profiles;
--   drop trigger tasks_a_guard on public.tasks;
--   drop trigger task_extensions_before_insert on public.task_extensions;
--   drop trigger task_extensions_after_insert on public.task_extensions;
--   drop function app.session_ok(), app.profiles_after_role_change(),
--     app.tasks_guard(), app.task_extensions_before_insert(), app.task_extensions_after_insert(), app.report_has_file_room(text);
-- =============================================================================

-- =============================================================================
-- A. SEC-3 · authorization follows the current role
-- =============================================================================
create or replace function app.user_heads_department(p_uid uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_admin(p_uid)
      or exists (select 1
                   from public.department_heads dh
                   join public.profiles p on p.id = dh.user_id
                  where dh.department_id = p_dept and dh.user_id = p_uid and p.active
                    and p.role in ('dept_head', 'admin'));
$$;

create or replace function app.user_is_pm(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.project_members m
                   join public.profiles p on p.id = m.user_id
                  where m.project_id = p_project and m.user_id = p_uid
                    and m.member_role = 'pm' and m.removed_at is null and p.active
                    and p.role in ('pm', 'dept_head', 'admin'));
$$;

-- Role changed: remove what the new role may not hold (department headships; project PM roles and lead-PM
-- pointers for an engineer). Membership itself and all tasks stay. Logged once per change.
create or replace function app.profiles_after_role_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_heads int := 0; v_pm int := 0; v_lead int := 0;
begin
  if new.role is not distinct from old.role then return null; end if;
  if new.role not in ('dept_head', 'admin') then
    delete from public.department_heads where user_id = new.id;
    get diagnostics v_heads = row_count;
  end if;
  if new.role not in ('pm', 'dept_head', 'admin') then
    update public.projects set pm_id = null where pm_id = new.id;
    get diagnostics v_lead = row_count;
    update public.project_members set member_role = 'engineer' where user_id = new.id and member_role = 'pm';
    get diagnostics v_pm = row_count;
  end if;
  perform app.log_event('Edited', null, null, new.id,
    'Role changed from ' || old.role || ' to ' || new.role
      || case when v_heads + v_pm + v_lead > 0
              then ' — removed ' || v_heads || ' department headship(s), ' || v_pm || ' project PM role(s), ' || v_lead || ' lead-PM assignment(s)'
              else '' end,
    null, case when auth.uid() is null then 'system' else 'app' end, 'user');
  return null;
end $$;
revoke execute on function app.profiles_after_role_change() from public, anon, authenticated;
create trigger profiles_after_role_change after update of role on public.profiles
  for each row execute function app.profiles_after_role_change();

-- =============================================================================
-- B. SEC-5 · a forced password change is enforced in the database
-- =============================================================================
-- The caller's own account is usable: active and not waiting for a forced password change.
create or replace function app.session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and not p.must_change_password);
$$;
grant execute on function app.session_ok() to authenticated;

-- Caller wrappers used by RLS policies and triggers: every one now requires app.session_ok().
create or replace function app.current_app_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active and not p.must_change_password;
$$;
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok(); $$;
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_is_admin(auth.uid()); $$;
create or replace function app.heads_department(p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_heads_department(auth.uid(), p_dept); $$;
create or replace function app.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_is_member(auth.uid(), p_project); $$;
create or replace function app.is_project_pm(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_is_pm(auth.uid(), p_project); $$;
create or replace function app.manages_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_manages_project(auth.uid(), p_project); $$;
create or replace function app.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_can_see_project(auth.uid(), p_project); $$;
create or replace function app.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.session_ok() and app.user_can_see_task(auth.uid(), p_task); $$;

-- A department head's view of people: only while their role is still dept_head or admin (SEC-3).
create or replace function app.in_my_department(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user()
     and app.current_app_role() in ('dept_head', 'admin')
     and (exists (select 1 from public.profiles p
                    join public.department_heads dh on dh.department_id = p.department_id
                   where p.id = p_uid and dh.user_id = auth.uid())
          or exists (select 1 from public.project_members m
                       join public.projects pr on pr.id = m.project_id
                       join public.department_heads dh on dh.department_id = pr.department_id
                      where m.user_id = p_uid and m.removed_at is null and dh.user_id = auth.uid()));
$$;

-- Profiles: a user may change only their own name. must_change_password is no longer theirs to clear.
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
  if not (app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ array['full_name', 'updated_at']) then
    raise exception 'Only an admin can change role, department, login name, email, status or the password-change requirement' using errcode = '42501';
  end if;
  if not old.must_change_password and new.must_change_password then
    raise exception 'must_change_password can only be cleared by the user' using errcode = '42501';
  end if;
  return new;
end $$;

-- (No trigger on auth.users: see the header. must_change_password is written by an Admin, or by the auth-admin
--  Edge Function with the service role — set after an Admin sets someone's password, cleared after the person's
--  own verified change.)

-- My own performance: like every other read, only for a usable session.
create or replace function public.my_performance(p_from date default null, p_to date default null)
returns table (user_id uuid, full_name text, department text, assigned bigint, completed bigint, late bigint,
               on_time_pct numeric, red_events bigint, daily_updates bigint, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := coalesce(p_to, app.dhaka_today());
        v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
begin
  if auth.uid() is null or not app.session_ok() then raise exception 'Sign in required' using errcode = '42501'; end if;
  return query select * from app.performance_rows(v_from, v_to, null, auth.uid());
end $$;

-- Access token: user_role and user_active as before, plus must_change_password (routing hints only).
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}');
  v_role   public.user_role;
  v_active boolean;
  v_must   boolean;
begin
  select p.role, p.active, p.must_change_password into v_role, v_active, v_must
    from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_role::text, 'none')));
  v_claims := jsonb_set(v_claims, '{user_active}', to_jsonb(coalesce(v_active, false)));
  v_claims := jsonb_set(v_claims, '{must_change_password}', to_jsonb(coalesce(v_must, false)));
  return jsonb_set(event, '{claims}', v_claims);
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- =============================================================================
-- C. SEC-6 · deactivated (and must-change) accounts lose the remaining self-scoped access
-- =============================================================================
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()))
  with check ((id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()));

drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using ((user_id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()));
drop policy notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select app.is_active_user()))
  with check (user_id = (select auth.uid()) and (select app.is_active_user()));
drop policy notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) and (select app.is_active_user()));

drop policy prefs_read on public.notification_preferences;
create policy prefs_read on public.notification_preferences for select to authenticated
  using ((user_id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()));
drop policy prefs_insert on public.notification_preferences;
create policy prefs_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.is_active_user()));
drop policy prefs_update on public.notification_preferences;
create policy prefs_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()) and (select app.is_active_user()))
  with check (user_id = (select auth.uid()) and (select app.is_active_user()));

drop policy comments_update on public.task_comments;
create policy comments_update on public.task_comments for update to authenticated
  using ((author_id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()))
  with check ((author_id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()));

drop policy log_read on public.activity_log;
create policy log_read on public.activity_log for select to authenticated
  using ((select app.is_admin())
         or (scope = 'project' and app.manages_project(project_id))
         or ((select app.is_active_user())
             and (subject_user_id = (select auth.uid()) or actor_user_id = (select auth.uid()))));

-- =============================================================================
-- D. SEC-4 · deadline and extension changes: who, when, from what to what
-- =============================================================================
-- Extension records are written by the database, not by the caller: who granted it, when, and the deadline
-- it replaced. Only someone who manages the task's project may add one, and only for a future deadline.
create or replace function app.task_extensions_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;                -- system (import of history)
  if not app.manages_project(app.task_project(new.task_id)) then
    raise exception 'Only the project PM, the department head or an admin can grant an extension' using errcode = '42501';
  end if;
  if new.new_deadline is null or new.new_deadline <= now() then
    raise exception 'The new deadline must be in the future' using errcode = '22023';
  end if;
  new.granted_by := auth.uid();
  new.granted_at := now();
  new.source := 'app';
  select t.effective_due_at into new.previous_deadline from public.tasks t where t.id = new.task_id;
  return new;
end $$;

-- A recorded extension is applied to its task, so a record and the task's deadline cannot disagree.
create or replace function app.task_extensions_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return null; end if;
  update public.tasks set extended_deadline = new.new_deadline
   where id = new.task_id and extended_deadline is distinct from new.new_deadline;
  return null;
end $$;
revoke execute on function app.task_extensions_before_insert(), app.task_extensions_after_insert() from public, anon, authenticated;
create trigger task_extensions_before_insert before insert on public.task_extensions
  for each row execute function app.task_extensions_before_insert();
create trigger task_extensions_after_insert after insert on public.task_extensions
  for each row execute function app.task_extensions_after_insert();

-- Runs before tasks_before_write (trigger names fire in alphabetical order), so it sees exactly what the
-- caller sent. For signed-in callers:
--   everyone   an extended deadline is set only together with its extension record (above);
--   non-admin  the completion time, a plan time already set, the assignment time, the assigner and the
--              last-update stamp are written by the database only (they drive on-time % and red marks).
create or replace function app.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.extended_deadline is distinct from old.extended_deadline and new.extended_deadline is not null
     and not exists (select 1 from public.task_extensions e
                      where e.task_id = new.id and e.new_deadline = new.extended_deadline
                        and e.granted_by = auth.uid() and e.granted_at = now()) then
    raise exception 'An extended deadline is set by granting an extension' using errcode = '42501';
  end if;
  if app.is_admin() then return new; end if;
  if new.completed_on is distinct from old.completed_on and new.status is not distinct from old.status then
    raise exception 'The completion time is set by the database' using errcode = '42501';
  end if;
  if new.plan_submitted_at is distinct from old.plan_submitted_at and old.plan_submitted_at is not null then
    raise exception 'The plan submission time cannot be changed' using errcode = '42501';
  end if;
  if new.assigned_on is distinct from old.assigned_on or new.assigned_by is distinct from old.assigned_by then
    raise exception 'The assignment time and the assigner are set by the database' using errcode = '42501';
  end if;
  if (new.last_update is distinct from old.last_update or new.last_update_at is distinct from old.last_update_at
      or new.last_update_by is distinct from old.last_update_by)
     and coalesce(current_setting('app.report_item', true), '') = '' then
    raise exception 'The last-update stamp is set by the database' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function app.tasks_guard() from public, anon, authenticated;
create trigger tasks_a_guard before update on public.tasks
  for each row execute function app.tasks_guard();

-- Audit: deadline entries now state the previous and the new value; removing an extension and an admin
-- correcting a completion or plan time are logged too. (The actor and the time are on every log row.)
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

  if 'extended_deadline' = any (v_changed) then
    if new.extended_deadline is not null then
      select e.reason into v_reason from public.task_extensions e
       where e.task_id = new.id and e.new_deadline = new.extended_deadline
       order by e.granted_at desc limit 1;
      perform app.log_event('Extension granted', new.project_id, new.id, new.assigned_to,
        'Deadline extended from ' || coalesce(app.fmt_ts(old.effective_due_at), 'none') || ' to ' || app.fmt_ts(new.extended_deadline)
          || coalesce(' — ' || v_reason, ''));
    else
      perform app.log_event('Edited', new.project_id, new.id, new.assigned_to,
        'Extension removed: deadline changed from ' || app.fmt_ts(old.extended_deadline) || ' to '
          || coalesce(app.fmt_ts(new.effective_due_at), 'rule default'));
    end if;
  end if;

  if 'planned_due_at' = any (v_changed) then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to,
      'Deadline changed from ' || coalesce(app.fmt_ts(old.planned_due_at), 'rule default') || ' to '
        || coalesce(app.fmt_ts(new.planned_due_at), 'rule default'));
  end if;

  if 'completed_on' = any (v_changed) and not ('status' = any (v_changed)) then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to,
      'Completion time changed from ' || coalesce(app.fmt_ts(old.completed_on), 'none') || ' to ' || coalesce(app.fmt_ts(new.completed_on), 'none'));
  end if;
  if 'plan_submitted_at' = any (v_changed) and old.plan_submitted_at is not null then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to,
      'Plan time changed from ' || app.fmt_ts(old.plan_submitted_at) || ' to ' || coalesce(app.fmt_ts(new.plan_submitted_at), 'none'));
  end if;

  v_other := array(select unnest(v_changed) intersect
                   select unnest(array['title', 'description', 'priority', 'parent_id', 'blocker_note',
                                       'archived', 'assigned_on', 'code', 'project_id', 'contribution_locked']));
  if cardinality(v_other) > 0 then
    perform app.log_event('Edited', new.project_id, new.id, new.assigned_to, array_to_string(v_other, ', '));
  end if;
  return null;
end $$;

-- =============================================================================
-- E. SEC-14 · attachments describe a real stored file
-- =============================================================================
create or replace function app.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := auth.uid() is null or app.is_admin();
  r public.daily_reports;
  s public.workspace_settings;
  v_meta jsonb;
begin
  select * into r from public.daily_reports where id = new.report_id;
  select * into s from public.workspace_settings where id = 1;
  if not v_admin and (r.locked or r.report_date < app.dhaka_today() or r.user_id <> auth.uid()) then
    raise exception 'Files can be added only to your own open report' using errcode = '42501';
  end if;
  -- the file must already be in Storage; its real size and type replace whatever the caller claimed
  if auth.uid() is not null then
    select o.metadata into v_meta from storage.objects o
     where o.bucket_id = 'daily-report-files' and o.name = new.storage_path;
    if not found then
      raise exception 'Upload the file before attaching it' using errcode = '23514';
    end if;
    if (v_meta ->> 'size') ~ '^[0-9]{1,9}$' then new.size_bytes := (v_meta ->> 'size')::integer; end if;
    if coalesce(v_meta ->> 'mimetype', '') <> '' then new.mime_type := v_meta ->> 'mimetype'; end if;
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

-- Uploads stop at the per-report file limit in Storage itself (a file with no attachment row counts).
create or replace function app.report_has_file_room(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects o
           where o.bucket_id = 'daily-report-files'
             and o.name like app.path_uuid(p_name, 1)::text || '/' || app.path_uuid(p_name, 2)::text || '/%')
         < coalesce((select s.attachment_max_files from public.workspace_settings s where s.id = 1), 10);
$$;
grant execute on function app.report_has_file_room(text) to authenticated;

drop policy report_files_upload on storage.objects;
create policy report_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-report-files'
              and ((select app.is_admin())
                   or (app.can_upload_report_file(name) and app.report_has_file_room(name))));
