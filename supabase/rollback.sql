-- =============================================================================
-- FSMB · Full rollback (reverse of migrations 19 → 01)
-- For LOCAL and STAGING only. Deletes every FSMB table, function, policy, job and the storage bucket
-- (with its file records). Production is never rolled back with this script: fix forward with a new
-- migration, or restore from backup (see README §6).
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback.sql
-- Then remove the rows from supabase_migrations.schema_migrations (last statement below) so that
-- `supabase db push` can apply the package again.
-- =============================================================================
begin;

-- 19 · final decisions (tables, views and app functions go with their tables / schema below)
drop function if exists public.project_performance(uuid, date, date);
drop function if exists public.admin_run_job(text);
drop function if exists public.pending_emails(int);
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end $$;

-- 18 · storage (files must be emptied through the Storage API / dashboard first on hosted projects)
drop policy if exists report_files_read         on storage.objects;
drop policy if exists report_files_upload       on storage.objects;
drop policy if exists report_files_delete       on storage.objects;
drop policy if exists report_files_admin_update on storage.objects;
drop function if exists app.can_upload_report_file(text);
delete from storage.objects where bucket_id = 'daily-report-files';
delete from storage.buckets where id = 'daily-report-files';

-- 17 · schedules
select cron.unschedule(jobid) from cron.job
 where jobname in ('fsmb-red-mark-scan', 'fsmb-red-mark-digest', 'fsmb-deadline-scan',
                   'fsmb-notify-email', 'fsmb-lock-and-purge', 'fsmb-storage-orphans');
drop function if exists app.call_edge_function(text, jsonb);

-- 16 · auth hook (disable it in Authentication → Hooks before running this)
drop policy if exists auth_admin_read_profiles on public.profiles;
drop function if exists public.custom_access_token_hook(jsonb);

-- 14 · RPC functions (15 · policies and 13 · views go with their tables / schema below)
drop function if exists public.project_engineers(uuid);
drop function if exists public.assignable_users(uuid);
drop function if exists public.project_progress(uuid);
drop function if exists public.member_contribution(uuid);
drop function if exists public.my_contribution(uuid);
drop function if exists public.save_daily_report(jsonb);
drop function if exists public.complete_task(uuid);
drop function if exists public.grant_extension(uuid, timestamptz, text);
drop function if exists public.set_task_deadline(uuid, timestamptz);
drop function if exists public.performance_summary(date, date, uuid);
drop function if exists public.my_performance(date, date);
drop function if exists public.my_dashboard();
drop function if exists public.my_projects_dashboard();
drop function if exists public.department_dashboard(uuid, date, date);
drop function if exists public.admin_dashboard();

-- 13 · public views
drop view if exists public.v_admin_overview, public.v_department_summary, public.v_department_projects,
                    public.v_pm_team_load, public.v_pm_team_updates, public.v_pm_projects,
                    public.v_engineer_project_progress, public.v_engineer_tasks,
                    public.task_rollup, public.task_flags;

-- 12 · the only trigger outside FSMB tables
drop trigger if exists on_auth_user_created on auth.users;

-- 03–09 · tables (indexes, policies and table triggers are dropped with them)
drop table if exists public.scan_runs, public.activity_log,
                     public.notification_preferences, public.notifications,
                     public.daily_report_attachments, public.daily_report_items, public.daily_reports,
                     public.task_comments, public.task_contributions, public.task_extensions, public.tasks,
                     public.project_members, public.projects,
                     public.workspace_settings, public.department_heads, public.profiles, public.departments
  cascade;

-- 10–14 · everything in the private schema (helpers, rules, jobs, app views, trigger functions)
drop schema if exists app cascade;

-- 02 · enums
drop type if exists public.log_action, public.log_scope, public.notification_type, public.breach_reason,
                    public.task_type, public.task_priority, public.task_status, public.project_status,
                    public.project_member_role, public.user_role;

-- 01 · extensions are shared with other Supabase features and are left installed
--      (pgcrypto, citext, pg_cron, pg_net). Drop them manually only on a throw-away database.

-- Seeded auth users (local / staging only)
delete from auth.users where email like '%@fsmb.local';

-- Forget the applied versions so the package can be pushed again
delete from supabase_migrations.schema_migrations where version between '20261001000001' and '20261001000019';

commit;
