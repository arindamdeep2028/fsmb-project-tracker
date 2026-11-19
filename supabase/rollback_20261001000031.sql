-- Rollback of 20261001000031_priority_levels.sql
-- Run as the database owner, then: supabase migration repair --status reverted 20261001000031
-- Drops the two checks and puts back every High / Low value the migration moved, but only where the row still
-- holds the value the migration gave it (a priority someone chose since then is kept).
begin;
alter table public.tasks drop constraint if exists tasks_priority_level;
alter table public.tasklist_rows drop constraint if exists tasklist_rows_priority_level;
update public.tasks t set priority = b.old_value
  from public.priority_level_backup b
 where b.table_name = 'tasks' and b.row_id = t.id and t.priority = b.new_value;
update public.tasklist_rows r set priority = b.old_value
  from public.priority_level_backup b
 where b.table_name = 'tasklist_rows' and b.row_id = r.id and r.priority = b.new_value;
drop table public.priority_level_backup;
commit;
