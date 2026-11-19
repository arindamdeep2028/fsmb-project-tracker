-- Rollback of 20261001000032_responsibilities_member_edit.sql
-- Run as the database owner, then: supabase migration repair --status reverted 20261001000032
-- Puts back app.tasks_before_write exactly as migration 28 defined it and removes member_update_task and
-- tasklist_set_deadline.
-- No data to undo (the migration changed none; edits made through it stay, like any other edit).
begin;
drop function if exists public.member_update_task(uuid, jsonb);
drop function if exists public.tasklist_set_deadline(uuid, date);
create or replace function app.tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_uid      uuid := auth.uid();
  v_system   boolean := auth.uid() is null;
  v_manager  boolean;
  v_admin    boolean;
  v_changed  text[] := '{}';
  v_allowed  text[];
  v_parent   public.tasks;
  d          record;
begin
  v_admin   := v_system or app.is_admin();
  v_manager := v_system or app.manages_project(coalesce(new.project_id, old.project_id));

  if tg_op = 'UPDATE' then
    v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
    -- deadline sweep after a rules change (app.recompute_open_deadlines)
    if v_changed <@ array['updated_at'] and current_setting('app.recompute_deadlines', true) = 'on' then
      select * into d from app.compute_deadlines(new.assigned_on, new.extended_deadline, new.planned_due_at);
      new.clock_start_at := d.clock_start_at; new.plan_due_at := d.plan_due_at;
      new.exec_due_at := d.exec_due_at;       new.effective_due_at := d.effective_due_at;
      return new;
    end if;
    -- subtask-code counter bumps are internal
    if v_changed <@ array['subtask_seq', 'updated_at'] then return new; end if;
  end if;

  ------------------------------------------------------------------ INSERT
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select * into v_parent from public.tasks where id = new.parent_id;
      if not found or v_parent.project_id <> new.project_id then
        raise exception 'A subtask must belong to a task in the same project' using errcode = '23514';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'Subtasks cannot have subtasks (two levels only)' using errcode = '23514';
      end if;
      if not v_system and not app.can_see_task(new.parent_id) then
        raise exception 'You cannot add a subtask to a task you cannot see' using errcode = '42501';
      end if;
      new.type := 'Subtask';
    else
      new.type := 'Task';
    end if;

    if not v_manager then
      -- Engineer creating a task (v2 final rule): any task in a project where they are a member,
      -- assigned to themselves or an engineer member; no deadlines, no approval step.
      if not app.is_project_member(new.project_id) then
        raise exception 'You are not a member of this project' using errcode = '42501';
      end if;
      new.created_by := v_uid;          new.assigned_by := v_uid;       new.assigned_on := now();
      new.status := 'Not started';      new.plan_submitted_at := null;  new.progress_pct := 0;
      new.completed_on := null;         new.planned_due_at := null;     new.extended_deadline := null;
      new.extended_by := null;          new.contribution_locked := false;
      new.archived := false;            new.archived_at := null;        new.archived_by := null;
      new.last_update := null;          new.last_update_at := null;     new.last_update_by := null;
      new.legacy_row := null;           new.code := null;
      new.assigned_to := coalesce(new.assigned_to, v_uid);
      if new.assigned_to <> v_uid and not app.is_engineer_member(new.project_id, new.assigned_to) then
        raise exception 'Engineers can assign tasks only to themselves or to an engineer member of this project'
          using errcode = '42501';
      end if;
    elsif not v_system then
      new.created_by  := v_uid;
      new.assigned_by := coalesce(new.assigned_by, v_uid);
      if not v_admin then new.code := null; end if;           -- only admins choose codes
    end if;
    new.created_by := coalesce(new.created_by, new.assigned_by);

    if not app.user_is_member(new.assigned_to, new.project_id) then
      raise exception 'The assignee must be a current member of the project' using errcode = '23514';
    end if;

    new.subtask_seq := 0;
    if new.code is null then
      new.code := app.next_task_code(new.project_id, new.parent_id);
    elsif new.parent_id is null then                          -- imported / admin code: keep counter ahead
      update public.projects set task_seq = greatest(task_seq, coalesce(substring(new.code from '-T(\d+)$')::int, 0))
       where id = new.project_id;
    elsif right(new.code, 1) ~ '^[a-z]$' then
      update public.tasks set subtask_seq = greatest(subtask_seq, ascii(right(new.code, 1)) - 96)
       where id = new.parent_id;
    end if;

  ------------------------------------------------------------------ UPDATE
  else
    if not v_system then
      if v_changed && array['clock_start_at', 'plan_due_at', 'exec_due_at', 'effective_due_at',
                            'created_by', 'created_at', 'subtask_seq', 'legacy_row'] then
        raise exception 'Calculated and system columns cannot be written directly' using errcode = '42501';
      end if;
      if v_changed && array['code', 'project_id'] and not v_admin then
        raise exception 'Only an admin can change a task code or move a task to another project' using errcode = '42501';
      end if;
    end if;

    if not v_manager and coalesce(current_setting('app.tasklist_edit', true), '') = 'on' then
      ---------------- Tasklist edit (migration 28): any current member; name, status and priority only ----------------
      if not app.is_project_member(new.project_id) then
        raise exception 'Only members of this project can edit its Tasklist' using errcode = '42501';
      end if;
      if not (v_changed <@ array['title', 'status', 'priority', 'updated_at']) then
        raise exception 'The Tasklist cannot change: %',
          array_to_string(array(select unnest(v_changed) except select unnest(array['title', 'status', 'priority', 'updated_at'])), ', ')
          using errcode = '42501';
      end if;
      if 'status' = any (v_changed) and new.status = 'Completed' and exists (select 1 from public.tasks c where c.parent_id = old.id
                                                                             and not c.archived and c.status <> 'Completed') then
        raise exception 'Only a manager can complete a task that still has open subtasks' using errcode = '42501';
      end if;
    elsif not v_manager then
      ---------------- Engineer field guard (v2 §11) ----------------
      if old.assigned_to = v_uid then
        v_allowed := array['status', 'progress_pct', 'priority', 'blocker_note', 'plan_submitted_at',
                           'completed_on', 'last_update', 'last_update_at', 'last_update_by', 'updated_at'];
        if not old.contribution_locked then v_allowed := v_allowed || 'contribution_pct'::text; end if;
        if old.created_by = v_uid and old.status = 'Not started' then
          v_allowed := v_allowed || array['title', 'description', 'assigned_to'];
        end if;
      elsif old.created_by = v_uid then
        -- v2: contribution % on created tasks at any status unless locked;
        --     title, description and assignee only while Not started
        v_allowed := array['updated_at'];
        if not old.contribution_locked then v_allowed := v_allowed || 'contribution_pct'::text; end if;
        if old.status = 'Not started' then v_allowed := v_allowed || array['title', 'description', 'assigned_to']; end if;
      else
        raise exception 'You can only update tasks assigned to you or created by you' using errcode = '42501';
      end if;

      if not (v_changed <@ v_allowed) then
        raise exception 'Engineers cannot change: %',
          array_to_string(array(select unnest(v_changed) except select unnest(v_allowed)), ', ')
          using errcode = '42501';
      end if;

      if 'status' = any (v_changed) then
        if not (new.status = any (case old.status
               when 'Not started'    then array['Plan submitted', 'In progress', 'Blocked', 'Completed']::public.task_status[]
               when 'Plan submitted' then array['In progress', 'Blocked', 'Completed']::public.task_status[]
               when 'In progress'    then array['Blocked', 'Completed']::public.task_status[]
               when 'Blocked'        then array['In progress', 'Completed']::public.task_status[]
               else '{}'::public.task_status[] end)) then
          raise exception 'Changing status from % to % needs a PM, department head or admin', old.status, new.status
            using errcode = '42501';
        end if;
        if new.status = 'Completed' and exists (select 1 from public.tasks c where c.parent_id = old.id
                                                   and not c.archived and c.status <> 'Completed') then
          raise exception 'Only a manager can complete a task that still has open subtasks' using errcode = '42501';
        end if;
      end if;
      if 'plan_submitted_at' = any (v_changed) and (old.plan_submitted_at is not null or new.plan_submitted_at is null) then
        raise exception 'The plan submission time cannot be changed' using errcode = '42501';
      end if;
      if 'completed_on' = any (v_changed) and not ('status' = any (v_changed)) then
        raise exception 'The completion time is set by the database' using errcode = '42501';
      end if;
      if 'assigned_to' = any (v_changed) and new.assigned_to <> v_uid
         and not app.is_engineer_member(new.project_id, new.assigned_to) then
        raise exception 'Engineers can reassign only to themselves or an engineer member of this project' using errcode = '42501';
      end if;
    elsif 'assigned_to' = any (v_changed) and not app.user_is_member(new.assigned_to, new.project_id) then
      raise exception 'The assignee must be a current member of the project' using errcode = '23514';
    end if;

    -- parent change (managers only reach here with it)
    if 'parent_id' = any (v_changed) then
      if new.parent_id is not null then
        select * into v_parent from public.tasks where id = new.parent_id;
        if not found or v_parent.project_id <> new.project_id or v_parent.parent_id is not null
           or exists (select 1 from public.tasks c where c.parent_id = old.id) then
          raise exception 'Invalid parent: it must be a top-level task in the same project, and this task must have no subtasks'
            using errcode = '23514';
        end if;
        new.type := 'Subtask';
      else
        new.type := 'Task';
      end if;
    end if;

    if 'progress_pct' = any (v_changed) and new.status <> 'Completed'
       and exists (select 1 from public.tasks c where c.parent_id = old.id and not c.archived) then
      raise exception 'Progress of a task with subtasks is calculated from its subtasks' using errcode = '23514';
    end if;
  end if;

  ------------------------------------------------------------------ common rules
  if new.status = 'Completed' then
    if tg_op = 'INSERT' or old.status <> 'Completed' then
      if not v_system or new.completed_on is null then new.completed_on := now(); end if;
    end if;
    new.progress_pct := 100;
  else
    new.completed_on := null;
  end if;

  if new.status = 'Plan submitted' and new.plan_submitted_at is null then new.plan_submitted_at := now(); end if;
  if not v_admin and new.plan_submitted_at is not null
     and (tg_op = 'INSERT' or old.plan_submitted_at is null) then
    new.plan_submitted_at := now();                               -- no back-dating except by admin/system
  end if;

  if tg_op = 'UPDATE' and new.extended_deadline is distinct from old.extended_deadline then
    new.extended_by := case when new.extended_deadline is null then null else coalesce(v_uid, new.extended_by) end;
  end if;

  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := coalesce(new.archived_at, now()); new.archived_by := coalesce(new.archived_by, v_uid);
  elsif not new.archived then
    new.archived_at := null; new.archived_by := null;
  end if;

  if tg_op = 'INSERT'
     or new.assigned_on       is distinct from old.assigned_on
     or new.extended_deadline is distinct from old.extended_deadline
     or new.planned_due_at    is distinct from old.planned_due_at then
    select * into d from app.compute_deadlines(new.assigned_on, new.extended_deadline, new.planned_due_at);
    new.clock_start_at := d.clock_start_at; new.plan_due_at := d.plan_due_at;
    new.exec_due_at := d.exec_due_at;       new.effective_due_at := d.effective_due_at;
  else
    new.clock_start_at := old.clock_start_at; new.plan_due_at := old.plan_due_at;
    new.exec_due_at := old.exec_due_at;       new.effective_due_at := old.effective_due_at;
  end if;

  -- daily-update stamp: any work update by the assignee counts
  if tg_op = 'UPDATE' and not v_system and v_uid = new.assigned_to
     and v_changed && array['status', 'progress_pct', 'priority', 'blocker_note', 'contribution_pct',
                            'plan_submitted_at', 'title', 'description', 'last_update'] then
    new.last_update := app.dhaka_today(); new.last_update_at := now(); new.last_update_by := v_uid;
  end if;
  return new;
end $function$;
commit;
