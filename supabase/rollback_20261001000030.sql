-- Rollback of 20261001000030_responsibilities_inline.sql
-- Run as the database owner, then: supabase migration repair --status reverted 20261001000030
-- 'Urgent' priorities become 'Important' (the nearest remaining level); the enum label itself stays unused,
-- since Postgres cannot drop an enum value without rebuilding the type.
begin;
update public.tasks set priority = 'Important' where priority = 'Urgent';
update public.tasklist_rows set priority = 'Important' where priority = 'Urgent';
drop function if exists public.set_task_end_date(uuid, date);
commit;
