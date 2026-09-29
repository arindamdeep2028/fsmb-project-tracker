-- =============================================================================
-- Migration 10 · Access helpers (Implementation Blueprint §6.1, functions 1–14)
--
-- Every helper is SECURITY DEFINER + STABLE with an empty search_path, so RLS policies can call
-- it without recursive policy checks. Each scope rule exists twice:
--   app.user_*(uid, …)  – for a given user (used by notifications and triggers)
--   app.*(…)            – for the caller, auth.uid() (used by RLS policies)
-- Inactive users match nothing. Admin (Department Head in their departments) always passes.
-- =============================================================================

-- ---------- Time and settings -------------------------------------------------
create or replace function app.tz() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.timezone from public.workspace_settings s where s.id = 1), 'Asia/Dhaka');
$$;

create or replace function app.dhaka_today() returns date                                   -- (1)
language sql stable security definer set search_path = '' as $$
  select (now() at time zone app.tz())::date;
$$;

create or replace function app.is_workday(d date) returns boolean                            -- (2)
language sql stable security definer set search_path = '' as $$
  select extract(isodow from d)::smallint = any (
    coalesce((select s.workdays from public.workspace_settings s where s.id = 1), '{1,2,3,4,5}'::smallint[]));
$$;

-- ---------- Per-user core rules ------------------------------------------------
create or replace function app.user_is_active(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and p.active);
$$;

create or replace function app.user_is_admin(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and p.active and p.role = 'admin');
$$;

create or replace function app.user_heads_department(p_uid uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_admin(p_uid)
      or exists (select 1
                   from public.department_heads dh
                   join public.profiles p on p.id = dh.user_id
                  where dh.department_id = p_dept and dh.user_id = p_uid and p.active);
$$;

create or replace function app.user_is_member(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.project_members m
                   join public.profiles p on p.id = m.user_id
                  where m.project_id = p_project and m.user_id = p_uid
                    and m.removed_at is null and p.active);
$$;

create or replace function app.user_is_pm(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.project_members m
                   join public.profiles p on p.id = m.user_id
                  where m.project_id = p_project and m.user_id = p_uid
                    and m.member_role = 'pm' and m.removed_at is null and p.active);
$$;

create or replace function app.user_manages_project(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_admin(p_uid)
      or app.user_is_pm(p_uid, p_project)
      or exists (select 1 from public.projects pr
                  where pr.id = p_project and app.user_heads_department(p_uid, pr.department_id));
$$;

create or replace function app.user_can_see_project(p_uid uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_manages_project(p_uid, p_project) or app.user_is_member(p_uid, p_project);
$$;

create or replace function app.user_can_see_task(p_uid uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t
                  where t.id = p_task
                    and (app.user_manages_project(p_uid, t.project_id)
                         or (app.user_is_member(p_uid, t.project_id)
                             and (t.assigned_to = p_uid or t.created_by = p_uid))));
$$;

-- ---------- Caller wrappers used by RLS policies (functions 3–14) ------------------
create or replace function app.current_app_role() returns public.user_role                 -- (3)
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active;
$$;

create or replace function app.is_active_user() returns boolean                             -- (4)
language sql stable security definer set search_path = '' as $$ select app.user_is_active(auth.uid()); $$;

create or replace function app.is_admin() returns boolean                                   -- (5)
language sql stable security definer set search_path = '' as $$ select app.user_is_admin(auth.uid()); $$;

create or replace function app.heads_department(p_dept uuid) returns boolean                 -- (6)
language sql stable security definer set search_path = '' as $$ select app.user_heads_department(auth.uid(), p_dept); $$;

create or replace function app.is_project_member(p_project uuid) returns boolean             -- (7)
language sql stable security definer set search_path = '' as $$ select app.user_is_member(auth.uid(), p_project); $$;

create or replace function app.is_project_pm(p_project uuid) returns boolean                 -- (8)
language sql stable security definer set search_path = '' as $$ select app.user_is_pm(auth.uid(), p_project); $$;

create or replace function app.manages_project(p_project uuid) returns boolean               -- (9)
language sql stable security definer set search_path = '' as $$ select app.user_manages_project(auth.uid(), p_project); $$;

create or replace function app.can_see_project(p_project uuid) returns boolean               -- (10)
language sql stable security definer set search_path = '' as $$ select app.user_can_see_project(auth.uid(), p_project); $$;

create or replace function app.can_see_task(p_task uuid) returns boolean                     -- (11)
language sql stable security definer set search_path = '' as $$ select app.user_can_see_task(auth.uid(), p_task); $$;

create or replace function app.is_engineer_member(p_project uuid, p_uid uuid) returns boolean -- (12)
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.project_members m
                   join public.profiles p on p.id = m.user_id
                  where m.project_id = p_project and m.user_id = p_uid
                    and m.member_role = 'engineer' and m.removed_at is null and p.active);
$$;

create or replace function app.shares_project_with(p_uid uuid) returns boolean               -- (13)
language sql stable security definer set search_path = '' as $$
  select app.is_active_user()
     and exists (select 1
                   from public.project_members a
                   join public.project_members b on b.project_id = a.project_id
                  where a.user_id = auth.uid() and b.user_id = p_uid
                    and a.removed_at is null and b.removed_at is null);
$$;

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

-- ---------- Small lookups used by policies on child tables ------------------------
create or replace function app.task_project(p_task uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.project_id from public.tasks t where t.id = p_task;
$$;

create or replace function app.report_project(p_report uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.project_id from public.daily_reports r where r.id = p_report;
$$;

create or replace function app.can_see_report(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_see_project(app.report_project(p_report));
$$;

-- True when the caller wrote the report and it is still editable (same day, not locked).
create or replace function app.owns_open_report(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.daily_reports r
                  where r.id = p_report and r.user_id = auth.uid()
                    and not r.locked and r.report_date = app.dhaka_today()
                    and app.is_active_user());
$$;

-- Storage path helpers: '{project_id}/{report_id}/{file}' → uuid of segment n, null if not a uuid.
create or replace function app.path_uuid(p_name text, p_idx int) returns uuid
language plpgsql immutable set search_path = '' as $$
declare v text := split_part(p_name, '/', p_idx);
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
end $$;
