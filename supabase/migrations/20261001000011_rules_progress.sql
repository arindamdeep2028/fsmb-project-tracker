-- =============================================================================
-- Migration 11 · Rule, progress, audit and notification logic
-- (Implementation Blueprint §6.2, functions 15–21, plus the logging / notification helpers)
--
-- Ported from the HTML rule engine (makeEngine) and the Excel formulas:
--   clock start  – weekend / after office end → next working day at office start;
--                  before office start → office start the same day
--   plan due     – clock start + plan_hours office hours
--   exec due     – office end on the exec_days-th following working day
--   effective    – extended_deadline, else planned_due_at (manager-set), else exec due
-- =============================================================================

-- ---------- Calendar primitives ----------------------------------------------------
create or replace function app.local_at(p_day date, p_hour int) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (p_day + make_time(p_hour, 0, 0)) at time zone app.tz();
$$;

create or replace function app.next_workday(p_day date) returns date
language plpgsql stable security definer set search_path = '' as $$
declare d date := p_day;
begin
  for i in 1..14 loop
    d := d + 1;
    if app.is_workday(d) then return d; end if;
  end loop;
  return d;
end $$;

-- (15) Clock start
create or replace function app.clock_start(p_at timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s        public.workspace_settings;
  v_local  timestamp;
  v_day    date;
  v_hour   numeric;
begin
  if p_at is null then return null; end if;
  select * into s from public.workspace_settings where id = 1;
  v_local := p_at at time zone s.timezone;
  v_day   := v_local::date;
  v_hour  := extract(hour from v_local);
  if not app.is_workday(v_day) or v_hour >= s.office_end then
    return app.local_at(app.next_workday(v_day), s.office_start);
  elsif v_hour < s.office_start then
    return app.local_at(v_day, s.office_start);
  end if;
  return p_at;
end $$;

-- (16) Add office hours, skipping nights and non-working days
create or replace function app.add_office_hours(p_start timestamptz, p_hours numeric) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s        public.workspace_settings;
  v_cur    timestamptz := p_start;
  v_remain interval := make_interval(secs => p_hours * 3600);
  v_day    date;
  v_cap    interval;
begin
  if p_start is null then return null; end if;
  select * into s from public.workspace_settings where id = 1;
  for i in 1..400 loop
    v_day := (v_cur at time zone s.timezone)::date;
    v_cap := app.local_at(v_day, s.office_end) - v_cur;
    if v_remain <= v_cap then return v_cur + v_remain; end if;
    v_remain := v_remain - greatest(v_cap, interval '0');
    v_cur := app.local_at(app.next_workday(v_day), s.office_start);
  end loop;
  return v_cur;
end $$;

-- (17) All stored deadlines for one task
create or replace function app.compute_deadlines(
  p_assigned_on        timestamptz,
  p_extended_deadline  timestamptz,
  p_planned_due_at     timestamptz,
  out clock_start_at   timestamptz,
  out plan_due_at      timestamptz,
  out exec_due_at      timestamptz,
  out effective_due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  s     public.workspace_settings;
  v_day date;
begin
  select * into s from public.workspace_settings where id = 1;
  clock_start_at := app.clock_start(p_assigned_on);
  if clock_start_at is not null then
    plan_due_at := app.add_office_hours(clock_start_at, s.plan_hours);
    v_day := (clock_start_at at time zone s.timezone)::date;
    for i in 1..s.exec_days loop
      v_day := app.next_workday(v_day);
    end loop;
    exec_due_at := app.local_at(v_day, s.office_end);
  end if;
  effective_due_at := coalesce(p_extended_deadline, p_planned_due_at, exec_due_at);
end $$;

-- (18) Next task code: P01-T03 for a responsibility, P01-T03b for a subtask.
-- The counter row update takes a row lock, so concurrent inserts never share a code.
create or replace function app.next_task_code(p_project uuid, p_parent uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text; v_seq int;
begin
  if p_parent is null then
    update public.projects set task_seq = task_seq + 1 where id = p_project
      returning code, task_seq into v_code, v_seq;
    return v_code || '-T' || lpad(v_seq::text, 2, '0');
  end if;
  update public.tasks set subtask_seq = subtask_seq + 1 where id = p_parent
    returning code, subtask_seq into v_code, v_seq;
  return v_code || case when v_seq <= 26 then chr(96 + v_seq) else '-' || v_seq end;
end $$;

-- (19) Rule breaches for a task (HTML engine flags())
create or replace function app.task_breaches(p_task public.tasks, p_at timestamptz default now())
returns public.breach_reason[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out   public.breach_reason[] := '{}';
  v_today date;
begin
  if p_task.archived or p_task.assigned_on is null then return v_out; end if;
  if p_task.status = 'Completed' then
    if p_task.completed_on > p_task.effective_due_at then v_out := array['completed_late'::public.breach_reason]; end if;
    return v_out;
  end if;
  if p_task.plan_submitted_at is null and p_at > p_task.plan_due_at then
    v_out := v_out || 'plan_missing'::public.breach_reason;
  end if;
  if p_at > p_task.effective_due_at then
    v_out := v_out || 'exec_overdue'::public.breach_reason;
  end if;
  v_today := (p_at at time zone app.tz())::date;
  if app.is_workday(v_today)
     and (p_task.clock_start_at at time zone app.tz())::date < v_today
     and (p_task.last_update is null or p_task.last_update < v_today) then
    v_out := v_out || 'daily_update_missing'::public.breach_reason;
  end if;
  return v_out;
end $$;

-- Deadline status label used by views and dashboards
create or replace function app.deadline_status(p_task public.tasks, p_at timestamptz default now()) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s public.workspace_settings;
begin
  select * into s from public.workspace_settings where id = 1;
  if p_task.status = 'Completed' then
    return case when p_task.completed_on > p_task.effective_due_at then 'completed_late' else 'completed_on_time' end;
  elsif p_at > p_task.effective_due_at then
    return 'overdue';
  elsif p_task.plan_submitted_at is null and p_at > p_task.plan_due_at then
    return 'plan_overdue';
  elsif p_task.effective_due_at <= p_at + make_interval(hours => s.deadline_warning_hours) then
    return 'due_soon';
  elsif (p_task.effective_due_at at time zone s.timezone)::date = (p_at at time zone s.timezone)::date then
    return 'due_today';
  end if;
  return 'on_track';
end $$;

-- ---------- Progress and contribution weights (v2 §5) --------------------------------
-- Owner-rights view over all projects: sibling shares (nulls share the remainder, all-zero siblings
-- weigh equally), effective weight of each item, and calculated progress (parents roll up children).
-- Not exposed through the API; public views join it to RLS-filtered tasks.
create view app.task_weights as
with t as (
  select id, project_id, parent_id, contribution_pct as c, progress_pct as p
    from public.tasks
   where not archived
),
g as (
  select t.*,
         sum(c) over w                              as set_sum,
         count(*) filter (where c is null) over w   as n_null,
         count(*) over w                            as n_all
    from t
  window w as (partition by project_id, parent_id)
),
r as (
  select g.*, coalesce(c, greatest(0, 100 - coalesce(set_sum, 0)) / nullif(n_null, 0)) as raw_share
    from g
),
s as (
  select r.*,
         case when sum(raw_share) over w > 0 then raw_share / sum(raw_share) over w
              else 1.0 / n_all end as share
    from r
  window w as (partition by project_id, parent_id)
),
kids as (
  select parent_id, sum(share * p) as calc
    from s
   where parent_id is not null
   group by parent_id
)
select s.id                                                                 as task_id,
       s.project_id,
       s.parent_id,
       (s.parent_id is not null or k.parent_id is null)                     as is_leaf,
       round(s.share, 6)                                                    as share,
       round(case when s.parent_id is null then s.share else s.share * pr.share end, 6) as weight,
       round(case when s.parent_id is null and k.parent_id is not null then k.calc else s.p end, 2) as calc_progress
  from s
  left join kids k on k.parent_id = s.id
  left join s pr   on pr.id = s.parent_id
 where s.parent_id is null or pr.id is not null;

-- (20) Weights for one project
create or replace function app.effective_weights(p_project uuid)
returns table (task_id uuid, parent_id uuid, is_leaf boolean, share numeric, weight numeric, calc_progress numeric)
language sql stable security definer set search_path = '' as $$
  select w.task_id, w.parent_id, w.is_leaf, w.share, w.weight, w.calc_progress
    from app.task_weights w where w.project_id = p_project;
$$;

-- Project completion % = Σ leaf weight × leaf progress
create or replace function app.project_completion(p_project uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(w.weight * w.calc_progress), 2), 0)
    from app.task_weights w where w.project_id = p_project and w.is_leaf;
$$;

-- Planned progress % from project dates (null when dates are missing)
create or replace function app.project_planned_pct(p_project uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when pr.start_date is null or pr.target_end is null then null
              when pr.target_end = pr.start_date then case when app.dhaka_today() >= pr.target_end then 100 else 0 end
              else round(100 * least(1, greatest(0,
                     (app.dhaka_today() - pr.start_date)::numeric / (pr.target_end - pr.start_date))), 2) end
    from public.projects pr where pr.id = p_project;
$$;

-- Individual contribution in a project: share and delivered (percentage points of the project)
create or replace function app.user_contribution(p_uid uuid, p_project uuid,
  out share_pct numeric, out delivered_pct numeric, out personal_progress numeric)
language sql stable security definer set search_path = '' as $$
  select round(100 * coalesce(sum(w.weight), 0), 2),
         round(coalesce(sum(w.weight * w.calc_progress), 0), 2),
         case when coalesce(sum(w.weight), 0) = 0 then null
              else round(sum(w.weight * w.calc_progress) / sum(w.weight), 2) end
    from app.task_weights w
    join public.tasks t on t.id = w.task_id
   where w.project_id = p_project and w.is_leaf and t.assigned_to = p_uid;
$$;

-- ---------- Audit logging and notification generation -------------------------------
create or replace function app.log_event(
  p_action   public.log_action,
  p_project  uuid default null,
  p_task     uuid default null,
  p_subject  uuid default null,
  p_details  text default null,
  p_reason   public.breach_reason default null,
  p_source   text default 'app',
  p_scope    public.log_scope default null)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.activity_log (action, project_id, task_id, subject_user_id, actor_user_id,
                                   details, reason_code, source, scope)
  values (p_action, p_project, p_task, p_subject, auth.uid(), p_details, p_reason, p_source,
          coalesce(p_scope, case when p_project is not null then 'project'::public.log_scope
                                 when p_subject is not null then 'user'::public.log_scope
                                 else 'system'::public.log_scope end))
  on conflict do nothing;
$$;

create or replace function app.notify(
  p_user     uuid,
  p_type     public.notification_type,
  p_title    text,
  p_body     text default null,
  p_project  uuid default null,
  p_task     uuid default null,
  p_dedup    text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, title, body, project_id, task_id, actor_id, dedup_key, link)
  values (p_user, p_type, left(p_title, 200), left(p_body, 2000), p_project, p_task, auth.uid(), p_dedup,
          case when p_task is not null then '/projects/' || p_project || '/tasks/' || p_task
               when p_project is not null then '/projects/' || p_project end)
  on conflict (user_id, dedup_key) where dedup_key is not null do nothing;
end $$;

-- (21) Recalculate stored deadlines of open tasks after a rules change
create or replace function app.recompute_open_deadlines() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  perform set_config('app.recompute_deadlines', 'on', true);
  update public.tasks set updated_at = now() where status <> 'Completed' and not archived;
  get diagnostics v_count = row_count;
  perform set_config('app.recompute_deadlines', 'off', true);
  return v_count;
end $$;
