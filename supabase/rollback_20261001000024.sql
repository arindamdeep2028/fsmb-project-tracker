-- =============================================================================
-- Rollback of migration 24 (project categories and status history). Drops only what migration 24 added.
-- Projects, members, tasks, reports, attachments and logs are not touched; project statuses keep their
-- current values. THIS DISCARDS each project's category and its status history rows.
--
-- Apply only if migration 24 has to be undone, and only together with the app release before it:
--   psql "$DATABASE_URL" -1 -f supabase/rollback_20261001000024.sql
--   supabase migration repair --status reverted 20261001000024
-- =============================================================================
begin;

drop function if exists public.set_project_status(uuid, public.project_status, text);

drop trigger if exists projects_record_status on public.projects;
drop trigger if exists projects_status_guard on public.projects;
drop trigger if exists projects_category_guard on public.projects;
drop function if exists app.projects_record_status();
drop function if exists app.projects_status_guard();
drop function if exists app.projects_category_guard();
drop function if exists app.project_status_label(public.project_status);

drop table if exists public.project_status_history;

drop index if exists public.projects_category_idx;
alter table public.projects drop column if exists category;
drop type if exists public.project_category;

commit;
