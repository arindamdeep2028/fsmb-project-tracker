-- =============================================================================
-- FSMB · Migration 35: several task entries in one daily report (pgTAP).
-- Requires seed.sql personas. One transaction, rolled back. Impersonation as in 001_rls.test.sql.
-- Araf (…0015) reports on two subtasks of P02-T01 and another task of his in one report; each entry keeps its
-- own text, status, completion and hours; one entry never changes another task; the weighted roll-up is the
-- usual one. Then the Admin path (another member, an earlier date) and what everyone else may not do.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated, anon;
-- read as the table owner, so RLS never hides a row from an assertion
create or replace function pg_temp.item(p_report uuid, p_task uuid) returns public.daily_report_items language sql security definer as $$
  select * from public.daily_report_items where report_id = p_report and task_id = p_task;
$$;
create or replace function pg_temp.task(p_id uuid) returns public.tasks language sql security definer as $$
  select * from public.tasks where id = p_id;
$$;
create or replace function pg_temp.report_of(p_user uuid, p_project uuid, p_date date) returns uuid language sql security definer as $$
  select id from public.daily_reports where user_id = p_user and project_id = p_project and report_date = p_date;
$$;
create or replace function pg_temp.calc(p_id uuid) returns numeric language sql security definer as $$
  select calc_progress from app.task_weights where task_id = p_id;
$$;
grant execute on function pg_temp.item(uuid, uuid), pg_temp.task(uuid), pg_temp.report_of(uuid, uuid, date), pg_temp.calc(uuid) to authenticated;

-- fixtures (as the database owner): two subtasks of P02-T01 and a second task, all Araf's
insert into public.tasks (id, project_id, parent_id, title, assigned_to, assigned_by, created_by) values
  ('cccccccc-0000-0000-0000-00000000035a', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000201', 'Subtask one', '11111111-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-00000000035b', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000201', 'Subtask two', '11111111-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-00000000035c', 'aaaaaaaa-0000-0000-0000-000000000002', null, 'Testing by project', '11111111-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001');

-------------------------------------------------------------------------- one report, three entries
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002',
  'update_text', 'summary of the entries',
  'items', jsonb_build_array(
    jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035a', 'status_after', 'In progress', 'progress_after', 50, 'work_hours', 3,
                       'work_text', 'Checked the template', 'issues', 'No issues', 'next_task_text', 'Finalize the review'),
    jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035b', 'status_after', 'Plan submitted', 'progress_after', 75, 'work_hours', 2,
                       'work_text', 'Prepared the draft', 'issues', 'Waiting for feedback', 'next_task_text', 'Incorporate comments'),
    jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035c', 'status_after', 'Blocked', 'progress_after', 30, 'work_hours', 2.5,
                       'work_text', 'Started the system test', 'issues', 'Test setup not available', 'next_task_text', ''))))$$,
  'An engineer saves one report with three task entries');
select is((select count(*)::int from public.daily_report_items where report_id = pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today())
            and task_id::text like 'cccccccc-%'), 3, 'The report has the three entries');
select is((select string_agg(right(task_id::text, 1), '' order by created_at) from public.daily_report_items
            where report_id = pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today())
              and task_id::text like 'cccccccc-%'), 'abc', 'The entries keep the order they were sent in');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035b')).issues,
          'Waiting for feedback', 'Each entry keeps its own issues');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035a')).work_text,
          'Checked the template', 'Each entry keeps its own work text');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035c')).next_task_text,
          null, 'An empty next task is stored as nothing');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035a')).progress_pct, 50.00::numeric(5,2), 'Entry 1 set its subtask to 50%');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035b')).progress_pct, 75.00::numeric(5,2), 'Entry 2 set its subtask to 75%');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035b')).status::text, 'Plan submitted', 'and its status');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035c')).progress_pct, 30.00::numeric(5,2), 'Entry 3 set its task to 30%');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035c')).status::text, 'Blocked', 'and its status');
select is(pg_temp.calc('bbbbbbbb-0000-0000-0000-000000000201'), 62.50::numeric, 'The parent task rolls up its two subtasks (equal shares: 0.5×50 + 0.5×75)');

-------------------------------------------------------------------------- one entry never changes another
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'summary',
  'items', jsonb_build_array(jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035a', 'status_after', 'In progress', 'progress_after', 60, 'work_hours', 3,
                                                'work_text', 'Checked the template again'))))$$,
  'Saving with one entry changed');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035a')).progress_pct, 60.00::numeric(5,2), 'That subtask moved to 60%');
select is((pg_temp.task('cccccccc-0000-0000-0000-00000000035b')).progress_pct, 75.00::numeric(5,2), 'The other subtask is unchanged');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035b')).work_text,
          'Prepared the draft', 'and so is its entry');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035a')).issues,
          null, 'An entry from the form replaces all three of its texts (issues cleared)');
-- the inline sheet row sends an item without work_text: the entry's texts stay
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'summary',
  'items', jsonb_build_array(jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035b', 'status_after', 'Plan submitted', 'progress_after', 80))))$$,
  'An item without work text (older caller)');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today()), 'cccccccc-0000-0000-0000-00000000035b')).issues,
          'Waiting for feedback', 'keeps the entry''s own texts');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'dup',
  'items', jsonb_build_array(jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035c', 'work_text', 'a'),
                             jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035c', 'work_text', 'b'))))$$,
  '21000', null, 'The same task twice in one save is refused');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'summary',
  'remove_task_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000035b')))$$, 'An entry removed on purpose');
select is((select count(*)::int from public.daily_report_items where report_id = pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today())
            and task_id::text like 'cccccccc-%'), 2, 'is gone; the others stay');

-------------------------------------------------------------------------- who may save which report
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'x',
  'user_id', '11111111-0000-0000-0000-000000000016'))$$, '42501', null, 'An engineer cannot save another person''s report');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'x',
  'report_date', app.dhaka_today() - 1))$$, '42501', null, 'An engineer cannot save a report for an earlier day');

select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'Filled in by Admin',
  'user_id', '11111111-0000-0000-0000-000000000015', 'report_date', app.dhaka_today() - 1,
  'items', jsonb_build_array(jsonb_build_object('task_id', 'cccccccc-0000-0000-0000-00000000035c', 'status_after', 'In progress', 'progress_after', 40, 'work_hours', 1,
                                                'work_text', 'Lab booked'))))$$,
  'An Admin saves a member''s report for an earlier day');
select is((pg_temp.item(pg_temp.report_of('11111111-0000-0000-0000-000000000015', 'aaaaaaaa-0000-0000-0000-000000000002', app.dhaka_today() - 1), 'cccccccc-0000-0000-0000-00000000035c')).work_text,
          'Lab booked', 'It is that member''s report, with the entry');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'x',
  'user_id', '11111111-0000-0000-0000-000000000013'))$$, '23514', null, 'Not for a person who is not a member of the project');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'x',
  'user_id', '11111111-0000-0000-0000-000000000015', 'report_date', app.dhaka_today() + 1))$$, '22023', null, 'Never for a day after today');

select * from finish();
rollback;
