-- 20261001000030_responsibilities_inline.sql
-- Responsibilities as a spreadsheet: inline cells, Normal / Important / Urgent priority, and the End Date cell.
--
-- A. Priority   task_priority gains 'Urgent'. Additive only: every existing value (Important, High, Normal, Low)
--               stays valid and no stored row is changed. The app offers Normal / Important / Urgent; a task that
--               still holds High or Low keeps it until someone picks another value.
-- B. End Date   public.set_task_end_date(task, day): the End Date / Deadline cell of Responsibilities and the
--               Deadline cell of the Tasklist (one stored deadline, so the two can never disagree). Same rule as
--               set_task_deadline: the project's PM, its Department Head or an Admin, on a live task. The deadline
--               becomes the office closing time of that Dhaka day (planned_due_at). An extension in force is a
--               deadline too: it is cleared so the date typed is the one that applies; its record stays in
--               task_extensions and the change is written to the activity log by tasks_after_write.
--               Security invoker: RLS, tasks_a_guard and tasks_before_write check the update as the caller.
--
-- Nothing else changes: status rules (a manager may move a Completed task back to any status, an engineer moves
-- forward only), progress roll-up, daily reports and RLS policies are as before.
--
-- Rollback (the enum value cannot be dropped while any row uses it):
--   update public.tasks set priority = 'Important' where priority = 'Urgent';
--   update public.tasklist_rows set priority = 'Important' where priority = 'Urgent';
--   drop function public.set_task_end_date(uuid, date);
--   (the unused 'Urgent' label may stay in the type; removing it needs the type rebuilt.)

-- ---------------------------------------------------------------- A. priority
alter type public.task_priority add value if not exists 'Urgent';

-- ---------------------------------------------------------------- B. End Date
create or replace function public.set_task_end_date(p_task uuid, p_day date) returns public.tasks
language plpgsql volatile security invoker set search_path = '' as $$
declare
  t   public.tasks;
  v   public.tasks;
  s   public.workspace_settings;
  v_due timestamptz;
begin
  select * into t from public.tasks where id = p_task;
  if not found then raise exception 'Not found, or you no longer have access to it.' using errcode = 'P0002'; end if;
  if not app.manages_project(t.project_id) then
    raise exception 'Only the project PM, the department head or an admin can set a task deadline' using errcode = '42501';
  end if;
  if t.archived then raise exception 'An archived task cannot be changed' using errcode = '42501'; end if;
  if p_day is null then raise exception 'Choose a date' using errcode = '22023'; end if;
  if p_day < date '2000-01-01' or p_day > date '2100-12-31' then
    raise exception 'Choose a date between 2000 and 2100' using errcode = '22023';
  end if;
  select * into s from public.workspace_settings where id = 1;
  v_due := app.local_at(p_day, coalesce(s.office_end, 18));
  update public.tasks
     set planned_due_at = v_due,
         extended_deadline = null
   where id = p_task
  returning * into v;
  if not found then raise exception 'Not found, or you no longer have access to it.' using errcode = 'P0002'; end if;
  return v;
end $$;

revoke execute on function public.set_task_end_date(uuid, date) from public, anon;
grant execute on function public.set_task_end_date(uuid, date) to authenticated, service_role;
