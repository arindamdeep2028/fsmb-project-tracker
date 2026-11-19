-- Rollback of 20261001000034_daily_updates_running_projects.sql
-- Run as the database owner, then: supabase migration repair --status reverted 20261001000034
-- No data to undo (the migration changed none).
begin;
drop trigger if exists daily_reports_running_project on public.daily_reports;
drop trigger if exists daily_report_items_running_project on public.daily_report_items;
drop function if exists app.daily_update_running_project();
commit;
