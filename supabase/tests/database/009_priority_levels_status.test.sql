-- =============================================================================
-- FSMB · Priority levels (migration 31) and status changes by every role (the status path, tasklist_update_task).
-- pgTAP; run with `supabase test db` (needs seed.sql personas). One transaction, rolled back: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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

-- personas: admin rashidul …0001 | Dept Head morsalin …0002 (PM of P01) | PM abrar …0003 (P02 only)
--           shorif …0011 (P01) | masrur …0013 (P01) | araf …0015 (P02, not P01)
-- P01-T01 bbbb…0101 (shorif) | P01-T02 bbbb…0102 (imam) with open subtasks T02a …0105, T02b …0106

-- ===================================================================== A. priority levels
select pg_temp.sys();
select is((select count(*)::int from public.tasks where priority::text in ('High', 'Low')), 0, 'no task holds High or Low any more');
select is((select count(*)::int from public.tasklist_rows where priority::text in ('High', 'Low')), 0, 'no Tasklist row holds High or Low any more');
select ok(not exists (select 1 from public.priority_level_backup b where b.new_value <> case b.old_value when 'High' then 'Important'::public.task_priority else 'Normal'::public.task_priority end),
          'every moved value followed the mapping High -> Important, Low -> Normal');
select ok(not exists (select 1 from public.priority_level_backup b where b.table_name = 'tasks' and not exists (select 1 from public.tasks t where t.id = b.row_id)),
          'every task whose priority moved still exists (no row removed)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select throws_ok($$update public.tasks set priority = 'High' where id = 'bbbbbbbb-0000-0000-0000-000000000102'$$, '23514', null,
          'High can no longer be stored (check tasks_priority_level)');
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000102', '{"priority":"Low"}')$$, '23514', null,
          'Low is refused on the Tasklist path too');
select lives_ok($$update public.tasks set priority = 'Urgent' where id = 'bbbbbbbb-0000-0000-0000-000000000102'$$, 'Urgent is stored');
select lives_ok($$update public.tasks set priority = 'Important' where id = 'bbbbbbbb-0000-0000-0000-000000000102'$$, 'Important is stored');
select lives_ok($$update public.tasks set priority = 'Normal' where id = 'bbbbbbbb-0000-0000-0000-000000000102'$$, 'Normal is stored');

-- ===================================================================== B. every role may reopen a Completed task
select pg_temp.sys();
update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000101';
select pg_temp.act_as('11111111-0000-0000-0000-000000000011');   -- engineer, the assignee
select lives_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"In progress"}')$$,
          'Engineer (assignee) moves a Completed task back to In progress');
select pg_temp.sys();
select ok((select status = 'In progress' and completed_on is null from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000101'),
          '…stored, and the completion time is cleared');
select ok(exists (select 1 from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000101'
                    and l.action = 'Status change' and l.details = 'Completed → In progress'), '…and written to the activity log');

update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000101';
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');   -- engineer member, not the assignee
select lives_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"Blocked"}')$$,
          'Engineer member (not the assignee) reopens a Completed task');
select pg_temp.sys();
update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000101';
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');   -- Department Head / PM of P01
select lives_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"In progress"}')$$,
          'Department Head (PM of the project) reopens a Completed task');
select pg_temp.sys();
update public.tasks set status = 'Completed' where id = 'bbbbbbbb-0000-0000-0000-000000000101';
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');   -- Admin, not a member
select lives_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"Not started"}')$$,
          'Admin reopens a Completed task');

-- ===================================================================== C. the status path changes nothing else
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"description":"x"}')$$, '22023', null,
          'the status path cannot change other fields (Remarks)');
with u as (update public.tasks set status = 'Blocked' where id = 'bbbbbbbb-0000-0000-0000-000000000102' returning 1)
select is((select count(*)::int from u), 0, 'a direct table update keeps the engineer rules (someone else''s task: RLS changes no row)');
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000102', '{"status":"Completed"}')$$, '42501', null,
          'completing a task with open subtasks stays a manager''s call');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');   -- araf: not a member of P01
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"In progress"}')$$, 'P0002', null,
          'someone outside the project cannot change its statuses (not even visible)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');   -- abrar: PM of P02 only
select throws_ok($$select public.tasklist_update_task('bbbbbbbb-0000-0000-0000-000000000101', '{"status":"In progress"}')$$, 'P0002', null,
          'a PM of another project cannot change its statuses');
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select throws_ok($$select public.set_task_end_date('bbbbbbbb-0000-0000-0000-000000000101', date '2026-12-20')$$, '42501', null,
          'an engineer still sets no deadline');

select * from finish();
rollback;
