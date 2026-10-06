-- =============================================================================
-- FSMB · Migration 22: a daily report keeps its task entries (pgTAP).
-- Requires seed.sql. One transaction, rolled back. Impersonation as in 001_rls.test.sql.
-- Regression: Araf reports on his task, completes it, reopens the report and saves it — the entry stays.
-- Then the Admin row (save_daily_row): one transaction, no overwrite, Admin only.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated, anon;
-- counts read as the table owner, so RLS never hides a row from an assertion
create or replace function pg_temp.items(p_user uuid, p_project uuid, p_date date) returns int language sql security definer as $$
  select count(*)::int from public.daily_report_items i join public.daily_reports r on r.id = i.report_id
   where r.user_id = p_user and r.project_id = p_project and r.report_date = p_date;
$$;
create or replace function pg_temp.reports(p_user uuid, p_project uuid, p_date date) returns int language sql security definer as $$
  select count(*)::int from public.daily_reports r where r.user_id = p_user and r.project_id = p_project and r.report_date = p_date;
$$;
create or replace function pg_temp.report_text(p_user uuid, p_project uuid, p_date date) returns text language sql security definer as $$
  select r.update_text from public.daily_reports r where r.user_id = p_user and r.project_id = p_project and r.report_date = p_date;
$$;
grant execute on function pg_temp.items(uuid, uuid, date), pg_temp.reports(uuid, uuid, date), pg_temp.report_text(uuid, uuid, date) to authenticated;

-- personas: admin …0001 | PM P02 abrar …0003 | imam …0012 (P01, P02) | masrur …0013 (P01 only) | araf …0015 | arif …0016
-- P02 aaaa…0002: P02-T01 bbbb…0201 (Araf) | P02-T02 bbbb…0202 (Arif) | P02-T03 bbbb…0203 (Imam)

-------------------------------------------------------------------------- the original failure
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'update_text', 'First accuracy run',
                    'items', jsonb_build_array(jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000201', 'status_after', 'In progress', 'progress_after', 40))))$$,
          'An engineer submits today''s report with a task entry');
select is(pg_temp.items('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 1, 'The report has its task entry');
select lives_ok($$select public.complete_task('bbbbbbbb-0000-0000-0000-000000000201')$$, 'The engineer completes that task');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'update_text', 'First accuracy run, typo fixed', 'items', jsonb_build_array()))$$,
          'The report is reopened and saved with an empty task list (the completed task is no longer offered)');
select is(pg_temp.items('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 1,
          'REGRESSION: the existing task entry is still there');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'update_text', 'Only the remarks changed', 'remarks', 'Bench booked'))$$,
          'Saving other fields with no task list at all');
select is(pg_temp.items('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 1,
          'Saving unrelated fields does not remove the task entry');
select is(pg_temp.report_text('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()),
          'Only the remarks changed', 'The report text itself was saved');
select is((select status::text from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000201'), 'Completed', 'The task stays Completed');

-------------------------------------------------------------------------- removal is explicit and limited to the caller's own report
select pg_temp.act_as('11111111-0000-0000-0000-000000000016');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'update_text', 'Arif''s own report', 'remove_task_ids', jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000201')))$$,
          'Another engineer saves their own report, naming a colleague''s task for removal');
select is(pg_temp.items('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 1,
          'A removal request never reaches another person''s report');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'update_text', 'Main task cleared', 'remove_task_ids', jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000201')))$$,
          'The author removes the entry on purpose');
select is(pg_temp.items('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 0,
          'An explicit removal by the author removes the entry');

-------------------------------------------------------------------------- the report's project is checked on the server
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'Draft meant for P01'))$$,
          '42501', null, 'A report sent with the id of a project the user is not a member of is refused');
select is(pg_temp.reports('11111111-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 0, 'and nothing is saved');

-------------------------------------------------------------------------- Admin row: one transaction, no overwrite
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000016', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'Filled in by Admin',
                    'item', jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000202', 'status_after', 'In progress')))$$,
          'Admin fills in a past report for an engineer, with a task entry');
select is(pg_temp.items('11111111-0000-0000-0000-000000000016', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today() - 1), 1, 'The report and its entry are saved');
select throws_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000016', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'OVERWRITE'))$$,
          '23505', null, 'A second new row for the same person, project and date is refused');
select is(pg_temp.report_text('11111111-0000-0000-0000-000000000016', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today() - 1),
          'Filled in by Admin', 'and the existing report is unchanged');
select throws_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000012', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'Half saved?',
                    'item', jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000202')))$$,
          '42501', null, 'A task entry that is refused (the task belongs to someone else) fails the whole row');
select is(pg_temp.reports('11111111-0000-0000-0000-000000000012', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today() - 1), 0,
          'ATOMIC: no report is left behind without its entry');
select lives_ok($$select public.save_daily_row(jsonb_build_object(
                    'report_id', (select id from public.daily_reports where user_id = '11111111-0000-0000-0000-000000000016' and report_date = app.dhaka_today() - 1),
                    'user_id', '11111111-0000-0000-0000-000000000016', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'Edited by Admin', 'item', null))$$,
          'Admin edits that report''s text without naming a task');
select is(pg_temp.items('11111111-0000-0000-0000-000000000016', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today() - 1), 1,
          'The edit keeps the existing task entry');
select throws_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000013', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'Not a member'))$$,
          '23514', null, 'A row for someone who is not a member of the project is refused');

-------------------------------------------------------------------------- Admin only
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select throws_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000015', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'PM fill'))$$,
          '42501', null, 'A Project Manager cannot write a past row for an engineer');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$select public.save_daily_row(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000015', 'project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                    'report_date', app.dhaka_today() - 1, 'update_text', 'Backdated'))$$,
          '42501', null, 'An engineer cannot write their own past row');
select ok(not has_function_privilege('anon', 'public.save_daily_row(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.save_daily_report(jsonb)', 'execute'),
          'Signed-out callers cannot run either function');

select * from finish();
rollback;
