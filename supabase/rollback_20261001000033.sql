-- Rollback of 20261001000033_important_to_urgent.sql
-- Run as the database owner, then: supabase migration repair --status reverted 20261001000033
-- Puts Important back on every row the migration moved, but only where the row still holds the Urgent it was
-- given (a priority someone chose since then is kept), then drops the backup table.
begin;
update public.tasks t set priority = b.old_value
  from public.priority_urgent_backup b
 where b.table_name = 'tasks' and b.row_id = t.id and t.priority = b.new_value;
update public.tasklist_rows r set priority = b.old_value
  from public.priority_urgent_backup b
 where b.table_name = 'tasklist_rows' and b.row_id = r.id and r.priority = b.new_value;
drop table public.priority_urgent_backup;
commit;
