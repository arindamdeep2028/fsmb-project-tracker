-- =============================================================================
-- Migration 19 · Final decisions (28 Sep 2026) and consistency fixes
--
-- Decision 1 · Working week: Monday–Friday; Saturday and Sunday are non-working days.
--   Every deadline, overdue, working-day and deadline-status calculation reads
--   app.is_workday(), which reads workspace_settings.workdays. This migration pins the value.
-- Decision 2 · Admin has complete system access. The only refusals left for an Admin are
--   security-critical protections (see the list at the end of this file).
-- Consistency fixes C1–C17 from the Frontend Blueprint §13 check are marked inline.
-- =============================================================================

-- ---------- Decision 1: working week ---------------------------------------------------------
-- The settings trigger recalculates every open task's stored deadlines if the value changes.
update public.workspace_settings set workdays = '{1,2,3,4,5}' where id = 1 and workdays <> '{1,2,3,4,5}'::smallint[];
alter table public.workspace_settings alter column workdays set default '{1,2,3,4,5}';
comment on column public.workspace_settings.workdays is
  'ISO weekdays that are working days. FSMB decision 28-Sep-2026: Monday–Friday (1–5); Saturday and Sunday are non-working.';

-- Engineer view: say whether a report is expected today (false on Saturday and Sunday).
create or replace view public.v_engineer_project_progress with (security_invoker = true) as
select p.id as project_id, p.code, p.name,
       m.project_completion_pct,
       c.share_pct, c.delivered_pct, c.personal_progress,
       (select count(*) from public.tasks t where t.project_id = p.id and t.assigned_to = auth.uid()
          and t.status <> 'Completed' and not t.archived)                   as my_open_tasks,
       exists (select 1 from public.daily_reports r where r.project_id = p.id and r.user_id = auth.uid()
                  and r.report_date = app.dhaka_today())                     as report_submitted_today,
       (app.is_workday(app.dhaka_today())
        and exists (select 1 from public.tasks t where t.project_id = p.id and t.assigned_to = auth.uid()
                       and t.status <> 'Completed' and not t.archived))     as report_expected_today
  from public.projects p
  cross join lateral app.user_contribution(auth.uid(), p.id) c
  cross join lateral (select app.project_completion(p.id) as project_completion_pct) m
 where not p.archived and app.is_project_member(p.id);

-- ---------- C1 + C2: task triggers aligned with Permission & Workflow Blueprint v2 -------------
-- C2: engineers may change contribution % on tasks they created at any status unless locked.
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
      elsif old.created_by = v_uid then
        -- v2: contribution % on created tasks at any status unless locked;
        --     title, description and assignee only while Not started
        v_allowed := array['updated_at'];
        if not old.contribution_locked then v_allowed := v_allowed || 'contribution_pct'::text; end if;
        if old.status = 'Not started' then v_allowed := v_allowed || array['title', 'description', 'assigned_to']; end if;
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

-- C1: status_changed only when someone other than the assignee changes status, or on completion.
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

-- ---------- C14: engineer on-time / late counted by completion date in the window ---------------
create or replace function public.my_dashboard() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_window int := (select review_window_days from public.workspace_settings where id = 1);
begin
  return jsonb_build_object(
    'assigned_tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.is_red desc, t.effective_due_at)
                                  from public.v_engineer_tasks t where t.status <> 'Completed'), '[]'),
    'pending_tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.effective_due_at)
                                 from public.v_engineer_tasks t where t.status <> 'Completed' and t.is_pending), '[]'),
    'deadlines', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.task_id, 'code', t.code, 'title', t.title,
                                   'project_code', t.project_code, 'effective_due_at', t.effective_due_at,
                                   'plan_due_at', case when t.plan_submitted_at is null then t.plan_due_at end,
                                   'deadline_status', t.deadline_status) order by t.effective_due_at)
                             from public.v_engineer_tasks t where t.status <> 'Completed' and t.due_within_7_days), '[]'),
    'projects', coalesce((select jsonb_agg(to_jsonb(p) order by p.code) from public.v_engineer_project_progress p), '[]'),
    'overall_completion_pct', (select case when sum(share_pct) > 0 then round(100 * sum(delivered_pct) / sum(share_pct), 2) end
                                 from public.v_engineer_project_progress),
    'red_now', (select count(*) from public.v_engineer_tasks t where t.status <> 'Completed' and t.is_red),
    'on_time', (select count(*) from public.tasks t where t.assigned_to = auth.uid() and not t.archived
                  and t.status = 'Completed' and t.completed_on <= t.effective_due_at
                  and t.completed_on > now() - make_interval(days => v_window)),
    'late', (select count(*) from public.tasks t where t.assigned_to = auth.uid() and not t.archived
               and t.status = 'Completed' and t.completed_on > t.effective_due_at
               and t.completed_on > now() - make_interval(days => v_window)),
    'report_expected_today', app.is_workday(app.dhaka_today()),
    'progress_trend_30d', coalesce((
        select jsonb_agg(jsonb_build_object('day', d, 'delivered_points', pts) order by d)
          from (select (c.recorded_at at time zone app.tz())::date as d,
                       round(sum(coalesce(w.weight, 0) * (coalesce(c.progress_after, 0) - coalesce(c.progress_before, 0))), 2) as pts
                  from public.task_contributions c
                  join public.tasks t on t.id = c.task_id and t.assigned_to = auth.uid()
                  left join app.task_weights w on w.task_id = c.task_id
                 where c.recorded_at > now() - interval '30 days'
                 group by 1) x), '[]'));
end $$;

-- ---------- C15: department window results follow the chosen window; Admin default department ---
create or replace function public.department_dashboard(p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dept uuid := p_department;
  v_to   date := coalesce(p_to, app.dhaka_today());
  v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
  v_win  jsonb;
begin
  if v_dept is null then
    select dh.department_id into v_dept from public.department_heads dh where dh.user_id = auth.uid() limit 1;
  end if;
  if v_dept is null and app.is_admin() then
    select d.id into v_dept from public.departments d where d.active order by d.sort_order, d.name limit 1;
  end if;
  if v_dept is null or not app.heads_department(v_dept) then
    raise exception 'Only the head of this department or an admin can open its dashboard' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'completed_in_window', count(*) filter (where t.status = 'Completed'),
           'on_time_pct', round(100.0 * count(*) filter (where t.status = 'Completed' and t.completed_on <= t.effective_due_at)
                                / nullif(count(*) filter (where t.status = 'Completed'), 0), 1))
    into v_win
    from public.tasks t join public.projects p on p.id = t.project_id
   where p.department_id = v_dept and not t.archived and t.status = 'Completed'
     and (t.completed_on at time zone app.tz())::date between v_from and v_to;
  v_win := v_win || jsonb_build_object(
    'extensions_in_window', (select count(*) from public.task_extensions e join public.tasks t on t.id = e.task_id
                               join public.projects p on p.id = t.project_id
                              where p.department_id = v_dept
                                and (e.granted_at at time zone app.tz())::date between v_from and v_to),
    'red_mark_events', (select count(*) from public.activity_log l join public.projects p on p.id = l.project_id
                         where p.department_id = v_dept and l.action = 'Red mark' and l.log_date between v_from and v_to));
  return jsonb_build_object(
    'department', (select to_jsonb(s) from public.v_department_summary s where s.department_id = v_dept) || v_win,
    'projects', coalesce((select jsonb_agg(to_jsonb(p) order by p.at_risk desc, p.code)
                            from public.v_department_projects p where p.department_id = v_dept), '[]'),
    'people', coalesce((select jsonb_agg(to_jsonb(r)) from public.performance_summary(v_from, v_to, v_dept) r), '[]'),
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'department_id', v_dept));
end $$;

-- ---------- C3: PM sees performance of members, own projects only (v2 §2) -----------------------
-- Scores computed from this project's tasks and red marks only. Managers of the project only.
create or replace function public.project_performance(p_project uuid, p_from date default null, p_to date default null)
returns table (user_id uuid, full_name text, member_role public.project_member_role, assigned bigint, completed bigint,
               late bigint, on_time_pct numeric, red_events bigint, daily_updates bigint, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_to   date := coalesce(p_to, app.dhaka_today());
  v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
begin
  if not app.manages_project(p_project) then
    raise exception 'Only the project PM, the department head or an admin can view member performance' using errcode = '42501';
  end if;
  return query
  with s as (select * from public.workspace_settings where id = 1),
  base as (
    select m.user_id as uid, pr.full_name as nm, m.member_role as mrole,
      (select count(*) from public.tasks t where t.project_id = p_project and t.assigned_to = m.user_id and not t.archived
          and (t.assigned_on at time zone app.tz())::date between v_from and v_to)                        as a,
      (select count(*) from public.tasks t where t.project_id = p_project and t.assigned_to = m.user_id and not t.archived
          and t.status = 'Completed' and (t.completed_on at time zone app.tz())::date between v_from and v_to) as c,
      (select count(*) from public.tasks t where t.project_id = p_project and t.assigned_to = m.user_id and not t.archived
          and t.status = 'Completed' and t.completed_on > t.effective_due_at
          and (t.completed_on at time zone app.tz())::date between v_from and v_to)                        as l,
      (select count(*) from public.activity_log g where g.project_id = p_project and g.subject_user_id = m.user_id
          and g.action = 'Red mark' and g.log_date between v_from and v_to)                                as r,
      (select count(*) from public.activity_log g where g.project_id = p_project and g.subject_user_id = m.user_id
          and g.action = 'Daily update' and g.log_date between v_from and v_to)                            as d
    from public.project_members m join public.profiles pr on pr.id = m.user_id
    where m.project_id = p_project and m.removed_at is null and pr.active
  )
  select b.uid, b.nm, b.mrole, b.a, b.c, b.l,
         case when b.c = 0 then null else round(100.0 * (b.c - b.l) / b.c, 1) end,
         b.r, b.d,
         case when b.c = 0 then null
              else round(100 * (s.score_weight_on_time * (1 - b.l::numeric / b.c)
                                + s.score_weight_clean * (1 - least(1, b.r::numeric / greatest(1, b.a)))))::int end
    from base b cross join s
   order by 10 desc nulls last, b.nm;
end $$;
grant execute on function public.project_performance(uuid, date, date) to authenticated;

-- ---------- Decision 2: Admin complete access ---------------------------------------------------
-- New log action for hard deletes (the value is used only by the trigger below, after commit).
alter type public.log_action add value if not exists 'Deleted';

-- Deleting a parent task removes its subtasks with it (was: blocked). Report history still
-- protects tasks and projects: daily_report_items.task_id and daily_reports.project_id stay RESTRICT.
alter table public.tasks drop constraint if exists tasks_parent_id_fkey;
alter table public.tasks add constraint tasks_parent_id_fkey
  foreign key (parent_id) references public.tasks (id) on delete cascade;

create or replace function app.log_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if tg_table_name = 'projects' then
    perform set_config('app.deleting_project', old.id::text, true);
    return old;                                    -- BEFORE DELETE: mark, log after
  end if;
  if tg_table_name = 'tasks' then
    if current_setting('app.deleting_project', true) = old.project_id::text then return null; end if;
    select code into v_code from public.projects where id = old.project_id;
    insert into public.activity_log (action, scope, project_code, task_code, subject_user_id, details, source)
    values ('Deleted', (case when v_code is null then 'system' else 'project' end)::public.log_scope, v_code, old.code, old.assigned_to,
            'Task deleted: ' || old.code || ' ' || old.title, 'app');
  elsif tg_table_name = 'daily_reports' then
    select code into v_code from public.projects where id = old.project_id;
    insert into public.activity_log (action, scope, project_code, subject_user_id, details, source)
    values ('Deleted', (case when v_code is null then 'system' else 'project' end)::public.log_scope, v_code, old.user_id,
            'Daily report deleted: ' || to_char(old.report_date, 'DD-Mon-YYYY'), 'app');
  end if;
  return null;
end $$;

create or replace function app.log_project_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (action, scope, project_code, details, source)
  values ('Deleted', 'project', old.code, 'Project deleted: ' || old.code || ' ' || old.name, 'app');
  perform set_config('app.deleting_project', '', true);
  return null;
end $$;

create trigger projects_before_delete   before delete on public.projects      for each row execute function app.log_deletion();
create trigger projects_after_delete    after delete  on public.projects      for each row execute function app.log_project_deleted();
create trigger tasks_after_delete       after delete  on public.tasks         for each row execute function app.log_deletion();
create trigger daily_reports_after_delete after delete on public.daily_reports for each row execute function app.log_deletion();

grant delete on public.projects, public.tasks, public.daily_reports to authenticated;

create policy projects_admin_delete on public.projects for delete to authenticated using ((select app.is_admin()));
create policy tasks_admin_delete    on public.tasks    for delete to authenticated using ((select app.is_admin()));
create policy reports_admin_delete  on public.daily_reports for delete to authenticated using ((select app.is_admin()));

-- Admin edits (moderates) any comment; authors still edit their own.
drop policy if exists comments_update on public.task_comments;
create policy comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid()) or (select app.is_admin()))
  with check (author_id = (select auth.uid()) or (select app.is_admin()));

-- Admin manages any user's notification preferences and can clear any notification.
create policy prefs_admin_insert on public.notification_preferences for insert to authenticated
  with check ((select app.is_admin()));
create policy prefs_admin_update on public.notification_preferences for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy notifications_admin_delete on public.notifications for delete to authenticated
  using ((select app.is_admin()));

-- C17: Admin runs a scheduled job on demand from /admin/data.
create or replace function public.admin_run_job(p_job text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return case p_job
    when 'red-mark-scan'  then app.run_red_mark_scan('manual')
    when 'deadline-scan'  then app.run_deadline_scan('manual')
    when 'lock-and-purge' then app.lock_and_purge('manual')
    else null end;
end $$;
revoke execute on function public.admin_run_job(text) from public, anon;
grant execute on function public.admin_run_job(text) to authenticated;

-- ---------- C12: email queue readable by the notify-email Edge Function -------------------------
create or replace function public.pending_emails(p_limit int default 100)
returns table (notification_id uuid, email text, full_name text, title text, body text, link text, type public.notification_type)
language sql stable security definer set search_path = '' as $$
  select * from app.pending_emails(p_limit);
$$;
revoke execute on function public.pending_emails(int) from public, anon, authenticated;
grant execute on function public.pending_emails(int) to service_role;

-- Foreign keys cleared by an Admin delete must not trip the notification guard.
create or replace function app.notifications_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_in boolean; v_email boolean; v_changed text[];
begin
  if tg_op = 'UPDATE' then
    v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
    -- allowed: the recipient marking it read, and foreign keys cleared when a task,
    -- project or user is deleted (ON DELETE SET NULL)
    if auth.uid() is not null
       and not (v_changed <@ array['read_at'])
       and not (v_changed <@ array['task_id', 'project_id', 'actor_id']
                and (new.task_id is null or not 'task_id' = any (v_changed))
                and (new.project_id is null or not 'project_id' = any (v_changed))
                and (new.actor_id is null or not 'actor_id' = any (v_changed))) then
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

-- ---------- C11: live notification bell --------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------- Grants for replaced functions --------------------------------------------------------
grant execute on function public.my_dashboard(), public.department_dashboard(uuid, date, date) to authenticated;

-- =============================================================================
-- What still refuses an Admin (security-critical protections only):
--   S1 Audit trail is append-only: activity_log, scan_runs, task_contributions, task_extensions.
--   S2 The last active Admin cannot be demoted or deactivated.
--   S3 Accounts, passwords and login emails change only through Supabase Auth (service role in
--      Edge Functions); profiles cannot be inserted directly.
--   S4 Calculated columns are written only by the database: stored deadlines, code counters,
--      created_by / created_at. Admin sets deadlines through planned_due_at and extensions.
-- Integrity rules that apply to everyone (keep numbers and access coherent; each has an admin path):
--   I1 Progress is typed on leaf items only; parents are calculated.
--   I2 A member with open tasks, or the lead PM, cannot be removed until tasks / lead PM are reassigned.
--   I3 Tasks and projects with daily-report history cannot be hard-deleted; archive them instead.
--   I4 One daily report per user, project and day; two task levels only.
-- =============================================================================
