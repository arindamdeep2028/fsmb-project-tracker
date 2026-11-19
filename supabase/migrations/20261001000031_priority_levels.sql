-- 20261001000031_priority_levels.sql
-- Priority has three levels: Normal, Important, Urgent (Urgent was added by migration 30).
--
-- The earlier levels were Important > High > Normal > Low. Important keeps its name; the two levels that no
-- longer exist move to the nearest remaining one, keeping their place relative to Normal:
--     High -> Important        Low -> Normal
-- Only the priority value changes; no row is deleted and nothing else on a task or Tasklist row is touched.
-- Every value moved is first copied to public.priority_level_backup (table, row id, old value), so the
-- rollback puts back exactly what was there. The task triggers write each change to the activity log
-- (source 'system'), and the Tasklist row trigger writes it to tasklist_row_history.
-- A check on both tables then keeps High and Low from coming back. The enum labels themselves stay (Postgres
-- cannot drop an enum value without rebuilding the type); they are simply no longer accepted.
--
-- Rollback: supabase/rollback_20261001000031.sql

create table if not exists public.priority_level_backup (
  table_name  text not null check (table_name in ('tasks', 'tasklist_rows')),
  row_id      uuid not null,
  old_value   public.task_priority not null,
  new_value   public.task_priority not null,
  moved_at    timestamptz not null default now(),
  primary key (table_name, row_id)
);
alter table public.priority_level_backup enable row level security;     -- no policies: not readable by app users
revoke all on public.priority_level_backup from public, anon, authenticated;

insert into public.priority_level_backup (table_name, row_id, old_value, new_value)
select 'tasks', id, priority, case priority when 'High' then 'Important' else 'Normal' end::public.task_priority
  from public.tasks where priority in ('High', 'Low')
on conflict do nothing;
insert into public.priority_level_backup (table_name, row_id, old_value, new_value)
select 'tasklist_rows', id, priority, case priority when 'High' then 'Important' else 'Normal' end::public.task_priority
  from public.tasklist_rows where priority in ('High', 'Low')
on conflict do nothing;

update public.tasks set priority = 'Important' where priority = 'High';
update public.tasks set priority = 'Normal'    where priority = 'Low';
update public.tasklist_rows set priority = 'Important' where priority = 'High';
update public.tasklist_rows set priority = 'Normal'    where priority = 'Low';

alter table public.tasks
  add constraint tasks_priority_level check (priority in ('Normal', 'Important', 'Urgent'));
alter table public.tasklist_rows
  add constraint tasklist_rows_priority_level check (priority in ('Normal', 'Important', 'Urgent'));
