-- =============================================================================
-- Migration 14 · RPC functions (public, callable by signed-in users) and job functions (app)
-- (Implementation Blueprint §6.3–6.4, functions 22–39 + set_task_deadline for the approved
--  "PM/Admin set task deadlines" decision)
-- SECURITY INVOKER functions rely on RLS; SECURITY DEFINER functions check scope explicitly.
-- =============================================================================

-- ---------- (22) Engineer dropdown for a project -------------------------------------------
create or replace function public.project_engineers(p_project uuid)
returns table (user_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_see_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.full_name
      from public.project_members m join public.profiles p on p.id = m.user_id
     where m.project_id = p_project and m.member_role = 'engineer' and m.removed_at is null and p.active
     order by p.full_name;
end $$;

-- ---------- (23) People a manager can add to a project -------------------------------------
create or replace function public.assignable_users(p_project uuid)
returns table (user_id uuid, full_name text, role public.user_role, department text, is_member boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.manages_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.role, d.name::text,
           exists (select 1 from public.project_members m where m.project_id = p_project
                      and m.user_id = p.id and m.removed_at is null)
      from public.profiles p left join public.departments d on d.id = p.department_id
     where p.active and p.role in ('engineer', 'pm')
     order by p.full_name;
end $$;

-- ---------- (24) Project progress totals (visible to every member, incl. engineers) ---------
create or replace function public.project_progress(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not app.can_see_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'project_id', m.project_id, 'completion_pct', m.completion_pct, 'planned_pct', m.planned_pct,
           'status', m.status, 'members', m.members_count, 'tasks_total', m.tasks_total,
           'completed_tasks', m.completed_tasks, 'open_tasks', m.open_tasks)
    into v from app.project_metrics m where m.project_id = p_project;
  return v;
end $$;

-- ---------- (25) Contribution of every member (managers only) --------------------------------
create or replace function public.member_contribution(p_project uuid)
returns table (user_id uuid, full_name text, member_role public.project_member_role,
               open_tasks bigint, share_pct numeric, delivered_pct numeric, personal_progress numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.manages_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.full_name, m.member_role,
           (select count(*) from public.tasks t where t.project_id = p_project and t.assigned_to = m.user_id
              and t.status <> 'Completed' and not t.archived),
           c.share_pct, c.delivered_pct, c.personal_progress
      from public.project_members m
      join public.profiles p on p.id = m.user_id
      cross join lateral app.user_contribution(m.user_id, p_project) c
     where m.project_id = p_project and m.removed_at is null
     order by c.share_pct desc, p.full_name;
end $$;

-- ---------- (26) The caller's own contribution ------------------------------------------------
create or replace function public.my_contribution(p_project uuid)
returns table (share_pct numeric, delivered_pct numeric, personal_progress numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_see_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select c.share_pct, c.delivered_pct, c.personal_progress from app.user_contribution(auth.uid(), p_project) c;
end $$;

-- ---------- (27) Save today's daily report with its task / subtask items (one transaction) ------
-- p = {"project_id": uuid, "update_text": text, "issues": text, "next_task_id": uuid,
--      "next_task_text": text, "remarks": text,
--      "items": [{"task_id": uuid, "progress_after": 0-100, "status_after": "In progress", "note": text}]}
create or replace function public.save_daily_report(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id    uuid;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
begin
  insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_id, next_task_text, remarks)
  values (auth.uid(), (p ->> 'project_id')::uuid, coalesce((p ->> 'report_date')::date, app.dhaka_today()),
          p ->> 'update_text', p ->> 'issues', nullif(p ->> 'next_task_id', '')::uuid, p ->> 'next_task_text', p ->> 'remarks')
  on conflict (user_id, project_id, report_date) do update
     set update_text = excluded.update_text, issues = excluded.issues, next_task_id = excluded.next_task_id,
         next_task_text = excluded.next_task_text, remarks = excluded.remarks
  returning id into v_id;

  delete from public.daily_report_items i
   where i.report_id = v_id
     and i.task_id not in (select (x ->> 'task_id')::uuid from jsonb_array_elements(v_items) x);

  insert into public.daily_report_items (report_id, task_id, progress_after, status_after, note)
  select v_id, (x ->> 'task_id')::uuid, (x ->> 'progress_after')::numeric,
         nullif(x ->> 'status_after', '')::public.task_status, x ->> 'note'
    from jsonb_array_elements(v_items) x
  on conflict (report_id, task_id) do update
     set progress_after = excluded.progress_after, status_after = excluded.status_after, note = excluded.note;
  return v_id;
end $$;

-- ---------- (28) Mark Done → Completed ---------------------------------------------------
create or replace function public.complete_task(p_task uuid) returns public.tasks
language plpgsql volatile security invoker set search_path = '' as $$
declare v public.tasks;
begin
  update public.tasks set status = 'Completed' where id = p_task returning * into v;
  if not found then raise exception 'Task not found or not allowed' using errcode = '42501'; end if;
  return v;
end $$;

-- ---------- (29) Grant an extension (PM, Department Head, Admin) ----------------------------
create or replace function public.grant_extension(p_task uuid, p_new_deadline timestamptz, p_reason text default null)
returns public.tasks
language plpgsql volatile security invoker set search_path = '' as $$
declare v public.tasks; v_prev timestamptz;
begin
  if not app.manages_project(app.task_project(p_task)) then
    raise exception 'Only the project PM, the department head or an admin can grant an extension' using errcode = '42501';
  end if;
  if p_new_deadline is null or p_new_deadline <= now() then
    raise exception 'The new deadline must be in the future' using errcode = '22023';
  end if;
  select effective_due_at into v_prev from public.tasks where id = p_task;
  insert into public.task_extensions (task_id, previous_deadline, new_deadline, reason, granted_by)
  values (p_task, v_prev, p_new_deadline, p_reason, auth.uid());
  update public.tasks set extended_deadline = p_new_deadline where id = p_task returning * into v;
  return v;
end $$;

-- ---------- Manager-set task deadline (approved decision: PM/Admin set deadlines) -----------
create or replace function public.set_task_deadline(p_task uuid, p_due timestamptz) returns public.tasks
language plpgsql volatile security invoker set search_path = '' as $$
declare v public.tasks;
begin
  if not app.manages_project(app.task_project(p_task)) then
    raise exception 'Only the project PM, the department head or an admin can set a task deadline' using errcode = '42501';
  end if;
  update public.tasks set planned_due_at = p_due where id = p_task returning * into v;
  return v;
end $$;

-- ---------- Performance (4-month review) -------------------------------------------------------
create or replace function app.performance_rows(p_from date, p_to date, p_department uuid, p_user uuid)
returns table (user_id uuid, full_name text, department text, assigned bigint, completed bigint, late bigint,
               on_time_pct numeric, red_events bigint, daily_updates bigint, score integer)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.workspace_settings where id = 1),
  base as (
    select p.id, p.full_name, d.name::text as dept,
      (select count(*) from public.tasks t where t.assigned_to = p.id and not t.archived
          and (t.assigned_on at time zone app.tz())::date between p_from and p_to)                   as assigned,
      (select count(*) from public.tasks t where t.assigned_to = p.id and not t.archived and t.status = 'Completed'
          and (t.completed_on at time zone app.tz())::date between p_from and p_to)                  as completed,
      (select count(*) from public.tasks t where t.assigned_to = p.id and not t.archived and t.status = 'Completed'
          and t.completed_on > t.effective_due_at
          and (t.completed_on at time zone app.tz())::date between p_from and p_to)                  as late,
      (select count(*) from public.activity_log l where l.subject_user_id = p.id and l.action = 'Red mark'
          and l.log_date between p_from and p_to)                                                   as red_events,
      (select count(*) from public.activity_log l where l.subject_user_id = p.id and l.action = 'Daily update'
          and l.log_date between p_from and p_to)                                                   as daily_updates
    from public.profiles p left join public.departments d on d.id = p.department_id
    where p.active
      and (p_department is null or p.department_id = p_department)
      and (p_user is null or p.id = p_user)
  )
  select b.id, b.full_name, b.dept, b.assigned, b.completed, b.late,
         case when b.completed = 0 then null else round(100.0 * (b.completed - b.late) / b.completed, 1) end,
         b.red_events, b.daily_updates,
         case when b.completed = 0 then null
              else round(100 * (s.score_weight_on_time * (1 - b.late::numeric / b.completed)
                                + s.score_weight_clean * (1 - least(1, b.red_events::numeric / greatest(1, b.assigned)))))::int end
    from base b cross join s
   order by 10 desc nulls last, b.full_name;
$$;

-- (34) Scores for everyone (Admin) or for one department (its head)
create or replace function public.performance_summary(p_from date default null, p_to date default null, p_department uuid default null)
returns table (user_id uuid, full_name text, department text, assigned bigint, completed bigint, late bigint,
               on_time_pct numeric, red_events bigint, daily_updates bigint, score integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := coalesce(p_to, app.dhaka_today());
        v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
begin
  if not (app.is_admin() or (p_department is not null and app.heads_department(p_department))) then
    raise exception 'Only admins, or department heads for their own department, can view performance' using errcode = '42501';
  end if;
  return query select * from app.performance_rows(v_from, v_to, p_department, null);
end $$;

-- (35) The caller's own score
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

-- ---------- Dashboards (JSON for the app; each reads only views the caller may see) ----------
-- (30) Engineer dashboard
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
    'on_time', (select count(*) from public.v_engineer_tasks t where t.deadline_status = 'completed_on_time'
                  and t.effective_due_at > now() - make_interval(days => v_window)),
    'late', (select count(*) from public.v_engineer_tasks t where t.deadline_status = 'completed_late'
               and t.effective_due_at > now() - make_interval(days => v_window)),
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

-- (31) PM "My Projects" dashboard
create or replace function public.my_projects_dashboard() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  return jsonb_build_object(
    'projects', coalesce((select jsonb_agg(to_jsonb(p) order by p.at_risk desc, p.code) from public.v_pm_projects p), '[]'),
    'blocked_tasks', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.id, 'code', t.code, 'title', t.title,
                                 'assigned_to', t.assigned_to, 'blocker_note', t.blocker_note) order by t.code)
                               from public.tasks t join public.v_pm_projects p on p.project_id = t.project_id
                              where t.status = 'Blocked' and not t.archived), '[]'),
    'team_updates', coalesce((select jsonb_agg(to_jsonb(u) order by u.submitted_at desc)
                                from (select * from public.v_pm_team_updates u
                                       where u.project_id in (select project_id from public.v_pm_projects)
                                       order by u.submitted_at desc limit 20) u), '[]'),
    'team_load', coalesce((select jsonb_agg(to_jsonb(l) order by l.project_code, l.full_name)
                             from public.v_pm_team_load l
                            where l.project_id in (select project_id from public.v_pm_projects)), '[]'),
    'missing_reports', coalesce((select jsonb_agg(jsonb_build_object('project_code', l.project_code, 'user_id', l.user_id,
                                   'full_name', l.full_name) order by l.project_code, l.full_name)
                                 from public.v_pm_team_load l
                                where l.project_id in (select project_id from public.v_pm_projects)
                                  and l.open_tasks > 0 and not l.reported_today
                                  and app.is_workday(app.dhaka_today())), '[]'));
end $$;

-- (32) Department Head dashboard
create or replace function public.department_dashboard(p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dept uuid := p_department;
  v_to   date := coalesce(p_to, app.dhaka_today());
  v_from date := coalesce(p_from, v_to - (select review_window_days from public.workspace_settings where id = 1));
begin
  if v_dept is null then
    select dh.department_id into v_dept from public.department_heads dh where dh.user_id = auth.uid() limit 1;
  end if;
  if v_dept is null or not app.heads_department(v_dept) then
    raise exception 'Only the head of this department or an admin can open its dashboard' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'department', (select to_jsonb(s) from public.v_department_summary s where s.department_id = v_dept),
    'projects', coalesce((select jsonb_agg(to_jsonb(p) order by p.at_risk desc, p.code)
                            from public.v_department_projects p where p.department_id = v_dept), '[]'),
    'people', coalesce((select jsonb_agg(to_jsonb(r)) from public.performance_summary(v_from, v_to, v_dept) r), '[]'),
    'window', jsonb_build_object('from', v_from, 'to', v_to));
end $$;

-- (33) Admin dashboard
create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'overview', (select to_jsonb(o) from public.v_admin_overview o),
    'departments', coalesce((select jsonb_agg(to_jsonb(s) order by s.department_name) from public.v_department_summary s), '[]'),
    'projects', coalesce((select jsonb_agg(to_jsonb(p) order by p.at_risk desc, p.code) from public.v_department_projects p), '[]'),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.job, 'last_run', j.last_run, 'last_error', j.last_error))
                        from (select job, max(started_at) as last_run,
                                     (array_agg(error order by started_at desc))[1] as last_error
                                from public.scan_runs group by job) j), '[]'));
end $$;

-- ---------- (37) Job: red-mark scan (09:05 Dhaka) ----------------------------------------------
create or replace function app.run_red_mark_scan(p_trigger text default 'cron') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run     bigint;
  v_flagged int := 0;
  v_new     int := 0;
  v_n       int;
  v_reason  public.breach_reason;
  v_digest  jsonb := '[]';
  t         public.tasks;
  v_hours   smallint := (select plan_hours from public.workspace_settings where id = 1);
  v_err     text;
begin
  insert into public.scan_runs (job, trigger) values ('red-mark-scan', p_trigger) returning id into v_run;
  begin
  if app.is_workday(app.dhaka_today()) then
    for t in select * from public.tasks where not archived and status <> 'Completed' loop
      if cardinality(app.task_breaches(t)) > 0 then
        v_flagged := v_flagged + 1;
        foreach v_reason in array app.task_breaches(t) loop
          insert into public.activity_log (action, scope, project_id, task_id, subject_user_id, reason_code, details, source)
          values ('Red mark', 'project', t.project_id, t.id, t.assigned_to, v_reason,
                  case v_reason when 'plan_missing' then 'Plan not submitted (' || v_hours || '-office-hour rule)'
                                when 'exec_overdue' then 'Execution overdue'
                                else 'Daily update missing' end, 'scan')
          on conflict (task_id, reason_code, log_date) where action = 'Red mark' do nothing;
          get diagnostics v_n = row_count;
          v_new := v_new + v_n;
          v_digest := v_digest || jsonb_build_object('task_id', t.id, 'task_code', t.code, 'project_id', t.project_id,
                                                     'assigned_to', t.assigned_to, 'reason', v_reason);
        end loop;
      end if;
    end loop;
  end if;
  exception when others then v_err := sqlerrm;          -- recorded below; the job's partial work is rolled back
  end;
  update public.scan_runs set finished_at = now(), flagged_tasks = v_flagged, new_red_marks = v_new, error = v_err
   where id = v_run;
  return jsonb_build_object('run_id', v_run, 'flagged_tasks', v_flagged, 'new_red_marks', v_new, 'error', v_err,
                            'digest_email', (select digest_email from public.workspace_settings where id = 1),
                            'items', v_digest);
end $$;

-- ---------- (38) Job: deadline notifications (every 15 min in office hours) ---------------------
create or replace function app.run_deadline_scan(p_trigger text default 'cron') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run    bigint;
  v_before bigint := (select count(*) from public.notifications where type in ('deadline_approaching', 'task_overdue'));
  v_warn   interval := make_interval(hours => (select deadline_warning_hours from public.workspace_settings where id = 1));
  v_today  text := to_char(app.dhaka_today(), 'YYYYMMDD');
  v_count  int;
  t        public.tasks;
  r        record;
  v_err    text;
begin
  insert into public.scan_runs (job, trigger) values ('deadline-scan', p_trigger) returning id into v_run;
  begin
  if app.is_workday(app.dhaka_today()) then
    for t in select * from public.tasks where not archived and status <> 'Completed' loop
      if t.effective_due_at > now() and t.effective_due_at <= now() + v_warn then
        perform app.notify(t.assigned_to, 'deadline_approaching', t.code || ' is due ' || app.fmt_ts(t.effective_due_at),
                           t.title, t.project_id, t.id, 'due:exec:' || t.id || ':' || to_char(t.effective_due_at, 'YYYYMMDDHH24MI'));
      end if;
      if t.plan_submitted_at is null and t.plan_due_at > now() and t.plan_due_at <= now() + v_warn then
        perform app.notify(t.assigned_to, 'deadline_approaching', 'Plan for ' || t.code || ' is due ' || app.fmt_ts(t.plan_due_at),
                           t.title, t.project_id, t.id, 'due:plan:' || t.id);
      end if;
      if now() > t.effective_due_at or (t.plan_submitted_at is null and now() > t.plan_due_at) then
        for r in select distinct u from (
                   select t.assigned_to as u
                   union select m.user_id from public.project_members m
                          where m.project_id = t.project_id and m.member_role = 'pm' and m.removed_at is null) x loop
          perform app.notify(r.u, 'task_overdue',
                             t.code || case when now() > t.effective_due_at then ' is overdue' else ': plan overdue' end,
                             t.title, t.project_id, t.id,
                             'overdue:' || case when now() > t.effective_due_at then 'exec' else 'plan' end || ':' || t.id || ':' || v_today);
        end loop;
      end if;
    end loop;
  end if;
  exception when others then v_err := sqlerrm;
  end;
  select count(*) - v_before into v_count from public.notifications n
   where n.type in ('deadline_approaching', 'task_overdue');
  update public.scan_runs set finished_at = now(), notifications_created = v_count, error = v_err where id = v_run;
  return jsonb_build_object('run_id', v_run, 'notifications_created', v_count, 'error', v_err);
end $$;

-- ---------- (39) Job: lock yesterday's reports, purge old notifications, list orphan files ------
create or replace function app.lock_and_purge(p_trigger text default 'cron') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run      bigint;
  v_locked   int;
  v_purged   int;
  v_missing  int;
  v_orphans  jsonb;
  v_err      text;
begin
  insert into public.scan_runs (job, trigger) values ('lock-and-purge', p_trigger) returning id into v_run;
  begin
  update public.daily_reports set locked = true where not locked and report_date < app.dhaka_today();
  get diagnostics v_locked = row_count;
  delete from public.notifications n
   where n.created_at < now() - make_interval(days => (select notification_retention_days from public.workspace_settings where id = 1));
  get diagnostics v_purged = row_count;
  -- attachment rows whose file never arrived (upload abandoned) after 24 h
  delete from public.daily_report_attachments a
   where a.uploaded_at < now() - interval '24 hours'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'daily-report-files' and o.name = a.storage_path);
  get diagnostics v_missing = row_count;
  -- files with no attachment row after 24 h: deleted by the storage-orphans Edge Function via the Storage API
  select coalesce(jsonb_agg(o.name), '[]') into v_orphans
    from storage.objects o
   where o.bucket_id = 'daily-report-files' and o.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.daily_report_attachments a where a.storage_path = o.name);
  exception when others then v_err := sqlerrm;
  end;
  update public.scan_runs set finished_at = now(), error = v_err where id = v_run;
  return jsonb_build_object('run_id', v_run, 'reports_locked', v_locked, 'notifications_purged', v_purged,
                            'attachment_rows_removed', v_missing, 'orphan_files', v_orphans, 'error', v_err);
end $$;

-- ---------- Email queue for the notify-email Edge Function (service role only) -----------------
create or replace function app.pending_emails(p_limit int default 100)
returns table (notification_id uuid, email text, full_name text, title text, body text, link text, type public.notification_type)
language sql stable security definer set search_path = '' as $$
  select n.id, p.email::text, p.full_name, n.title, n.body, n.link, n.type
    from public.notifications n join public.profiles p on p.id = n.user_id
   where n.email_wanted and n.emailed_at is null and p.email is not null and p.active
   order by n.created_at
   limit p_limit;
$$;
