-- =============================================================================
-- Migration 12 · Trigger functions and triggers (Implementation Blueprint §7: 20 functions, 24 triggers)
--
-- BEFORE triggers validate and fill values (field guard, codes, deadlines, timestamps).
-- AFTER triggers write side records (audit log, progress history, notifications) as SECURITY DEFINER,
-- because users have no insert rights on those tables.
-- auth.uid() is null for the service role, pg_cron jobs and seeds → "system" context.
-- =============================================================================

-- ---------- small utilities ---------------------------------------------------------
create or replace function app.changed_columns(p_old jsonb, p_new jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_new) k where p_new -> k is distinct from p_old -> k;
$$;

create or replace function app.fmt_ts(p_ts timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select to_char(p_ts at time zone app.tz(), 'DD-Mon HH24:MI');
$$;

-- (1) New auth user → profile + default notification preferences.
-- Role and department come ONLY from raw_app_meta_data (settable by the service role, not by users).
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_appm  jsonb := coalesce(new.raw_app_meta_data, '{}');
  v_name  text;
  v_login text;
  v_role  public.user_role := 'engineer';
  v_dept  uuid;
begin
  v_name  := coalesce(nullif(v_meta ->> 'full_name', ''), split_part(new.email, '@', 1), 'User');
  v_login := lower(coalesce(nullif(v_meta ->> 'login_name', ''), split_part(new.email, '@', 1), new.id::text));
  if v_appm ? 'role' then
    begin v_role := (v_appm ->> 'role')::public.user_role;
    exception when invalid_text_representation then v_role := 'engineer'; end;
  end if;
  if (v_appm ->> 'department_id') ~* '^[0-9a-f-]{36}$' then v_dept := (v_appm ->> 'department_id')::uuid; end if;
  if exists (select 1 from public.profiles p where p.login_name = v_login::extensions.citext) then
    v_login := v_login || '-' || substr(new.id::text, 1, 4);
  end if;
  insert into public.profiles (id, full_name, login_name, email, department_id, role, must_change_password, legacy_name)
  values (new.id, v_name, v_login, new.email, v_dept, v_role,
          coalesce((v_appm ->> 'must_change_password')::boolean, true), nullif(v_meta ->> 'legacy_name', ''));
  insert into public.notification_preferences (user_id, type, in_app, email)
  select new.id, t, true, t in ('task_assigned', 'task_overdue', 'pm_comment')
    from unnest(enum_range(null::public.notification_type)) t;
  perform app.log_event('User added', null, null, new.id, v_name, null, 'system', 'user');
  return new;
end $$;

-- (2) updated_at (and updated_by on workspace_settings)
create or replace function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name = 'workspace_settings' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

-- (3) Profiles: users may change only their own name and clear must_change_password
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

-- (4) Department heads must have role dept_head or admin
create or replace function app.department_heads_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.role in ('dept_head', 'admin')) then
    raise exception 'A department head must have role dept_head or admin' using errcode = '23514';
  end if;
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  return new;
end $$;

-- (5) Projects: who may create, and which fields each role may change
create or replace function app.projects_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      if not (app.is_admin() or app.heads_department(new.department_id)) then
        raise exception 'Only an admin or the head of this department can create a project here' using errcode = '42501';
      end if;
      new.created_by := v_uid;
      new.task_seq   := 0;
    end if;
    if new.archived then new.archived_at := coalesce(new.archived_at, now()); new.archived_by := coalesce(new.archived_by, v_uid); end if;
    return new;
  end if;

  v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
  if v_changed <@ array['task_seq', 'updated_at'] then return new; end if;     -- task-code counter

  if v_uid is not null and not app.is_admin() then
    if 'task_seq' = any (v_changed) then
      raise exception 'task_seq is managed by the database' using errcode = '42501';
    end if;
    if app.heads_department(old.department_id) then
      if new.department_id <> old.department_id and not app.heads_department(new.department_id) then
        raise exception 'You can only move a project into a department you head' using errcode = '42501';
      end if;
      if v_changed && array['is_demo', 'legacy_sheet_name', 'created_by', 'created_at'] then
        raise exception 'Only an admin can change these project fields' using errcode = '42501';
      end if;
    elsif v_changed && array['code', 'department_id', 'pm_id', 'archived', 'archived_at', 'archived_by',
                             'is_demo', 'legacy_sheet_name', 'created_by', 'created_at'] then
      raise exception 'A PM can edit project details only; code, department, PM and archive need the department head or an admin'
        using errcode = '42501';
    end if;
  end if;

  if new.archived and not old.archived then
    new.archived_at := now(); new.archived_by := v_uid;
  elsif not new.archived and old.archived then
    new.archived_at := null; new.archived_by := null;
  end if;
  return new;
end $$;

-- (6) Projects after write: lead PM membership, archive cascade, audit
create or replace function app.projects_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_changed text[];
begin
  if new.pm_id is not null and (tg_op = 'INSERT' or new.pm_id is distinct from old.pm_id) then
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (new.id, new.pm_id, 'pm', auth.uid())
    on conflict (project_id, user_id) do update set member_role = 'pm', removed_at = null, removed_by = null;
  end if;

  if tg_op = 'INSERT' then
    perform app.log_event('Project created', new.id, null, null, new.code || ' ' || new.name);
    return null;
  end if;

  v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
  if v_changed <@ array['task_seq', 'updated_at'] then return null; end if;

  if new.archived and not old.archived then
    update public.tasks set archived = true where project_id = new.id and not archived;
  end if;
  perform app.log_event('Edited', new.id, null, null,
    'Project: ' || array_to_string(array(select unnest(v_changed) except select unnest(array['updated_at', 'archived_at', 'archived_by', 'task_seq'])), ', '));
  return null;
end $$;

-- (7) Project members: role compatibility, who may manage which rows, safe removal
create or replace function app.project_members_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_head    boolean;
  v_role    public.user_role;
begin
  v_head := v_uid is null or app.is_admin()
            or exists (select 1 from public.projects p where p.id = new.project_id and app.heads_department(p.department_id));
  select p.role into v_role from public.profiles p where p.id = new.user_id;

  if new.member_role = 'pm' and v_role not in ('pm', 'dept_head', 'admin') then
    raise exception 'Only users with role pm, dept_head or admin can be a project PM' using errcode = '23514';
  end if;
  if new.member_role = 'engineer' and v_role not in ('engineer', 'pm') then
    raise exception 'Only users with role engineer or pm can be an engineer member' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not v_head and new.member_role = 'pm' then
      raise exception 'Only an admin or the department head can add a PM' using errcode = '42501';
    end if;
    new.added_by := coalesce(v_uid, new.added_by); new.added_at := now();
    new.removed_at := null; new.removed_by := null;
    return new;
  end if;

  if new.project_id <> old.project_id or new.user_id <> old.user_id then
    raise exception 'Membership keys cannot change' using errcode = '42501';
  end if;
  if not v_head and (new.member_role <> old.member_role or old.member_role = 'pm') then
    raise exception 'A PM can manage engineer memberships only' using errcode = '42501';
  end if;

  if old.removed_at is null and new.removed_at is not null then
    if exists (select 1 from public.tasks t where t.project_id = old.project_id and t.assigned_to = old.user_id
                  and t.status <> 'Completed' and not t.archived) then
      raise exception 'Reassign this member''s open tasks before removing them' using errcode = '23514';
    end if;
    if exists (select 1 from public.projects p where p.id = old.project_id and p.pm_id = old.user_id) then
      raise exception 'Change the project''s lead PM before removing them' using errcode = '23514';
    end if;
    new.removed_at := now(); new.removed_by := v_uid;
  elsif old.removed_at is not null and new.removed_at is null then
    new.added_at := now(); new.added_by := coalesce(v_uid, new.added_by); new.removed_by := null;
  end if;
  return new;
end $$;

-- (8) Project members after write: audit
create or replace function app.project_members_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (old.removed_at is not null and new.removed_at is null) then
    perform app.log_event('Member added', new.project_id, null, new.user_id, new.member_role::text);
  elsif old.removed_at is null and new.removed_at is not null then
    perform app.log_event('Member removed', new.project_id, null, new.user_id, old.member_role::text);
  elsif new.member_role <> old.member_role then
    perform app.log_event('Edited', new.project_id, null, new.user_id, 'Project role ' || old.member_role || ' → ' || new.member_role);
  end if;
  return null;
end $$;

-- (9) Tasks before write: field guard, codes, parent/assignee rules, status, deadlines, update stamp
create or replace function app.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_system   boolean := auth.uid() is null;
  v_manager  boolean;
  v_admin    boolean;
  v_changed  text[] := '{}';
  v_allowed  text[];
  v_parent   public.tasks;
  d          record;
begin
  v_admin   := v_system or app.is_admin();
  v_manager := v_system or app.manages_project(coalesce(new.project_id, old.project_id));

  if tg_op = 'UPDATE' then
    v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
    -- deadline sweep after a rules change (app.recompute_open_deadlines)
    if v_changed <@ array['updated_at'] and current_setting('app.recompute_deadlines', true) = 'on' then
      select * into d from app.compute_deadlines(new.assigned_on, new.extended_deadline, new.planned_due_at);
      new.clock_start_at := d.clock_start_at; new.plan_due_at := d.plan_due_at;
      new.exec_due_at := d.exec_due_at;       new.effective_due_at := d.effective_due_at;
      return new;
    end if;
    -- subtask-code counter bumps are internal
    if v_changed <@ array['subtask_seq', 'updated_at'] then return new; end if;
  end if;

  ------------------------------------------------------------------ INSERT
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select * into v_parent from public.tasks where id = new.parent_id;
      if not found or v_parent.project_id <> new.project_id then
        raise exception 'A subtask must belong to a task in the same project' using errcode = '23514';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'Subtasks cannot have subtasks (two levels only)' using errcode = '23514';
      end if;
      if not v_system and not app.can_see_task(new.parent_id) then
        raise exception 'You cannot add a subtask to a task you cannot see' using errcode = '42501';
      end if;
      new.type := 'Subtask';
    else
      new.type := 'Task';
    end if;

    if not v_manager then
      -- Engineer creating a task (v2 final rule): any task in a project where they are a member,
      -- assigned to themselves or an engineer member; no deadlines, no approval step.
      if not app.is_project_member(new.project_id) then
        raise exception 'You are not a member of this project' using errcode = '42501';
      end if;
      new.created_by := v_uid;          new.assigned_by := v_uid;       new.assigned_on := now();
      new.status := 'Not started';      new.plan_submitted_at := null;  new.progress_pct := 0;
      new.completed_on := null;         new.planned_due_at := null;     new.extended_deadline := null;
      new.extended_by := null;          new.contribution_locked := false;
      new.archived := false;            new.archived_at := null;        new.archived_by := null;
      new.last_update := null;          new.last_update_at := null;     new.last_update_by := null;
      new.legacy_row := null;           new.code := null;
      new.assigned_to := coalesce(new.assigned_to, v_uid);
      if new.assigned_to <> v_uid and not app.is_engineer_member(new.project_id, new.assigned_to) then
        raise exception 'Engineers can assign tasks only to themselves or to an engineer member of this project'
          using errcode = '42501';
      end if;
    elsif not v_system then
      new.created_by  := v_uid;
      new.assigned_by := coalesce(new.assigned_by, v_uid);
      if not v_admin then new.code := null; end if;           -- only admins choose codes
    end if;
    new.created_by := coalesce(new.created_by, new.assigned_by);

    if not app.user_is_member(new.assigned_to, new.project_id) then
      raise exception 'The assignee must be a current member of the project' using errcode = '23514';
    end if;

    new.subtask_seq := 0;
    if new.code is null then
      new.code := app.next_task_code(new.project_id, new.parent_id);
    elsif new.parent_id is null then                          -- imported / admin code: keep counter ahead
      update public.projects set task_seq = greatest(task_seq, coalesce(substring(new.code from '-T(\d+)$')::int, 0))
       where id = new.project_id;
    elsif right(new.code, 1) ~ '^[a-z]$' then
      update public.tasks set subtask_seq = greatest(subtask_seq, ascii(right(new.code, 1)) - 96)
       where id = new.parent_id;
    end if;

  ------------------------------------------------------------------ UPDATE
  else
    if not v_system then
      if v_changed && array['clock_start_at', 'plan_due_at', 'exec_due_at', 'effective_due_at',
                            'created_by', 'created_at', 'subtask_seq', 'legacy_row'] then
        raise exception 'Calculated and system columns cannot be written directly' using errcode = '42501';
      end if;
      if v_changed && array['code', 'project_id'] and not v_admin then
        raise exception 'Only an admin can change a task code or move a task to another project' using errcode = '42501';
      end if;
    end if;

    if not v_manager then
      ---------------- Engineer field guard (v2 §11) ----------------
      if old.assigned_to = v_uid then
        v_allowed := array['status', 'progress_pct', 'priority', 'blocker_note', 'plan_submitted_at',
                           'completed_on', 'last_update', 'last_update_at', 'last_update_by', 'updated_at'];
        if not old.contribution_locked then v_allowed := v_allowed || 'contribution_pct'::text; end if;
        if old.created_by = v_uid and old.status = 'Not started' then
          v_allowed := v_allowed || array['title', 'description', 'assigned_to'];
        end if;
      elsif old.created_by = v_uid and old.status = 'Not started' then
        v_allowed := array['title', 'description', 'assigned_to', 'updated_at'];
        if not old.contribution_locked then v_allowed := v_allowed || 'contribution_pct'::text; end if;
      else
        raise exception 'You can only update tasks assigned to you or created by you' using errcode = '42501';
      end if;

      if not (v_changed <@ v_allowed) then
        raise exception 'Engineers cannot change: %',
          array_to_string(array(select unnest(v_changed) except select unnest(v_allowed)), ', ')
          using errcode = '42501';
      end if;

      if 'status' = any (v_changed) then
        if not (new.status = any (case old.status
               when 'Not started'    then array['Plan submitted', 'In progress', 'Blocked', 'Completed']::public.task_status[]
               when 'Plan submitted' then array['In progress', 'Blocked', 'Completed']::public.task_status[]
               when 'In progress'    then array['Blocked', 'Completed']::public.task_status[]
               when 'Blocked'        then array['In progress', 'Completed']::public.task_status[]
               else '{}'::public.task_status[] end)) then
          raise exception 'Changing status from % to % needs a PM, department head or admin', old.status, new.status
            using errcode = '42501';
        end if;
        if new.status = 'Completed' and exists (select 1 from public.tasks c where c.parent_id = old.id
                                                   and not c.archived and c.status <> 'Completed') then
          raise exception 'Only a manager can complete a task that still has open subtasks' using errcode = '42501';
        end if;
      end if;
      if 'plan_submitted_at' = any (v_changed) and (old.plan_submitted_at is not null or new.plan_submitted_at is null) then
        raise exception 'The plan submission time cannot be changed' using errcode = '42501';
      end if;
      if 'completed_on' = any (v_changed) and not ('status' = any (v_changed)) then
        raise exception 'The completion time is set by the database' using errcode = '42501';
      end if;
      if 'assigned_to' = any (v_changed) and new.assigned_to <> v_uid
         and not app.is_engineer_member(new.project_id, new.assigned_to) then
        raise exception 'Engineers can reassign only to themselves or an engineer member of this project' using errcode = '42501';
      end if;
    elsif 'assigned_to' = any (v_changed) and not app.user_is_member(new.assigned_to, new.project_id) then
      raise exception 'The assignee must be a current member of the project' using errcode = '23514';
    end if;

    -- parent change (managers only reach here with it)
    if 'parent_id' = any (v_changed) then
      if new.parent_id is not null then
        select * into v_parent from public.tasks where id = new.parent_id;
        if not found or v_parent.project_id <> new.project_id or v_parent.parent_id is not null
           or exists (select 1 from public.tasks c where c.parent_id = old.id) then
          raise exception 'Invalid parent: it must be a top-level task in the same project, and this task must have no subtasks'
            using errcode = '23514';
        end if;
        new.type := 'Subtask';
      else
        new.type := 'Task';
      end if;
    end if;

    if 'progress_pct' = any (v_changed) and new.status <> 'Completed'
       and exists (select 1 from public.tasks c where c.parent_id = old.id and not c.archived) then
      raise exception 'Progress of a task with subtasks is calculated from its subtasks' using errcode = '23514';
    end if;
  end if;

  ------------------------------------------------------------------ common rules
  if new.status = 'Completed' then
    if tg_op = 'INSERT' or old.status <> 'Completed' then
      if not v_system or new.completed_on is null then new.completed_on := now(); end if;
    end if;
    new.progress_pct := 100;
  else
    new.completed_on := null;
  end if;

  if new.status = 'Plan submitted' and new.plan_submitted_at is null then new.plan_submitted_at := now(); end if;
  if not v_admin and new.plan_submitted_at is not null
     and (tg_op = 'INSERT' or old.plan_submitted_at is null) then
    new.plan_submitted_at := now();                               -- no back-dating except by admin/system
  end if;

  if tg_op = 'UPDATE' and new.extended_deadline is distinct from old.extended_deadline then
    new.extended_by := case when new.extended_deadline is null then null else coalesce(v_uid, new.extended_by) end;
  end if;

  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := coalesce(new.archived_at, now()); new.archived_by := coalesce(new.archived_by, v_uid);
  elsif not new.archived then
    new.archived_at := null; new.archived_by := null;
  end if;

  if tg_op = 'INSERT'
     or new.assigned_on       is distinct from old.assigned_on
     or new.extended_deadline is distinct from old.extended_deadline
     or new.planned_due_at    is distinct from old.planned_due_at then
    select * into d from app.compute_deadlines(new.assigned_on, new.extended_deadline, new.planned_due_at);
    new.clock_start_at := d.clock_start_at; new.plan_due_at := d.plan_due_at;
    new.exec_due_at := d.exec_due_at;       new.effective_due_at := d.effective_due_at;
  else
    new.clock_start_at := old.clock_start_at; new.plan_due_at := old.plan_due_at;
    new.exec_due_at := old.exec_due_at;       new.effective_due_at := old.effective_due_at;
  end if;

  -- daily-update stamp: any work update by the assignee counts
  if tg_op = 'UPDATE' and not v_system and v_uid = new.assigned_to
     and v_changed && array['status', 'progress_pct', 'priority', 'blocker_note', 'contribution_pct',
                            'plan_submitted_at', 'title', 'description', 'last_update'] then
    new.last_update := app.dhaka_today(); new.last_update_at := now(); new.last_update_by := v_uid;
  end if;
  return new;
end $$;

-- (10) Tasks after write: audit, progress history, notifications
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
    for r in
      select distinct u from (
        select new.assigned_to as u
        union select new.created_by
        union select m.user_id from public.project_members m
               where m.project_id = new.project_id and m.member_role = 'pm' and m.removed_at is null) x
       where u is not null and u is distinct from v_uid
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

-- (11) Comments before write
create or replace function app.task_comments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
    new.is_manager_comment := app.user_manages_project(new.author_id, app.task_project(new.task_id));
    new.created_at := now(); new.edited_at := null; new.deleted_at := null;
    if new.parent_comment_id is not null and not exists
       (select 1 from public.task_comments c where c.id = new.parent_comment_id and c.task_id = new.task_id) then
      raise exception 'A reply must belong to the same task' using errcode = '23514';
    end if;
    return new;
  end if;
  if not (app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ array['body', 'deleted_at', 'edited_at']) then
    raise exception 'Only the text of a comment can change' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'A deleted comment cannot be edited' using errcode = '42501';
  end if;
  if new.body is distinct from old.body then new.edited_at := now(); end if;
  if new.deleted_at is not null then new.deleted_at := now(); end if;
  return new;
end $$;

-- (12) Comments after insert: audit + PM comment notification
create or replace function app.task_comments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; r record;
begin
  select * into t from public.tasks where id = new.task_id;
  perform app.log_event('Comment', t.project_id, t.id, t.assigned_to, left(new.body, 200));
  if new.is_manager_comment then
    for r in select distinct u from (select t.assigned_to as u union select t.created_by) x
              where u is not null and u <> new.author_id loop
      perform app.notify(r.u, 'pm_comment', 'Comment on ' || t.code, left(new.body, 300), t.project_id, t.id);
    end loop;
  end if;
  return null;
end $$;

-- (13) Daily reports before write: author, date, day name, membership, lock
create or replace function app.daily_reports_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean := auth.uid() is null or app.is_admin();
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not app.is_admin() then new.user_id := auth.uid(); end if;
    new.report_date := coalesce(new.report_date, app.dhaka_today());
    if not v_admin and new.report_date <> app.dhaka_today() then
      raise exception 'Daily reports can be submitted for today only' using errcode = '42501';
    end if;
    if not v_admin and not app.user_is_member(new.user_id, new.project_id) then
      raise exception 'You can only report on projects where you are a member' using errcode = '42501';
    end if;
    new.locked := false; new.submitted_at := now();
  else
    if not v_admin then
      if old.locked or old.report_date < app.dhaka_today() then
        raise exception 'This report is locked' using errcode = '42501';
      end if;
      if new.user_id <> old.user_id or new.project_id <> old.project_id
         or new.report_date <> old.report_date or new.locked <> old.locked then
        raise exception 'Only the report text can change' using errcode = '42501';
      end if;
    end if;
    new.submitted_at := old.submitted_at;
  end if;
  new.day_name := trim(to_char(new.report_date, 'FMDay'));
  if new.next_task_id is not null and not exists
     (select 1 from public.tasks t where t.id = new.next_task_id and t.project_id = new.project_id) then
    raise exception 'The next task must belong to the same project' using errcode = '23514';
  end if;
  return new;
end $$;

-- (14) Daily reports after insert: audit
create or replace function app.daily_reports_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.log_event('Daily report submitted', new.project_id, null, new.user_id,
    new.day_name || ' ' || to_char(new.report_date, 'DD-Mon-YYYY'));
  return null;
end $$;

-- (15) Report items before write: only the author's own tasks, snapshots, lock
create or replace function app.daily_report_items_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := auth.uid() is null or app.is_admin();
  r public.daily_reports;
  t public.tasks;
begin
  select * into r from public.daily_reports where id = coalesce(new.report_id, old.report_id);
  if not v_admin and (r.locked or r.report_date < app.dhaka_today() or r.user_id <> auth.uid()) then
    raise exception 'This report is locked or is not yours' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.report_id <> old.report_id or new.task_id <> old.task_id) then
    raise exception 'Report and task of an item cannot change' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = new.task_id;
  if not found or t.project_id <> r.project_id or t.archived then
    raise exception 'The task must be an active task of the report''s project' using errcode = '23514';
  end if;
  if t.assigned_to <> r.user_id then
    raise exception 'Only your own tasks and subtasks can be listed in your daily report' using errcode = '42501';
  end if;
  new.task_code := t.code; new.task_title := t.title; new.parent_task_id := t.parent_id;
  return new;
end $$;

-- (16) Report items after write: apply progress/status as the author, stamp daily update, audit once per day
create or replace function app.daily_report_items_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.daily_reports;
begin
  select * into r from public.daily_reports where id = new.report_id;
  perform set_config('app.report_item', new.id::text, true);
  update public.tasks t
     set progress_pct = case when new.progress_after is not null
                              and not exists (select 1 from public.tasks c where c.parent_id = t.id and not c.archived)
                             then new.progress_after else t.progress_pct end,
         status       = coalesce(new.status_after, t.status),
         last_update  = greatest(coalesce(t.last_update, r.report_date), r.report_date)
   where t.id = new.task_id;
  perform set_config('app.report_item', '', true);
  if not exists (select 1 from public.activity_log l where l.action = 'Daily update'
                    and l.task_id = new.task_id and l.log_date = r.report_date) then
    perform app.log_event('Daily update', r.project_id, new.task_id, r.user_id,
      'Daily report ' || to_char(r.report_date, 'DD-Mon'));
  end if;
  return null;
end $$;

-- (17) Attachments before insert: own open report, file count, size, path
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

-- (18) Rules changed → recalculate open deadlines
create or replace function app.workspace_settings_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.office_start, new.office_end, new.plan_hours, new.exec_days, new.workdays, new.timezone)
     is distinct from (old.office_start, old.office_end, old.plan_hours, old.exec_days, old.workdays, old.timezone) then
    perform app.recompute_open_deadlines();
    perform app.log_event('Edited', null, null, null, 'Execution rules changed', null, 'system', 'system');
  end if;
  return null;
end $$;

-- (19) Audit rows: snapshots and scope
create or replace function app.activity_log_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_pid uuid;
begin
  if new.subject_user_id is not null and new.subject_name is null then
    select p.full_name into new.subject_name from public.profiles p where p.id = new.subject_user_id;
  end if;
  if new.task_id is not null then
    select t.code, t.project_id into v_code, v_pid from public.tasks t where t.id = new.task_id;
    new.task_code  := coalesce(new.task_code, v_code);
    new.project_id := coalesce(new.project_id, v_pid);
  end if;
  if new.project_id is not null and new.project_code is null then
    select pr.code into new.project_code from public.projects pr where pr.id = new.project_id;
  end if;
  new.scope := coalesce(new.scope, case when new.project_id is not null then 'project'::public.log_scope
                                        when new.subject_user_id is not null then 'user'::public.log_scope
                                        else 'system'::public.log_scope end);
  new.actor_user_id := coalesce(new.actor_user_id, auth.uid());
  return new;
end $$;

-- (20) Notifications: recipient checks, preferences; users may only mark read
create or replace function app.notifications_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_in boolean; v_email boolean;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not (app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ array['read_at']) then
      raise exception 'Only the read status of a notification can change' using errcode = '42501';
    end if;
    return new;
  end if;
  new.actor_id := coalesce(new.actor_id, auth.uid());
  if new.user_id is not distinct from new.actor_id or not app.user_is_active(new.user_id) then return null; end if;
  if new.task_id is not null and not app.user_can_see_task(new.user_id, new.task_id) then return null; end if;
  if new.task_id is null and new.project_id is not null and not app.user_can_see_project(new.user_id, new.project_id) then
    return null;
  end if;
  select np.in_app, np.email into v_in, v_email
    from public.notification_preferences np where np.user_id = new.user_id and np.type = new.type;
  if not found then
    v_in := true; v_email := new.type in ('task_assigned', 'task_overdue', 'pm_comment');
  end if;
  if not v_in and not v_email then return null; end if;
  new.email_wanted := v_email; new.created_at := now(); new.read_at := null; new.emailed_at := null;
  return new;
end $$;

-- ---------- Trigger bindings (24) ----------------------------------------------------
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create trigger set_updated_at before update on public.workspace_settings for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.profiles           for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.projects           for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.tasks              for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.daily_reports      for each row execute function app.set_updated_at();

create trigger profiles_before_update          before update on public.profiles
  for each row execute function app.profiles_before_update();
create trigger department_heads_before_write   before insert or update on public.department_heads
  for each row execute function app.department_heads_before_write();
create trigger projects_before_write           before insert or update on public.projects
  for each row execute function app.projects_before_write();
create trigger projects_after_write            after insert or update on public.projects
  for each row execute function app.projects_after_write();
create trigger project_members_before_write    before insert or update on public.project_members
  for each row execute function app.project_members_before_write();
create trigger project_members_after_write     after insert or update on public.project_members
  for each row execute function app.project_members_after_write();
create trigger tasks_before_write              before insert or update on public.tasks
  for each row execute function app.tasks_before_write();
create trigger tasks_after_write               after insert or update on public.tasks
  for each row execute function app.tasks_after_write();
create trigger task_comments_before_write      before insert or update on public.task_comments
  for each row execute function app.task_comments_before_write();
create trigger task_comments_after_insert      after insert on public.task_comments
  for each row execute function app.task_comments_after_insert();
create trigger daily_reports_before_write      before insert or update on public.daily_reports
  for each row execute function app.daily_reports_before_write();
create trigger daily_reports_after_insert      after insert on public.daily_reports
  for each row execute function app.daily_reports_after_insert();
create trigger daily_report_items_before_write before insert or update or delete on public.daily_report_items
  for each row execute function app.daily_report_items_before_write();
create trigger daily_report_items_after_write  after insert or update on public.daily_report_items
  for each row execute function app.daily_report_items_after_write();
create trigger attachments_before_insert       before insert on public.daily_report_attachments
  for each row execute function app.attachments_before_insert();
create trigger workspace_settings_after_update after update on public.workspace_settings
  for each row execute function app.workspace_settings_after_update();
create trigger activity_log_before_insert      before insert on public.activity_log
  for each row execute function app.activity_log_before_insert();
create trigger notifications_before_write      before insert or update on public.notifications
  for each row execute function app.notifications_before_write();
