-- =============================================================================
-- FSMB · RLS and workflow tests (pgTAP). Run with:  supabase test db
-- Requires seed.sql (fixed persona UUIDs). Everything runs in one transaction and is rolled back.
-- Impersonation: set the JWT claims, then `set local role authenticated` — exactly what PostgREST does.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated, anon;

-- personas
--  admin  …0001 | dept head (R&D, PM P01) …0002 | PM P02 …0003 | PM P03 …0004
--  Shorif …0011 (P01) | Imam …0012 (P01+P02) | Deep …0014 (P01, removed from P02) | Anik …0018 inactive
-- projects P01 aaaa…0001 (R&D) | P02 aaaa…0002 (Mechanical) | P03 aaaa…0003 (Software)

-------------------------------------------------------------------------- Department Head
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select is((select count(*)::int from public.projects), 1, 'DH sees only the projects of the department they head');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 6,
          'DH sees every task of a department project');
select is((select count(*)::int from public.tasks where project_id <> 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
          'DH sees no task outside the department');
select is((select count(*)::int from public.v_department_projects), 1, 'Department dashboard view is scoped');
select throws_ok($$insert into public.projects (code, name, department_id) values ('X01', 'Other dept', 'd0000000-0000-0000-0000-000000000003')$$,
          '42501', null, 'DH cannot create a project in another department');
select lives_ok($$insert into public.projects (code, name, department_id) values ('P90', 'R&D test project', 'd0000000-0000-0000-0000-000000000005')$$,
          'DH can create a project in the department they head');
select lives_ok($$select public.department_dashboard()$$, 'DH can open the department dashboard');

-------------------------------------------------------------------------- PM
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select is((select array_agg(code order by code) from public.projects), array['P02'], 'PM sees only the managed project');
select is((select count(*)::int from public.tasks), 3, 'PM sees all tasks of the managed project and nothing else');
select lives_ok($$select public.grant_extension('bbbbbbbb-0000-0000-0000-000000000201', now() + interval '4 days', 'Supplier delay')$$,
          'PM can grant an extension in the managed project');
select throws_ok($$select public.grant_extension('bbbbbbbb-0000-0000-0000-000000000101', now() + interval '4 days', 'x')$$,
          '42501', null, 'PM cannot grant an extension in another project');
select lives_ok($$select public.set_task_deadline('bbbbbbbb-0000-0000-0000-000000000202', now() + interval '6 days')$$,
          'PM can set a task deadline manually (approved decision)');
select ok((select effective_due_at > now() + interval '5 days' from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000202'),
          'Manual deadline becomes the effective deadline');
select throws_ok($$update public.projects set department_id = 'd0000000-0000-0000-0000-000000000005' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
          '42501', null, 'PM cannot move the project to another department');
select throws_ok($$update public.project_members set removed_at = now() where project_id = 'aaaaaaaa-0000-0000-0000-000000000002' and user_id = '11111111-0000-0000-0000-000000000012'$$,
          '23514', null, 'A member with open tasks cannot be removed');
select is((select count(*)::int from public.v_pm_projects), 1, 'PM dashboard view is scoped to managed projects');

-------------------------------------------------------------------------- Engineer (Shorif, P01 only)
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');
select is((select array_agg(code) from public.projects), array['P01'], 'Engineer sees only projects where they are a member');
select is((select count(*)::int from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
          'Engineer cannot see tasks of an unrelated project');
select is((select array_agg(code order by code) from public.tasks), array['P01-T01', 'P01-T02', 'P01-T02a', 'P01-T02b', 'P01-T03', 'P01-T04'],
          'Engineer sees every task of their project (migration 21: the project plan)');
select is((select count(*)::int from public.daily_reports where user_id <> auth.uid()), 1,
          'Engineer reads all members'' daily reports in their project');
select is((select count(*)::int from public.profiles where id = '11111111-0000-0000-0000-000000000012'), 1,
          'Engineer can see a co-member''s profile');
select is((select count(*)::int from public.profiles where id = '11111111-0000-0000-0000-000000000015'), 0,
          'Engineer cannot see a profile from an unrelated project');
select is_empty($$update public.tasks set title = 'hijack' where id = 'bbbbbbbb-0000-0000-0000-000000000105' returning 1$$,
          'Engineer cannot update someone else''s task');
select throws_ok($$update public.tasks set planned_due_at = now() + interval '9 days' where id = 'bbbbbbbb-0000-0000-0000-000000000106'$$,
          '42501', null, 'Engineer cannot set a deadline');
select throws_ok($$update public.tasks set extended_deadline = now() + interval '9 days' where id = 'bbbbbbbb-0000-0000-0000-000000000106'$$,
          '42501', null, 'Engineer cannot grant an extension');
select lives_ok($$update public.tasks set status = 'In progress' where id = 'bbbbbbbb-0000-0000-0000-000000000106'$$,
          'Engineer can move their task forward');
select throws_ok($$update public.tasks set status = 'Not started' where id = 'bbbbbbbb-0000-0000-0000-000000000106'$$,
          '42501', null, 'Engineer cannot move a status backwards');
select lives_ok($$insert into public.tasks (project_id, title, assigned_to) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Scan appendix figures', '11111111-0000-0000-0000-000000000012')$$,
          'Engineer can create a task and assign it to an engineer member');
select is((select code from public.tasks where title = 'Scan appendix figures'), 'P01-T05', 'Task code is generated');
select throws_ok($$insert into public.tasks (project_id, title, assigned_to) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', '11111111-0000-0000-0000-000000000002')$$,
          '42501', null, 'Engineer cannot assign to a non-engineer member');
select throws_ok($$insert into public.tasks (project_id, title, assigned_to) values ('aaaaaaaa-0000-0000-0000-000000000002', 'x', '11111111-0000-0000-0000-000000000011')$$,
          '42501', null, 'Engineer cannot create a task in an unrelated project');
select throws_ok($$select public.save_daily_report('{"project_id":"aaaaaaaa-0000-0000-0000-000000000002","update_text":"x"}')$$,
          '42501', null, 'Engineer cannot report on an unrelated project');
select lives_ok($$select public.complete_task('bbbbbbbb-0000-0000-0000-000000000106')$$, 'Engineer can mark own task Completed');
select is((select count(*)::int from public.notifications where user_id <> auth.uid()), 0, 'Engineer reads only own notifications');
select is((select count(*)::int from public.activity_log where subject_user_id is distinct from auth.uid()
           and actor_user_id is distinct from auth.uid()), 0, 'Engineer reads only log rows about themselves');
select is((select count(*)::int from public.v_admin_overview), 0, 'Admin overview returns nothing to an engineer');

-------------------------------------------------------------------------- Engineer in two projects (Imam)
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select is((select count(*)::int from public.projects), 2, 'Engineer in two projects sees both');
select throws_ok($$insert into public.daily_report_items (report_id, task_id) select id, 'bbbbbbbb-0000-0000-0000-000000000101' from public.daily_reports where user_id = auth.uid()$$,
          '42501', null, 'Only your own tasks can go into your daily report');

-------------------------------------------------------------------------- Removed and inactive users
select pg_temp.act_as('11111111-0000-0000-0000-000000000014');
select is((select array_agg(code) from public.projects), array['P01'], 'Removed member loses access to that project');
select pg_temp.act_as('11111111-0000-0000-0000-000000000018');
select is((select count(*)::int from public.projects), 0, 'Inactive user sees no projects');

-------------------------------------------------------------------------- Storage bucket daily-report-files
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select lives_ok($$insert into storage.objects (bucket_id, name, owner)
                  select 'daily-report-files', project_id || '/' || id || '/' || gen_random_uuid() || '-bench.pdf', auth.uid()
                    from public.daily_reports where user_id = auth.uid()$$,
          'Engineer can upload to their own open report');
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');
select throws_ok($$insert into storage.objects (bucket_id, name, owner)
                   select 'daily-report-files', project_id || '/' || id || '/x.pdf', auth.uid()
                     from public.daily_reports where user_id = '11111111-0000-0000-0000-000000000012'$$,
          '42501', null, 'Engineer cannot upload into someone else''s report');
select is((select count(*)::int from storage.objects where bucket_id = 'daily-report-files'), 1,
          'Project members can view project files');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select is((select count(*)::int from storage.objects where bucket_id = 'daily-report-files'), 0,
          'PM of another project cannot view the files');
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select results_eq($$delete from storage.objects where bucket_id = 'daily-report-files' returning 1$$, $$values (1)$$,
          'PM / department head can delete (manage) files of a managed project');

-------------------------------------------------------------------------- Admin and anon
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select is((select count(*)::int from public.projects), 4, 'Admin sees every project');
select is(((public.admin_dashboard() -> 'overview' ->> 'projects_total'))::int, 4, 'Admin dashboard returns the global overview');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.projects$$, '42501', null, 'Anonymous callers have no table access');
reset role;

select * from finish();
rollback;
