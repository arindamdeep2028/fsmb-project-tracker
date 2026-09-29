-- =============================================================================
-- Migration 13 · Views (Implementation Blueprint §6.5 + dashboard views, Pre-SQL Blueprint §3)
--
-- Pattern: app.* views are owner-rights aggregates (not exposed through the API);
-- public.* views are SECURITY INVOKER, so RLS on the underlying tables and explicit scope
-- filters decide which rows each user sees.
-- =============================================================================

-- ---------- Per-project metrics for all projects (owner rights; filtered by public views) ----
create view app.project_metrics as
with s as (select * from public.workspace_settings where id = 1),
t as (
  select t.*, app.task_breaches(t) as b
    from public.tasks t
   where not t.archived
),
agg as (
  select project_id,
         count(*)                                                                   as tasks_total,
         count(*) filter (where status <> 'Completed')                              as open_tasks,
         count(*) filter (where status = 'Completed')                               as completed_tasks,
         count(*) filter (where status = 'Not started')                             as not_started,
         count(*) filter (where status = 'Plan submitted')                          as plan_submitted,
         count(*) filter (where status = 'In progress')                             as in_progress,
         count(*) filter (where status = 'Blocked')                                 as blocked_tasks,
         count(*) filter (where status <> 'Completed' and now() > effective_due_at) as overdue_tasks,
         count(*) filter (where status <> 'Completed' and plan_submitted_at is null
                            and now() > plan_due_at)                                as plan_breaches,
         count(*) filter (where status <> 'Completed' and cardinality(b) > 0)       as red_tasks,
         count(*) filter (where status <> 'Completed'
                            and (effective_due_at at time zone app.tz())::date = app.dhaka_today()) as due_today,
         count(*) filter (where priority = 'Important' and status <> 'Completed')   as open_important,
         count(*) filter (where priority = 'High' and status <> 'Completed')        as open_high
    from t group by project_id
),
leaves as (
  select w.project_id,
         count(*)                                              as leaves_total,
         count(*) filter (where tk.status = 'Completed')       as leaves_completed,
         round(sum(w.weight * w.calc_progress), 2)             as completion_pct
    from app.task_weights w
    join public.tasks tk on tk.id = w.task_id
   where w.is_leaf
   group by w.project_id
),
ext as (
  select tk.project_id, count(*) as extensions_7d
    from public.task_extensions e join public.tasks tk on tk.id = e.task_id
   where e.granted_at > now() - interval '7 days'
   group by tk.project_id
),
expected as (
  select m.project_id, count(distinct m.user_id) as reports_expected_today
    from public.project_members m
   where m.removed_at is null and app.is_workday(app.dhaka_today())
     and exists (select 1 from public.tasks tk where tk.project_id = m.project_id and tk.assigned_to = m.user_id
                    and tk.status <> 'Completed' and not tk.archived)
   group by m.project_id
),
submitted as (
  select r.project_id, count(distinct r.user_id) as reports_submitted_today
    from public.daily_reports r where r.report_date = app.dhaka_today()
   group by r.project_id
),
members as (
  select project_id, count(*) as members_count from public.project_members where removed_at is null group by project_id
)
select p.id                                          as project_id,
       p.code, p.name, p.status,
       p.department_id, d.name::text                 as department_name,
       p.pm_id, pm.full_name                         as pm_name,
       p.start_date, p.target_end, p.is_demo,
       coalesce(l.completion_pct, 0)                 as completion_pct,
       app.project_planned_pct(p.id)                 as planned_pct,
       round(coalesce(l.completion_pct, 0) - app.project_planned_pct(p.id), 2) as schedule_variance,
       coalesce(coalesce(l.completion_pct, 0) - app.project_planned_pct(p.id) < -10, false) as behind_schedule,
       coalesce(p.target_end < app.dhaka_today() and coalesce(l.completion_pct, 0) < 100, false) as past_target,
       coalesce(l.leaves_total, 0)                   as leaves_total,
       coalesce(l.leaves_completed, 0)               as leaves_completed,
       coalesce(a.tasks_total, 0)                    as tasks_total,
       coalesce(a.open_tasks, 0)                     as open_tasks,
       coalesce(a.completed_tasks, 0)                as completed_tasks,
       coalesce(a.not_started, 0)                    as not_started,
       coalesce(a.plan_submitted, 0)                 as plan_submitted,
       coalesce(a.in_progress, 0)                    as in_progress,
       coalesce(a.blocked_tasks, 0)                  as blocked_tasks,
       coalesce(a.overdue_tasks, 0)                  as overdue_tasks,
       coalesce(a.plan_breaches, 0)                  as plan_breaches,
       coalesce(a.red_tasks, 0)                      as red_tasks,
       coalesce(a.due_today, 0)                      as due_today,
       coalesce(a.open_important, 0)                 as open_important,
       coalesce(a.open_high, 0)                      as open_high,
       coalesce(e.extensions_7d, 0)                  as extensions_7d,
       coalesce(mb.members_count, 0)                 as members_count,
       coalesce(x.reports_expected_today, 0)         as reports_expected_today,
       coalesce(sb.reports_submitted_today, 0)       as reports_submitted_today,
       (coalesce(coalesce(l.completion_pct, 0) - app.project_planned_pct(p.id) < -10, false)
        or coalesce(p.target_end < app.dhaka_today() and coalesce(l.completion_pct, 0) < 100, false)
        or (coalesce(a.open_tasks, 0) > 0 and a.overdue_tasks::numeric / a.open_tasks > 0.2)) as at_risk
  from public.projects p
  join public.departments d   on d.id = p.department_id
  left join public.profiles pm on pm.id = p.pm_id
  left join agg a       on a.project_id = p.id
  left join leaves l    on l.project_id = p.id
  left join ext e       on e.project_id = p.id
  left join expected x  on x.project_id = p.id
  left join submitted sb on sb.project_id = p.id
  left join members mb  on mb.project_id = p.id
 where not p.archived;

-- ---------- Task-level views -----------------------------------------------------------
create view public.task_flags with (security_invoker = true) as
select t.id                                                  as task_id,
       t.project_id,
       t.assigned_to,
       b.reasons,
       cardinality(b.reasons) > 0                            as is_red,
       b.reasons[1]                                          as first_reason,
       (t.status = 'Completed' and t.completed_on > t.effective_due_at) as is_late,
       (t.status <> 'Completed' and now() > t.effective_due_at)         as is_overdue,
       (t.status <> 'Completed' and t.plan_submitted_at is null and now() > t.plan_due_at) as is_plan_overdue,
       (t.status <> 'Completed'
        and (t.effective_due_at at time zone app.tz())::date = app.dhaka_today()) as is_due_today,
       app.deadline_status(t)                                as deadline_status
  from public.tasks t
  cross join lateral (select app.task_breaches(t) as reasons) b
 where not t.archived;

create view public.task_rollup with (security_invoker = true) as
select t.id           as task_id,
       t.project_id,
       t.parent_id,
       w.is_leaf,
       w.share        as sibling_share,
       w.weight       as effective_weight,
       w.calc_progress as calculated_progress
  from public.tasks t
  join app.task_weights w on w.task_id = t.id;

-- ---------- Engineer dashboard ----------------------------------------------------------
-- Assigned tasks, pending tasks and deadlines: the caller's own tasks in projects where they are a member.
create view public.v_engineer_tasks with (security_invoker = true) as
select t.id as task_id, t.project_id, p.code as project_code, p.name as project_name,
       t.code, t.title, t.type, t.parent_id, t.priority, t.status,
       t.progress_pct, w.calc_progress as calculated_progress, w.weight as effective_weight, w.is_leaf,
       t.plan_due_at, t.plan_submitted_at, t.exec_due_at, t.planned_due_at, t.extended_deadline, t.effective_due_at,
       f.deadline_status, f.is_red, f.reasons, f.is_overdue, f.is_due_today,
       (t.status in ('Not started', 'Blocked') or f.is_plan_overdue) as is_pending,
       (t.status <> 'Completed' and t.effective_due_at <= now() + interval '7 days') as due_within_7_days,
       t.last_update, t.blocker_note
  from public.tasks t
  join public.projects p        on p.id = t.project_id
  join public.task_flags f      on f.task_id = t.id
  left join app.task_weights w  on w.task_id = t.id
 where t.assigned_to = auth.uid() and not t.archived and not p.archived;

-- Completion percentage per project for the caller (share, delivered, personal progress)
create view public.v_engineer_project_progress with (security_invoker = true) as
select p.id as project_id, p.code, p.name,
       m.project_completion_pct,
       c.share_pct, c.delivered_pct, c.personal_progress,
       (select count(*) from public.tasks t where t.project_id = p.id and t.assigned_to = auth.uid()
          and t.status <> 'Completed' and not t.archived)                   as my_open_tasks,
       exists (select 1 from public.daily_reports r where r.project_id = p.id and r.user_id = auth.uid()
                  and r.report_date = app.dhaka_today())                     as report_submitted_today
  from public.projects p
  cross join lateral app.user_contribution(auth.uid(), p.id) c
  cross join lateral (select app.project_completion(p.id) as project_completion_pct) m
 where not p.archived and app.is_project_member(p.id);

-- ---------- PM dashboard ("My Projects") ------------------------------------------------
-- Projects where the caller is a PM member, plus projects of departments they head (admin: all).
create view public.v_pm_projects with (security_invoker = true) as
select m.*
  from app.project_metrics m
 where app.is_project_pm(m.project_id) or app.heads_department(m.department_id);

create view public.v_pm_team_updates with (security_invoker = true) as
select r.id as report_id, r.project_id, p.code as project_code, r.user_id, u.full_name,
       r.report_date, r.day_name, r.update_text, r.issues, r.next_task_text, r.remarks, r.submitted_at,
       (select count(*) from public.daily_report_items i where i.report_id = r.id)       as items,
       (select count(*) from public.daily_report_attachments a where a.report_id = r.id) as attachments
  from public.daily_reports r
  join public.projects p on p.id = r.project_id
  join public.profiles u on u.id = r.user_id
 where app.manages_project(r.project_id);

create view public.v_pm_team_load with (security_invoker = true) as
select pm.project_id, pr.code as project_code, pm.user_id, u.full_name, pm.member_role,
       (select count(*) from public.tasks t where t.project_id = pm.project_id and t.assigned_to = pm.user_id
          and t.status <> 'Completed' and not t.archived)                                   as open_tasks,
       (select count(*) from public.task_flags f where f.project_id = pm.project_id
          and f.assigned_to = pm.user_id and f.is_red and f.deadline_status not like 'completed%') as red_tasks,
       c.share_pct, c.delivered_pct, c.personal_progress,
       exists (select 1 from public.daily_reports r where r.project_id = pm.project_id and r.user_id = pm.user_id
                  and r.report_date = app.dhaka_today())                                    as reported_today
  from public.project_members pm
  join public.projects pr on pr.id = pm.project_id
  join public.profiles u  on u.id = pm.user_id
  cross join lateral app.user_contribution(pm.user_id, pm.project_id) c
 where pm.removed_at is null and not pr.archived and app.manages_project(pm.project_id);

-- ---------- Department Head dashboard ----------------------------------------------------
create view public.v_department_projects with (security_invoker = true) as
select m.* from app.project_metrics m where app.heads_department(m.department_id);

create view public.v_department_summary with (security_invoker = true) as
with w as (select app.dhaka_today() - s.review_window_days as from_d, app.dhaka_today() as to_d
             from public.workspace_settings s where s.id = 1)
select d.id as department_id, d.name::text as department_name,
       count(m.project_id) filter (where m.status = 'Active')                         as active_projects,
       round(avg(m.completion_pct) filter (where m.status = 'Active'), 2)             as department_progress_pct,
       count(m.project_id) filter (where m.at_risk)                                   as projects_at_risk,
       coalesce(sum(m.red_tasks), 0)                                                   as red_tasks,
       coalesce(sum(m.overdue_tasks), 0)                                               as overdue_tasks,
       (select count(*) from public.tasks t join public.projects p on p.id = t.project_id, w
         where p.department_id = d.id and not t.archived and t.status = 'Completed'
           and (t.completed_on at time zone app.tz())::date between w.from_d and w.to_d) as completed_in_window,
       (select round(100.0 * count(*) filter (where t.completed_on <= t.effective_due_at) / nullif(count(*), 0), 1)
          from public.tasks t join public.projects p on p.id = t.project_id, w
         where p.department_id = d.id and not t.archived and t.status = 'Completed'
           and (t.completed_on at time zone app.tz())::date between w.from_d and w.to_d) as on_time_pct,
       (select count(*) from public.task_extensions e join public.tasks t on t.id = e.task_id
          join public.projects p on p.id = t.project_id, w
         where p.department_id = d.id and (e.granted_at at time zone app.tz())::date between w.from_d and w.to_d) as extensions_in_window,
       (select count(*) from public.activity_log l join public.projects p on p.id = l.project_id, w
         where p.department_id = d.id and l.action = 'Red mark' and l.log_date between w.from_d and w.to_d) as red_mark_events,
       coalesce(sum(m.reports_submitted_today), 0)                                     as reports_submitted_today,
       coalesce(sum(m.reports_expected_today), 0)                                      as reports_expected_today
  from public.departments d
  left join app.project_metrics m on m.department_id = d.id
 where app.heads_department(d.id)
 group by d.id, d.name;

-- ---------- Admin dashboard ---------------------------------------------------------------
create view public.v_admin_overview with (security_invoker = true) as
select (select count(*) from public.projects where not archived)                                as projects_total,
       (select count(*) from public.projects where not archived and status = 'Active')           as projects_active,
       (select count(*) from public.projects where not archived and status = 'On hold')          as projects_on_hold,
       (select count(*) from public.projects where not archived and status = 'Completed')        as projects_completed,
       (select count(*) from public.projects where not archived and status = 'Cancelled')        as projects_cancelled,
       (select count(*) from app.project_metrics where at_risk)                                  as projects_at_risk,
       (select round(avg(completion_pct), 2) from app.project_metrics where status = 'Active')   as avg_completion_pct,
       (select count(*) from public.departments where active)                                    as departments,
       (select count(*) from public.profiles where active)                                       as users_active,
       (select count(*) from public.profiles where not active)                                   as users_inactive,
       (select count(*) from public.profiles where active and role = 'admin')                    as admins,
       (select count(*) from public.profiles where active and role = 'dept_head')                as dept_heads,
       (select count(*) from public.profiles where active and role = 'pm')                       as pms,
       (select count(*) from public.profiles where active and role = 'engineer')                 as engineers,
       (select count(*) from public.profiles p where p.active and not exists
          (select 1 from public.project_members m where m.user_id = p.id and m.removed_at is null)) as users_without_project,
       (select coalesce(sum(red_tasks), 0) from app.project_metrics)                             as red_tasks,
       (select coalesce(sum(overdue_tasks), 0) from app.project_metrics)                         as overdue_tasks,
       (select max(finished_at) from public.scan_runs where job = 'red-mark-scan')               as last_red_mark_scan,
       (select count(*) from public.scan_runs where error is not null
          and started_at > now() - interval '7 days')                                            as job_errors_7d
 where app.is_admin();
