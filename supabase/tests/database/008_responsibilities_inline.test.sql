-- =============================================================================
-- FSMB · Responsibilities inline editing, priorities, End Date and the daily update → progress chain (migration 30).
-- pgTAP; run with `supabase test db` (needs seed.sql personas). One transaction, rolled back: nothing is kept.
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
create or replace function pg_temp.sys() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.sys() to authenticated, anon;

-- personas: admin rashidul …0001 | PM P02 abrar …0003 | shorif …0011 (P01) | imam …0012 (P01, P02) | araf …0015 (P02)
-- P01-T01 bbbb…0101 (shorif, Completed) | P01-T02 bbbb…0102 (imam) with subtasks T02a …0105 (imam), T02b …0106 (shorif)
-- P02-T01 bbbb…0201 (araf) | P02-T02 bbbb…0202 (arif) | P02-T03 bbbb…0203 (imam)

-- ===================================================================== A. priority
select ok('Urgent' = any (enum_range(null::public.task_priority)::text[]), 'task_priority has Urgent');
select ok((select bool_and(v = any (enum_range(null::public.task_priority)::text[])) from unnest(array['Important', 'High', 'Normal', 'Low']) v),
          'the earlier priority values are all still valid');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$update public.tasks set priority = 'Urgent' where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$, 'A PM sets a task to Urgent');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$update public.tasks set priority = 'Urgent' where id = 'bbbbbbbb-0000-0000-0000-000000000201'$$, 'An engineer sets their own task to Urgent (existing priority right)');
with u as (update public.tasks set priority = 'Urgent' where id = 'bbbbbbbb-0000-0000-0000-000000000203' returning 1)
select is((select count(*)::int from u), 0, 'An engineer cannot change the priority of someone else''s task (RLS: no row changes)');
select lives_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"priority":"Urgent"}')$$,
          'The Tasklist path (any member) takes Urgent as before');
select pg_temp.sys();
select is((select priority::text from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000202'), 'Urgent', 'Urgent is stored in the database');

-- ===================================================================== B. End Date (set_task_end_date)
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000202', date '2026-12-20')$$, 'Admin sets an End Date');
select pg_temp.sys();
select is((select (effective_due_at at time zone 'Asia/Dhaka')::date from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000202'),
          date '2026-12-20', 'the deadline falls on that Dhaka day');
select is((select effective_due_at from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000202'),
          app.local_at(date '2026-12-20', (select office_end from public.workspace_settings where id = 1)), '…at the office closing time');
select ok(exists (select 1 from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000202' and l.details like 'Deadline changed%'),
          'the change is in the activity log');

-- an extension in force: the End Date typed replaces it, the extension record stays
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$select public.grant_extension('bbbbbbbb-0000-0000-0000-000000000203', now() + interval '20 days', 'test')$$, 'setup: an extension');
create temp table ext_before on commit drop as select count(*) n from public.task_extensions where task_id = 'bbbbbbbb-0000-0000-0000-000000000203';
grant select on ext_before to authenticated;
select lives_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000203', date '2026-12-24')$$, 'A PM sets the End Date of an extended task');
select pg_temp.sys();
select is((select (effective_due_at at time zone 'Asia/Dhaka')::date from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000203'),
          date '2026-12-24', 'the End Date typed is the one that applies');
select is((select count(*) from public.task_extensions where task_id = 'bbbbbbbb-0000-0000-0000-000000000203'), (select n from ext_before),
          'the extension history is kept');

select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000201', date '2026-12-20')$$, '42501', null,
          'An engineer cannot set an End Date, even on their own task (backend, not just the UI)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select throws_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000104', date '2026-12-20')$$, 'P0002', null,
          'A PM cannot set an End Date in a project they do not manage (it is not even visible to them)');

-- ===================================================================== C. reopening a Completed task
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.tasks set status = 'In progress' where id = 'bbbbbbbb-0000-0000-0000-000000000101'$$, 'Admin moves a Completed task back to In progress');
select pg_temp.sys();
select ok((select completed_on is null and progress_pct = 100 from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000101'),
          'reopening clears the completion time and leaves the progress as it was');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000101'$$, 'setup: completed again');
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');
select throws_ok($$update public.tasks set status = 'In progress' where id = 'bbbbbbbb-0000-0000-0000-000000000101'$$, '42501', null,
          'A direct table update keeps the engineer rules (reopening goes through the status path: test 009)');

-- ===================================================================== D. daily update → subtask → task → project
select pg_temp.sys();
create temp table hist on commit drop as
  select count(*) n from public.daily_report_items i join public.daily_reports r on r.id = i.report_id where r.report_date < app.dhaka_today();
grant select on hist to authenticated;
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'update_text', 'Calibration figures inserted', 'items', jsonb_build_array(jsonb_build_object(
  'task_id', 'bbbbbbbb-0000-0000-0000-000000000105', 'progress_after', 90, 'status_after', 'In progress'))))$$,
  'An engineer submits 90% on their subtask');
select pg_temp.sys();
select is((select progress_pct from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000105'), 90.00::numeric(5,2), 'the subtask shows 90% in Responsibilities');
select is((select calculated_progress from public.task_rollup where task_id = 'bbbbbbbb-0000-0000-0000-000000000102'),
          (select round(sum(c.sibling_share * t.progress_pct), 2) from public.task_rollup c join public.tasks t on t.id = c.task_id
            where c.parent_id = 'bbbbbbbb-0000-0000-0000-000000000102'),
          'the parent task is the share-weighted roll-up of its subtasks');
select is(app.project_completion('aaaaaaaa-0000-0000-0000-000000000001'),
          (select round(sum(effective_weight * calculated_progress), 2) from public.task_rollup where project_id = 'aaaaaaaa-0000-0000-0000-000000000001' and is_leaf),
          'project progress follows its leaf tasks (existing method)');
select is((select count(*) from public.daily_report_items i join public.daily_reports r on r.id = i.report_id where r.report_date < app.dhaka_today()),
          (select n from hist), 'earlier daily updates are untouched');

select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'update_text', 'x', 'items', jsonb_build_array(jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000203', 'progress_after', 50))))$$,
  '23514', null, 'A task of another project cannot go into this project''s update');

select * from finish();
rollback;
