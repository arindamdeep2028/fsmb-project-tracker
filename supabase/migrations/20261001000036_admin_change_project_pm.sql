-- =============================================================================
-- Migration 36 · Admin changes or removes a project's PM from the Persons (Members) list
--
-- public.admin_set_project_pm(p_project, p_pm) lets an ADMIN, on ANY project (membership is not needed):
--   * replace the project's PM (projects.pm_id) with another eligible person: an ACTIVE account with role
--     pm, dept_head or admin (the same rule as project_members_before_write), or
--   * remove the PM assignment (p_pm = NULL).
-- The previous PM's membership of THIS project only is ended the usual way (soft removal: removed_at /
-- removed_by, history kept). Their account and their other project assignments are not touched.
-- The integrity rule stays: a person with open (not Completed, not archived) tasks in this project can't leave
-- it, so the call fails with a clear message until those tasks are reassigned. Archived projects stay locked.
--
-- Everyone else (PM, Department Head, Engineer) gets 42501 from this function. Nothing else changes: no table,
-- column, policy or trigger is altered, and the existing project-settings and member rules work as before.
-- The new PM's membership is added by the existing projects_after_write trigger; the audit log entries
-- ("Edited · Project: pm_id", "Member removed") come from the existing triggers.
--
-- Rollback: drop function public.admin_set_project_pm(uuid, uuid);
-- =============================================================================

create or replace function public.admin_set_project_pm(p_project uuid, p_pm uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_old     uuid;
  v_open    integer;
  v_name    text;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can change or remove the project PM here' using errcode = '42501';
  end if;

  select * into v_project from public.projects where id = p_project for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_project.archived then
    raise exception 'This project is archived; restore it before changing its PM' using errcode = '23514';
  end if;

  v_old := v_project.pm_id;
  if p_pm is not distinct from v_old then
    return;                                                    -- nothing to change
  end if;

  if p_pm is not null and not exists (
       select 1 from public.profiles p where p.id = p_pm and p.active and p.role in ('pm', 'dept_head', 'admin')) then
    raise exception 'Choose an active person with role PM, Department Head or Admin' using errcode = '23514';
  end if;

  if v_old is not null then
    select count(*) into v_open from public.tasks t
     where t.project_id = p_project and t.assigned_to = v_old and t.status <> 'Completed' and not t.archived;
    if v_open > 0 then
      select full_name into v_name from public.profiles where id = v_old;
      raise exception '% has % open task(s) in this project. Reassign them before changing or removing the PM',
        coalesce(v_name, 'The current PM'), v_open using errcode = '23514';
    end if;
  end if;

  -- new PM (the projects_after_write trigger adds / restores their 'pm' membership)
  update public.projects set pm_id = p_pm where id = p_project;

  -- the previous PM leaves THIS project only (soft removal; other projects and the account untouched)
  if v_old is not null then
    update public.project_members set removed_at = now()
     where project_id = p_project and user_id = v_old and removed_at is null;
  end if;
end $$;

revoke execute on function public.admin_set_project_pm(uuid, uuid) from public, anon;
grant  execute on function public.admin_set_project_pm(uuid, uuid) to authenticated;

comment on function public.admin_set_project_pm(uuid, uuid) is
  'Admin only: replace (p_pm) or remove (NULL) the PM of any project; the previous PM leaves this project only.';
