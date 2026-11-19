-- 20261001000033_important_to_urgent.sql
-- Every task (archived ones included) and every Tasklist row whose priority is Important becomes Urgent, so red
-- (Urgent) marks the tasks that were at the top level. Only the priority changes: assignments, deadlines,
-- statuses, progress and every other column stay as they are; no row is added or removed.
--
-- Safe and repeatable: the whole step runs once. The old values are first copied to
-- public.priority_urgent_backup (table, row id, old and new value); when that table already exists the step has
-- been done and nothing happens, so a priority someone chooses later is never moved by a second run.
-- The task triggers write each change to the activity log (source 'system'); the Tasklist row trigger writes it
-- to tasklist_row_history. Other tables only show the task's priority (v_engineer_tasks is a view of tasks).
--
-- Rollback: supabase/rollback_20261001000033.sql

do $$
begin
  if to_regclass('public.priority_urgent_backup') is not null then
    raise notice 'Important -> Urgent was already applied; nothing to do';
    return;
  end if;

  create table public.priority_urgent_backup (
    table_name  text not null check (table_name in ('tasks', 'tasklist_rows')),
    row_id      uuid not null,
    old_value   public.task_priority not null,
    new_value   public.task_priority not null,
    moved_at    timestamptz not null default now(),
    primary key (table_name, row_id)
  );
  alter table public.priority_urgent_backup enable row level security;    -- no policies: not readable by app users
  revoke all on public.priority_urgent_backup from public, anon, authenticated;

  insert into public.priority_urgent_backup (table_name, row_id, old_value, new_value)
  select 'tasks', id, priority, 'Urgent' from public.tasks where priority = 'Important';
  insert into public.priority_urgent_backup (table_name, row_id, old_value, new_value)
  select 'tasklist_rows', id, priority, 'Urgent' from public.tasklist_rows where priority = 'Important';

  update public.tasks t set priority = 'Urgent'
    from public.priority_urgent_backup b
   where b.table_name = 'tasks' and b.row_id = t.id and t.priority = 'Important';
  update public.tasklist_rows r set priority = 'Urgent'
    from public.priority_urgent_backup b
   where b.table_name = 'tasklist_rows' and b.row_id = r.id and r.priority = 'Important';
end $$;
