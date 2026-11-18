-- 20261001000028_tasklist_rows.sql
-- Tasklist editing for every member of the project (Admin, Department Head, Project Manager, Engineer).
--
-- A. Tasklist rows     public.tasklist_rows: rows added on the Tasklist with "Add rows" (one or many at once), blank
--                      until filled in. They are sheet rows, NOT tasks: no code, no owner, no deadline clock, no red
--                      marks, nothing on Responsibilities or Performance. Every change is kept in
--                      tasklist_row_history; a row can be removed only if it was never filled in.
--                      public.tasklist_row_assignees: the Assigned Person chips of a row (several people).
-- B. Task rows         public.tasklist_update_task(task, patch): the Tasklist's edit of an existing task's name,
--                      status and priority by any current member of the project (managers keep their existing
--                      rights). It sets app.tasklist_edit for tasks_before_write, which then allows exactly those
--                      columns for an engineer member, on any task of the project. Deadlines, owner, code, parent
--                      (phase), progress history and the activity log are untouched / written as before.
-- C. People/Comments   task_assignees insert/delete and task_list_comments insert/update (migration 27) widen from
--                      managers (+ owner/co-assignees for comments) to every current member of the project.
-- D. Category          every Tasklist line is a "General Task" (default) or an "Urgent Task": tasklist_rows.category,
--                      and public.task_list_categories for the project's existing tasks (no row = General). Separate
--                      from Priority. A task's category change is written to the activity log.
-- All of it: only while the project is not archived. Reading stays app.can_see_project.
--
-- Rollback:
--   drop function public.tasklist_update_task(uuid, jsonb), public.tasklist_add_rows(uuid, int, uuid, text);
--   drop table public.task_list_categories, public.tasklist_row_history, public.tasklist_row_assignees, public.tasklist_rows;
--   drop function app.task_list_categories_before_write(), app.task_list_categories_after_write();
--   drop function app.can_edit_tasklist(uuid), app.tasklist_row_project(uuid), app.tasklist_rows_before_write(),
--                 app.tasklist_rows_after_write(), app.tasklist_row_assignees_before_insert(),
--                 app.tasklist_row_assignees_after_insert();
--   then re-run the task_assignees / task_list_comments policy block and app.can_comment_task_list of migration 27,
--   and app.tasks_before_write of the migration that last defined it (this file only adds the tasklist branch).

-- ---------------------------------------------------------------- helpers
-- Who may change the project's Tasklist: its managers and its current members, while the project is live.
create or replace function app.can_edit_tasklist(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_project is not null
     and exists (select 1 from public.projects p where p.id = p_project and not p.archived)
     and (app.manages_project(p_project) or app.is_project_member(p_project));
$$;

-- ---------------------------------------------------------------- A. Tasklist rows
create table public.tasklist_rows (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  -- the phase heading it sits under: a top-level task of the project (null = General tasks)
  phase_task_id  uuid references public.tasks (id) on delete set null,
  position       integer not null,
  title          text not null default '' constraint tasklist_row_title_length check (length(title) <= 300),
  status         public.task_status not null default 'Not started',
  priority       public.task_priority not null default 'Normal',
  category       text not null default 'General' constraint tasklist_row_category check (category in ('General', 'Urgent')),
  comment        text not null default '' constraint tasklist_row_comment_length check (length(comment) <= 500),
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint tasklist_row_position unique (project_id, position)
);
alter table public.tasklist_rows enable row level security;
create index tasklist_rows_phase_idx on public.tasklist_rows (phase_task_id);

create table public.tasklist_row_assignees (
  row_id    uuid not null references public.tasklist_rows (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (row_id, user_id)
);
alter table public.tasklist_row_assignees enable row level security;
create index tasklist_row_assignees_user_idx on public.tasklist_row_assignees (user_id);

-- every edit of a row: the changed fields before and after
create table public.tasklist_row_history (
  id          bigint generated always as identity primary key,
  row_id      uuid not null references public.tasklist_rows (id) on delete cascade,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now(),
  before      jsonb not null,
  after       jsonb not null
);
alter table public.tasklist_row_history enable row level security;
create index tasklist_row_history_row_idx on public.tasklist_row_history (row_id, changed_at);

create or replace function app.tasklist_row_project(p_row uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.project_id from public.tasklist_rows r where r.id = p_row;
$$;

create or replace function app.tasklist_rows_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ph public.tasks;
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.position <> old.position or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at then
      raise exception 'Only the row''s cells can change' using errcode = '42501';
    end if;
  end if;
  new.title := btrim(coalesce(new.title, ''));
  new.comment := btrim(coalesce(new.comment, ''));
  if new.phase_task_id is not null and (tg_op = 'INSERT' or new.phase_task_id is distinct from old.phase_task_id) then
    select * into ph from public.tasks where id = new.phase_task_id;
    if not found or ph.project_id <> new.project_id or ph.parent_id is not null or ph.archived then
      raise exception 'The phase must be a main task of this project' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if (new.title, new.comment, new.status, new.priority, new.category, new.phase_task_id)
       is not distinct from (old.title, old.comment, old.status, old.priority, old.category, old.phase_task_id) then
      return null;                                                      -- nothing changed
    end if;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  return new;
end $$;
create trigger tasklist_rows_before_write before insert or update on public.tasklist_rows
  for each row execute function app.tasklist_rows_before_write();

create or replace function app.tasklist_rows_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb := '{}'; a jsonb := '{}'; k text;
begin
  if tg_op = 'DELETE' then
    perform app.log_event('Deleted', old.project_id, null, null, 'Removed a blank Tasklist row');
    return null;
  end if;
  foreach k in array array['title', 'status', 'priority', 'category', 'comment', 'phase_task_id'] loop
    if to_jsonb(old) -> k is distinct from to_jsonb(new) -> k then
      b := b || jsonb_build_object(k, to_jsonb(old) -> k); a := a || jsonb_build_object(k, to_jsonb(new) -> k);
    end if;
  end loop;
  if a <> '{}' then
    insert into public.tasklist_row_history (row_id, changed_by, before, after) values (new.id, auth.uid(), b, a);
  end if;
  return null;
end $$;
create trigger tasklist_rows_after_write after update or delete on public.tasklist_rows
  for each row execute function app.tasklist_rows_after_write();

create or replace function app.tasklist_row_assignees_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid := app.tasklist_row_project(new.row_id);
begin
  if v_project is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if not app.user_is_member(new.user_id, v_project) then
    raise exception 'The person must be a current member of the project' using errcode = '23514';
  end if;
  new.added_by := coalesce(auth.uid(), new.added_by); new.added_at := now();
  return new;
end $$;
create trigger tasklist_row_assignees_before_insert before insert on public.tasklist_row_assignees
  for each row execute function app.tasklist_row_assignees_before_insert();

create or replace function app.tasklist_row_assignees_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.tasklist_rows;
begin
  select * into r from public.tasklist_rows where id = new.row_id;
  insert into public.notifications (user_id, type, title, body, project_id, link)
  values (new.user_id, 'task_assigned', 'Added to a Tasklist row', left(coalesce(nullif(r.title, ''), '(not named yet)'), 2000),
          r.project_id, '/projects/' || r.project_id || '/tasklist');
  perform app.log_event('Assigned', r.project_id, null, new.user_id,
    'Added to Tasklist row: ' || left(coalesce(nullif(r.title, ''), '(not named yet)'), 200));
  return null;
end $$;
create trigger tasklist_row_assignees_after_insert after insert on public.tasklist_row_assignees
  for each row execute function app.tasklist_row_assignees_after_insert();

create policy tasklist_rows_read on public.tasklist_rows for select to authenticated
  using (app.can_see_project(project_id));
create policy tasklist_rows_update on public.tasklist_rows for update to authenticated
  using (app.can_edit_tasklist(project_id)) with check (app.can_edit_tasklist(project_id));
-- only a row never filled in (no name, comment or people, and no edit history) can be removed again
create policy tasklist_rows_delete on public.tasklist_rows for delete to authenticated
  using (app.can_edit_tasklist(project_id) and title = '' and comment = ''
         and not exists (select 1 from public.tasklist_row_assignees a where a.row_id = tasklist_rows.id)
         and not exists (select 1 from public.tasklist_row_history h where h.row_id = tasklist_rows.id));
-- rows are added with tasklist_add_rows (no insert policy)

create policy tasklist_row_assignees_read on public.tasklist_row_assignees for select to authenticated
  using (app.can_see_project(app.tasklist_row_project(row_id)));
create policy tasklist_row_assignees_insert on public.tasklist_row_assignees for insert to authenticated
  with check (app.can_edit_tasklist(app.tasklist_row_project(row_id)));
create policy tasklist_row_assignees_delete on public.tasklist_row_assignees for delete to authenticated
  using (app.can_edit_tasklist(app.tasklist_row_project(row_id)));

create policy tasklist_row_history_read on public.tasklist_row_history for select to authenticated
  using (app.can_see_project(app.tasklist_row_project(row_id)));

-- Add 1–50 blank rows at the end of the project's Tasklist (under a phase, or General tasks), as General or Urgent
-- tasks. Returns their ids.
create or replace function public.tasklist_add_rows(p_project uuid, p_count int, p_phase uuid default null,
                                                    p_category text default 'General')
returns setof uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_pos int;
begin
  if not app.can_see_project(p_project) then raise exception 'Not found' using errcode = 'P0002'; end if;
  if not app.can_edit_tasklist(p_project) then
    raise exception 'Only members of this project can add Tasklist rows' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 50 then
    raise exception 'Add 1 to 50 rows at a time' using errcode = '22023';
  end if;
  if coalesce(p_category, '') not in ('General', 'Urgent') then
    raise exception 'The category is General or Urgent' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tasklist:' || p_project::text, 0));
  select coalesce(max(position), 0) into v_pos from public.tasklist_rows where project_id = p_project;
  perform app.log_event('Edited', p_project, null, null,
    'Added ' || p_count || ' Tasklist row' || case when p_count = 1 then '' else 's' end);
  return query
    insert into public.tasklist_rows (project_id, phase_task_id, position, category, created_by, updated_by)
    select p_project, p_phase, v_pos + g, p_category, auth.uid(), auth.uid() from generate_series(1, p_count) g
    returning id;
end $$;

-- ---------------------------------------------------------------- B. existing tasks from the Tasklist
create or replace function public.tasklist_update_task(p_task uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare t public.tasks; k text;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not app.can_see_project(t.project_id) then raise exception 'Not found' using errcode = 'P0002'; end if;
  if t.archived or not app.can_edit_tasklist(t.project_id) then
    raise exception 'Only members of this project can edit its Tasklist' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(coalesce(p, '{}')) loop
    if k not in ('title', 'status', 'priority') then
      raise exception 'The Tasklist cannot change %', k using errcode = '22023';
    end if;
  end loop;
  if p ? 'title' and btrim(coalesce(p ->> 'title', '')) = '' then
    raise exception 'A task needs a name' using errcode = '23514';
  end if;
  perform set_config('app.tasklist_edit', 'on', true);
  update public.tasks set
    title    = case when p ? 'title'    then btrim(p ->> 'title') else title end,
    status   = case when p ? 'status'   then (p ->> 'status')::public.task_status else status end,
    priority = case when p ? 'priority' then (p ->> 'priority')::public.task_priority else priority end
  where id = p_task;
  perform set_config('app.tasklist_edit', '', true);
end $$;

-- tasks_before_write: as before, plus the Tasklist branch for an engineer member (marked "migration 28").
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

-- ---------------------------------------------------------------- C. people and comments on task rows
create or replace function app.can_comment_task_list(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_edit_tasklist(app.task_project(p_task));
$$;

drop policy task_assignees_insert on public.task_assignees;
drop policy task_assignees_delete on public.task_assignees;
create policy task_assignees_insert on public.task_assignees for insert to authenticated
  with check (app.can_edit_tasklist(app.task_project(task_id)));
create policy task_assignees_delete on public.task_assignees for delete to authenticated
  using (app.can_edit_tasklist(app.task_project(task_id)));

-- ---------------------------------------------------------------- D. category of existing tasks
create table public.task_list_categories (
  task_id     uuid primary key references public.tasks (id) on delete cascade,
  category    text not null constraint task_list_category check (category in ('General', 'Urgent')),
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.task_list_categories enable row level security;

create or replace function app.task_list_categories_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.task_id <> old.task_id then
    raise exception 'The task of a category cannot change' using errcode = '42501';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  return new;
end $$;
create trigger task_list_categories_before_write before insert or update on public.task_list_categories
  for each row execute function app.task_list_categories_before_write();

-- history: each change of a task's category goes to the activity log
create or replace function app.task_list_categories_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_old text := case when tg_op = 'UPDATE' then old.category else 'General' end;
begin
  if v_old = new.category then return null; end if;
  select * into t from public.tasks where id = new.task_id;
  perform app.log_event('Edited', t.project_id, t.id, t.assigned_to,
    'Tasklist category: ' || v_old || ' Task → ' || new.category || ' Task');
  return null;
end $$;
create trigger task_list_categories_after_write after insert or update on public.task_list_categories
  for each row execute function app.task_list_categories_after_write();

create policy task_list_categories_read on public.task_list_categories for select to authenticated
  using (app.can_see_project(app.task_project(task_id)));
create policy task_list_categories_insert on public.task_list_categories for insert to authenticated
  with check (app.can_edit_tasklist(app.task_project(task_id)));
create policy task_list_categories_update on public.task_list_categories for update to authenticated
  using (app.can_edit_tasklist(app.task_project(task_id))) with check (app.can_edit_tasklist(app.task_project(task_id)));
-- no delete: a category is changed, not removed

-- ---------------------------------------------------------------- grants
revoke all on public.tasklist_rows, public.tasklist_row_assignees, public.tasklist_row_history, public.task_list_categories
  from anon, authenticated;
grant select on public.tasklist_rows, public.tasklist_row_assignees, public.tasklist_row_history, public.task_list_categories
  to authenticated;
grant update (phase_task_id, title, status, priority, category, comment), delete on public.tasklist_rows to authenticated;
grant insert (task_id, category), update (category) on public.task_list_categories to authenticated;
grant all on public.task_list_categories to service_role;
grant insert (row_id, user_id), delete on public.tasklist_row_assignees to authenticated;
grant all on public.tasklist_rows, public.tasklist_row_assignees, public.tasklist_row_history to service_role;

revoke execute on function app.tasklist_rows_before_write(), app.tasklist_rows_after_write(),
  app.tasklist_row_assignees_before_insert(), app.tasklist_row_assignees_after_insert(),
  app.task_list_categories_before_write(), app.task_list_categories_after_write() from public, anon, authenticated;
revoke execute on function app.can_edit_tasklist(uuid), app.tasklist_row_project(uuid) from public, anon;
grant execute on function app.can_edit_tasklist(uuid), app.tasklist_row_project(uuid) to authenticated, service_role;
revoke execute on function public.tasklist_add_rows(uuid, int, uuid, text), public.tasklist_update_task(uuid, jsonb) from public, anon;
grant execute on function public.tasklist_add_rows(uuid, int, uuid, text), public.tasklist_update_task(uuid, jsonb) to authenticated, service_role;
