-- =============================================================================
-- FSMB · Final decisions (migration 19): working week, Admin complete access, v2 alignment
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated, anon;

-------------------------------------------------------------------------- Decision 1: working week
select is((select workdays from public.workspace_settings where id = 1), '{1,2,3,4,5}'::smallint[], 'Working days are Monday–Friday');
select ok(not app.is_workday('2026-10-03') and not app.is_workday('2026-10-04'), 'Saturday and Sunday are non-working days');
select ok(app.is_workday('2026-10-02') and app.is_workday('2026-10-05'), 'Friday and Monday are working days');
select is((select exec_due_at from app.compute_deadlines('2026-10-02 16:00+06', null, null)), '2026-10-05 18:00+06'::timestamptz,
          'Friday assignment is due Monday 18:00 (weekend skipped)');
select is((select clock_start_at from app.compute_deadlines('2026-10-03 11:00+06', null, null)), '2026-10-05 09:00+06'::timestamptz,
          'Saturday assignment starts Monday 09:00');
select is((select plan_due_at from app.compute_deadlines('2026-10-02 17:00+06', null, null)), '2026-10-05 11:00+06'::timestamptz,
          'Plan hours carry over the weekend (Fri 17:00 + 3 office hours = Mon 11:00)');
select ok(not ('daily_update_missing' = any (app.task_breaches(
            (select t from public.tasks t where code = 'P01-T04'), '2026-10-03 12:00+06'))),
          'No daily-update breach on a Saturday');
select ok(('daily_update_missing' = any (app.task_breaches(
            (select t from public.tasks t where code = 'P01-T04'), '2026-10-05 12:00+06'))),
          'Daily-update breach counts again on Monday');

-------------------------------------------------------------------------- v2 alignment (C1, C2)
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');   -- Shorif, assignee of P01-T02b (created by Imam)
update public.tasks set status = 'In progress' where code = 'P01-T02b';
reset role;
select is((select count(*)::int from public.notifications where type = 'status_changed'
            and task_id = 'bbbbbbbb-0000-0000-0000-000000000106'), 0,
          'Assignee moving own task forward sends no status notification (v2)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');   -- Imam, creator
select lives_ok($$update public.tasks set contribution_pct = 40 where code = 'P01-T02b'$$,
          'Creator may change contribution after the task has started (v2)');
select throws_ok($$update public.tasks set title = 'renamed' where code = 'P01-T02b'$$, '42501', null,
          'Creator may not rename once the task has started');
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');
select public.complete_task('bbbbbbbb-0000-0000-0000-000000000106');
reset role;
select ok((select count(*) from public.notifications where type = 'status_changed'
            and task_id = 'bbbbbbbb-0000-0000-0000-000000000106') >= 2,
          'Completion by the assignee notifies creator and PMs (v2)');

-------------------------------------------------------------------------- Decision 2: Admin complete access
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.departments set name = 'R&D Lab' where id = 'd0000000-0000-0000-0000-000000000005'$$, 'Admin edits departments');
select lives_ok($$update public.projects set name = 'Renamed', department_id = 'd0000000-0000-0000-0000-000000000003' where code = 'P02'$$, 'Admin edits any project, including its department');
select lives_ok($$update public.profiles set role = 'pm' where login_name = 'araf'$$, 'Admin changes roles');
select lives_ok($$insert into public.project_members (project_id, user_id, member_role) values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000013', 'engineer')$$, 'Admin manages members of any project');
select lives_ok($$update public.tasks set priority = 'Low', status = 'Not started', contribution_pct = 10, planned_due_at = now() + interval '9 days' where code = 'P03-T01'$$,
          'Admin edits priority, status (backwards), contribution and deadline of any task');
select lives_ok($$update public.task_comments set body = 'Edited by admin' where task_id = 'bbbbbbbb-0000-0000-0000-000000000102'$$, 'Admin edits any comment');
select lives_ok($$update public.daily_reports set locked = true where user_id = '11111111-0000-0000-0000-000000000012'$$, 'Admin locks / unlocks any report');
select lives_ok($$update public.workspace_settings set deadline_warning_hours = 4 where id = 1$$, 'Admin manages settings');
select lives_ok($$select public.admin_run_job('red-mark-scan')$$, 'Admin runs a job on demand');
select lives_ok($$select public.department_dashboard()$$, 'Admin opens the department dashboard without choosing a department');
select lives_ok($$delete from public.tasks where code = 'P03-T01'$$, 'Admin hard-deletes a task without report history');
select throws_ok($$delete from public.tasks where code = 'P01-T02a'$$, '23503', null, 'Report history protects a task (archive instead)');
select lives_ok($$delete from public.daily_reports where user_id = '11111111-0000-0000-0000-000000000012'$$, 'Admin deletes a daily report');
select ok(exists (select 1 from public.activity_log where action = 'Deleted'), 'Deletions are written to the audit log');
select throws_ok($$update public.activity_log set details = 'x'$$, '42501', null, 'S1: audit log stays append-only, even for Admin');
select throws_ok($$update public.profiles set active = false where role = 'admin'$$, '23514', null, 'S2: the last active admin is protected');

-------------------------------------------------------------------------- C3: PM member performance
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$select * from public.project_performance('aaaaaaaa-0000-0000-0000-000000000002')$$, 'PM sees member performance for own project');
select throws_ok($$select * from public.project_performance('aaaaaaaa-0000-0000-0000-000000000001')$$, '42501', null, 'PM cannot see another project''s member performance');

select * from finish();
rollback;
