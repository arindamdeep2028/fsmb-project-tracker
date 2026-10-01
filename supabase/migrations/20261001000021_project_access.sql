-- =============================================================================
-- Migration 21 · Project user assignment and project access
--
-- A. tasks_read          every current member of a project sees all of that project's tasks and subtasks
--                        (the project plan). Was: an engineer saw only tasks assigned to or created by them.
--                        Writing is unchanged: tasks_update_engineer + tasks_before_write still let a member
--                        work only on tasks assigned to (or created by) them. Comments, extensions and
--                        contribution history keep their app.can_see_task() scope.
-- B. assignable_users()  the "Add member" list offers every active user, not only engineer / pm accounts.
--                        project_members_before_write still decides who may hold which project role and who
--                        may add a PM (admin or department head).
-- Membership stays per project: app.can_see_project() is evaluated for each project separately, so being a
-- member of one project grants nothing in another. No tables, columns or rows change.
--
-- Rollback:
--   drop policy tasks_read on public.tasks;
--   create policy tasks_read on public.tasks for select to authenticated
--     using (app.manages_project(project_id)
--            or (app.is_project_member(project_id)
--                and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))));
--   and restore public.assignable_users from migration 14 (filter: p.role in ('engineer', 'pm')).
-- =============================================================================

-- ---------- A. Members read the whole task list of their own projects ----------
drop policy tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (app.can_see_project(project_id));

-- ---------- B. People a manager can add to a project: every active user ----------
create or replace function public.assignable_users(p_project uuid)
returns table (user_id uuid, full_name text, role public.user_role, department text, is_member boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.manages_project(p_project) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.role, d.name::text,
           exists (select 1 from public.project_members m where m.project_id = p_project
                      and m.user_id = p.id and m.removed_at is null)
      from public.profiles p left join public.departments d on d.id = p.department_id
     where p.active
     order by p.full_name;
end $$;
