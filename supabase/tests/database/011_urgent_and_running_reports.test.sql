-- =============================================================================
-- FSMB · Important -> Urgent (migration 33) and daily updates for running projects only (migration 34).
-- pgTAP; run with `supabase test db` (needs seed.sql personas). One transaction, rolled back: nothing is kept.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

-- ===================================================================== A. Important -> Urgent
select pg_temp.sys();
select ok(to_regclass('public.priority_urgent_backup') is not null, 'migration 33 kept a copy of every value it moved');
select ok(not exists (select 1 from public.priority_urgent_backup where old_value <> 'Important' or new_value <> 'Urgent'),
          'it moved Important to Urgent only');
select ok(not exists (select 1 from public.priority_urgent_backup b where b.table_name = 'tasks'
                        and not exists (select 1 from public.tasks t where t.id = b.row_id)), 'every moved task still exists');
select ok(not exists (select 1 from public.priority_urgent_backup b join public.tasks t on t.id = b.row_id
                       where b.table_name = 'tasks' and t.priority = 'Important'), 'no moved task is still Important');
select is((select count(*)::int from public.tasks t where t.priority = 'Important'
             and not exists (select 1 from public.priority_urgent_backup b where b.row_id = t.id)), 0,
          'no Important task was left behind (archived ones included)');
select is((select count(*)::int from public.tasklist_rows r where r.priority = 'Important'), 0, 'no Tasklist row is still Important');
-- running it again changes nothing
create temp table before_rerun on commit drop as select id, priority from public.tasks;
update public.tasks set priority = 'Important' where id = 'bbbbbbbb-0000-0000-0000-000000000203';   -- a later choice
do $$ begin if to_regclass('public.priority_urgent_backup') is not null then return; end if; update public.tasks set priority = 'Urgent'; end $$;
select is((select priority::text from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000203'), 'Important',
          'a second run leaves a priority chosen later alone');
select lives_ok($$update public.tasks set priority = 'Important' where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$, 'Important can still be chosen');

-- ===================================================================== B. daily updates: running projects only
-- imam …0012 is a member of 002 (On hold) and of P02 (Active)
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select throws_ok($$insert into public.daily_reports (user_id, project_id, report_date, update_text)
                   values ('11111111-0000-0000-0000-000000000012', 'cccccccc-0000-0000-0000-000000000002', app.dhaka_today(), 'halted')$$,
          '42501', null, 'a member cannot submit a daily update for a halted project');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'cccccccc-0000-0000-0000-000000000002', 'update_text', 'halted', 'items', '[]'::jsonb))$$,
          '42501', null, '…not through save_daily_report either');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'running', 'items', '[]'::jsonb))$$,
          'a running project takes the daily update as before');
select pg_temp.sys();
select is((select count(*)::int from public.daily_reports where project_id = 'cccccccc-0000-0000-0000-000000000002' and report_date = app.dhaka_today()), 0,
          'nothing was stored for the halted project');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$insert into public.daily_reports (user_id, project_id, report_date, update_text)
                  values ('11111111-0000-0000-0000-000000000012', 'cccccccc-0000-0000-0000-000000000002', date '2026-10-01', 'admin correction')$$,
          'an Admin keeps their report editing');
select pg_temp.sys();
select lives_ok($$update public.daily_reports set locked = true where project_id = 'cccccccc-0000-0000-0000-000000000002'$$,
          'system jobs (locking) are not affected');

select * from finish();
rollback;
