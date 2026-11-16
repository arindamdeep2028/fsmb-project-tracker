-- =============================================================================
-- Migration 25 · Task-row attachments (screenshots and photos of one task in a daily update)
--
-- An attachment of a daily report may now also name the task (row) of that report it belongs to. It stays a
-- report attachment in every other way: same Storage bucket and path {project}/{report}/…, same Storage and
-- table policies, same limits (10 files per report, 10 MB, the type list), same clean-up jobs.
--
-- The link is a foreign key to the report's own task entry (daily_report_items: unique report_id, task_id), so
-- the database itself guarantees a file is only ever linked to a task listed in that report. Engineers can list
-- only their own tasks and subtasks in their own open report (items triggers + RLS), so they can attach to a task
-- only where they are authorised. When a task is taken out of the report, its files stay on the report and lose
-- only the task link (ON DELETE SET NULL (task_id)); nothing is deleted. Existing rows keep task_id = NULL.
--
-- Rollback (no data loss for report attachments):
--   alter table public.daily_report_attachments drop constraint daily_report_attachments_task_row_fkey;
--   drop index if exists public.daily_report_attachments_task_idx;
--   alter table public.daily_report_attachments drop column task_id;
-- =============================================================================

alter table public.daily_report_attachments add column task_id uuid;

alter table public.daily_report_attachments
  add constraint daily_report_attachments_task_row_fkey
  foreign key (report_id, task_id) references public.daily_report_items (report_id, task_id)
  on delete set null (task_id);

create index daily_report_attachments_task_idx on public.daily_report_attachments (task_id) where task_id is not null;

comment on column public.daily_report_attachments.task_id is
  'The task row of the report this file belongs to (one of the report''s daily_report_items), or NULL for the whole report.';

-- the column grants mirror the table's other columns (security hardening grants per column)
grant select (task_id), insert (task_id) on public.daily_report_attachments to authenticated;
grant select (task_id), insert (task_id), update (task_id), references (task_id) on public.daily_report_attachments to service_role;
