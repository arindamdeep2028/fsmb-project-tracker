-- =============================================================================
-- FSMB · Migration 21: project user assignment, project access and the daily update (pgTAP).
-- Requires seed.sql. One transaction, rolled back. Impersonation as in 001_rls.test.sql.
-- Story: the admin adds Masrur (P01 only) to P03; P03's PM assigns him a task; he works on it and
-- submits the daily update. Membership of P03 grants nothing in P02.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated, anon;

-- personas: admin …0001 | dept head morsalin …0002 (R&D) | PM P03 peash …0004 | Masrur …0013 (P01) | Anik …0018
-- projects: P01 aaaa…0001 | P02 aaaa…0002 | P03 aaaa…0003 (task P03-T01 bbbb…0301, Rafi)

-------------------------------------------------------------------------- before: not a member
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0,
          'Before being added, the user cannot see the project');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0,
          'Before being added, the user cannot see its tasks');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000003', 'update_text', 'x'))$$,
          '42501', null, 'A non-member cannot submit a daily update for the project');

-------------------------------------------------------------------------- admin: add any active user to any project
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select ok((select count(*) from public.assignable_users('aaaaaaaa-0000-0000-0000-000000000003')
            where role in ('admin', 'dept_head')) > 0,
          'The add-member list offers every active user, including department heads and admins');
select ok(not exists (select 1 from public.assignable_users('aaaaaaaa-0000-0000-0000-000000000003') a
                        join public.profiles p on p.id = a.user_id where not p.active),
          'The add-member list offers active users only');
select lives_ok($$insert into public.project_members (project_id, user_id, member_role)
                  values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000013', 'engineer')$$,
          'Admin adds an existing engineer to a project of another department');
select lives_ok($$insert into public.project_members (project_id, user_id, member_role)
                  values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'pm')$$,
          'Admin adds a department head (of another department) to a project as PM');

-------------------------------------------------------------------------- PM of the project
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');
select ok((select count(*) from public.assignable_users('aaaaaaaa-0000-0000-0000-000000000003')) > 0,
          'The project PM gets the add-member list');
select throws_ok($$select * from public.assignable_users('aaaaaaaa-0000-0000-0000-000000000002')$$,
          '42501', null, 'A PM gets no add-member list for a project they don''t manage');
select lives_ok($$insert into public.project_members (project_id, user_id, member_role)
                  values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000015', 'engineer')$$,
          'The project PM adds an existing engineer');
select lives_ok($$insert into public.tasks (project_id, title, assigned_to, assigned_by)
                  values ('aaaaaaaa-0000-0000-0000-000000000003', 'Flash verification', '11111111-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000004')$$,
          'The PM assigns a task to the newly added member');

-------------------------------------------------------------------------- the added member
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select is((select array_agg(code order by code) from public.projects), array['P01', 'P03'],
          'After being added, the project is visible next to the user''s other project');
select is((select count(*)::int from public.v_engineer_project_progress where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 1,
          'The project appears on the user''s dashboard');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 2,
          'The member sees every task of the project, including other people''s');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
          'Membership of P03 grants nothing in P02 (project)');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
          'Membership of P03 grants nothing in P02 (tasks)');
select is_empty($$update public.tasks set title = 'hijack' where id = 'bbbbbbbb-0000-0000-0000-000000000301' returning 1$$,
          'Seeing a colleague''s task does not allow changing it');
select lives_ok($$update public.tasks set status = 'In progress' where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'
                    and title = 'Flash verification'$$,
          'The member works on the task assigned to them');
select lives_ok($$select public.save_daily_report(jsonb_build_object(
                    'project_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                    'update_text', E'a. read the flash map\nb. wrote the verify loop',
                    'issues', 'No board yet', 'next_task_text', 'Run on hardware', 'remarks', 'On track',
                    'items', jsonb_build_array(jsonb_build_object(
                      'task_id', (select id from public.tasks where title = 'Flash verification'), 'status_after', 'Blocked'))))$$,
          'The member submits the daily update with a main task and status');
select is((select status::text from public.tasks where title = 'Flash verification'), 'Blocked',
          'The daily update''s status is applied to the main task');
select is((select count(*)::int from public.daily_reports where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'
             and user_id = auth.uid() and issues = 'No board yet' and next_task_text = 'Run on hardware' and remarks = 'On track'), 1,
          'Issues, next task and remarks are stored on the day''s row');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000003', 'update_text', 'x',
                    'items', jsonb_build_array(jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000301'))))$$,
          '42501', null, 'A colleague''s task cannot be the main task of my daily update');

-------------------------------------------------------------------------- a colleague in the same project
select pg_temp.act_as('11111111-0000-0000-0000-000000000017');
select is((select count(*)::int from public.daily_reports where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'
             and user_id = '11111111-0000-0000-0000-000000000013'), 1,
          'Project members read each other''s daily updates');

-------------------------------------------------------------------------- removed again
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
update public.project_members set removed_at = now()
 where project_id = 'aaaaaaaa-0000-0000-0000-000000000003' and user_id = '11111111-0000-0000-0000-000000000015';
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0,
          'A removed member no longer sees the project''s tasks');

select * from finish();
rollback;
