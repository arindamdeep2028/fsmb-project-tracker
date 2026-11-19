-- 20261001000034_daily_updates_running_projects.sql
-- Daily updates are for running projects only. The app already offers running projects (status Active) only; the
-- database now refuses the rest too: a signed-in user other than an Admin cannot add or change a daily report, or
-- an entry of one, for a project that is halted (On hold), completed or cancelled. Admins keep their report
-- editing, and system jobs (locking, imports: no signed-in user) are not affected. Earlier reports are untouched.
-- Additive: one new function and two new triggers; no existing function is changed, no data changes.
--
-- Rollback: supabase/rollback_20261001000034.sql

create or replace function app.daily_update_running_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  if auth.uid() is null or app.is_admin() then return new; end if;
  if tg_table_name = 'daily_reports' then
    v_project := new.project_id;
  else
    select r.project_id into v_project from public.daily_reports r where r.id = new.report_id;
  end if;
  if exists (select 1 from public.projects p where p.id = v_project and p.status <> 'Active') then
    raise exception 'Daily updates are closed: this project is not running' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function app.daily_update_running_project() from public, anon, authenticated;

create trigger daily_reports_running_project before insert or update on public.daily_reports
  for each row execute function app.daily_update_running_project();
create trigger daily_report_items_running_project before insert or update on public.daily_report_items
  for each row execute function app.daily_update_running_project();
