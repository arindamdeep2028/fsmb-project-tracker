-- =============================================================================
-- FSMB · Responsibilities cells by role (migration 32, public.member_update_task):
--   Admin / PM / Department Head: every cell of any task of their projects;
--   engineer member: every cell but End Date, on their OWN tasks only (assigned to them or created by them).
-- pgTAP; run with `supabase test db` (needs seed.sql personas). One transaction, rolled back: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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

-- personas: admin rashidul …0001 | PM P02 abrar …0003 | imam …0012 (P01, P02) | araf …0015 (P02) | arif …0016 (P02)
-- P02-T01 bbbb…0201 (araf) | P02-T02 bbbb…0202 (arif) | P02-T03 bbbb…0203 (imam)
-- P01-T02 bbbb…0102 (imam) with open subtasks

-- ===================================================================== A. engineer, own task (assigned to them)
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select lives_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"title":"Own task renamed","description":"own remark","priority":"Urgent","progress_pct":45}')$$,
          'Engineer edits name, Remarks, Priority and Progress of their own task (already started)');
select pg_temp.sys();
select ok((select title = 'Own task renamed' and description = 'own remark' and priority = 'Urgent' and progress_pct = 45
             from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000203'), '…all stored');
select ok(exists (select 1 from public.activity_log where task_id = 'bbbbbbbb-0000-0000-0000-000000000203' and ts >= now()), '…and logged');
update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000203';
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select lives_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"status":"In progress"}')$$,
          'Engineer reopens their own Completed task');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"planned_due_at":"2026-12-20"}')$$, '22023', null,
          'End Date is not a cell an engineer can change');
select throws_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000203', date '2026-12-20')$$, '42501', null,
          '…not through set_task_end_date either');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"assigned_to":"11111111-0000-0000-0000-000000000003"}')$$, '42501', null,
          'Engineer cannot assign to a PM (only themselves or an engineer member)');
select lives_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"assigned_to":"11111111-0000-0000-0000-000000000015"}')$$,
          'Engineer reassigns their own task to an engineer member');

-- ===================================================================== B. engineer, colleague's task
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000202', '{"title":"x"}')$$, '42501', null,
          'Engineer cannot rename a colleague''s task');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000202', '{"status":"Blocked"}')$$, '42501', null,
          'Engineer cannot change the status of a colleague''s task');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000202', '{"progress_pct":10}')$$, '42501', null,
          'Engineer cannot change the progress of a colleague''s task');
-- the task just handed to araf is now araf's, but imam created it? no: created by the PM, so it is no longer imam's
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000203', '{"title":"y"}')$$, '42501', null,
          'Once handed to a colleague (and not created by them) the task is no longer theirs');
with u as (update public.tasks set title = 'z' where id = 'bbbbbbbb-0000-0000-0000-000000000202' returning 1)
select is((select count(*)::int from u), 0, 'a direct table update on a colleague''s task changes nothing (RLS)');

-- ===================================================================== C. engineer, task they created for a colleague
select lives_ok($$insert into public.tasks (project_id, title, assigned_to, priority) values ('aaaaaaaa-0000-0000-0000-000000000002', 'E2E created by imam', '11111111-0000-0000-0000-000000000016', 'Normal')$$,
          'setup: engineer creates a task for an engineer colleague');
select lives_ok($$select public.member_update_task((select id from public.tasks where title = 'E2E created by imam'), '{"title":"E2E created by imam, renamed","status":"In progress"}')$$,
          'Engineer edits a task they created, even when assigned to a colleague');

-- ===================================================================== D. rules kept
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000102', '{"status":"Completed"}')$$, '42501', null,
          'Completing a task with open subtasks stays a manager''s call');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000102', '{"progress_pct":50}')$$, '23514', null,
          'A task with subtasks has its progress calculated');

-- ===================================================================== E. managers: every cell of any task
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000202', '{"title":"PM edit","assigned_to":"11111111-0000-0000-0000-000000000012","priority":"Important"}')$$,
          'PM edits name, Assign To and Priority of any task of their project');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000201', '{"title":"Admin edit","assigned_to":"11111111-0000-0000-0000-000000000016","description":"admin remark","progress_pct":5}')$$,
          'Admin (not a member) edits every cell, Assign To included');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$select public.member_update_task('bbbbbbbb-0000-0000-0000-000000000102', '{"title":"x"}')$$, 'P0002', null,
          'someone outside the project cannot edit it (not even visible)');

-- ===================================================================== F. Tasklist: every member edits the Deadline
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');   -- imam, engineer; P02-T01 is araf's task
select lives_ok($$select public.tasklist_set_deadline('bbbbbbbb-0000-0000-0000-000000000201', date '2026-12-23')$$,
          'Tasklist: an engineer member sets the Deadline of any task of the project');
select pg_temp.sys();
select is((select (effective_due_at at time zone 'Asia/Dhaka')::date from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000201'),
          date '2026-12-23', '…stored as the task''s one deadline (the End Date of Responsibilities)');
select ok(exists (select 1 from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000201' and l.details like 'Deadline changed%' and l.ts >= now()),
          '…and logged');
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000201', '{"planned_due_at":"2026-12-24"}')$$, '22023', null,
          'tasklist_update_task still takes only name, status and priority');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');   -- araf: not a member of P01
select throws_ok($$select public.tasklist_set_deadline('bbbbbbbb-0000-0000-0000-000000000102', date '2026-12-23')$$, 'P0002', null,
          'Tasklist: someone outside the project cannot set its deadlines');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');   -- abrar, PM of P02
select lives_ok($$select public.tasklist_set_deadline('bbbbbbbb-0000-0000-0000-000000000202', date '2026-12-26')$$,
          'Tasklist: a PM sets a Deadline too');

select * from finish();
rollback;
