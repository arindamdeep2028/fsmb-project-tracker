-- =============================================================================
-- FSMB · Migration 23: security hardening (pgTAP). SEC-4, SEC-14, SEC-5, SEC-6, SEC-3, in that order.
-- Requires seed.sql. One transaction, rolled back. Impersonation as in 001_rls.test.sql.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- the system: table owner, no signed-in user (what cron jobs, imports and Supabase Auth are)
create or replace function pg_temp.sys() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.sys() to authenticated, anon;

-- personas: admin …0001 | dept head morsalin …0002 (R&D d…05, PM of P01) | PM P02 abrar …0003 | imam …0012 (P01, P02)
--           masrur …0013 (P01) | araf …0015 (P02) | arif …0016 (P02)
-- P02 aaaa…0002: P02-T01 bbbb…0201 (Araf, Plan submitted) | P02-T02 bbbb…0202 (Arif) | P02-T03 bbbb…0203 (Imam)

-- ===================================================================== SEC-4 · deadlines, extensions, score fields
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$select public.complete_task('bbbbbbbb-0000-0000-0000-000000000203')$$, 'A PM completes a task (the database stamps the completion time)');
select throws_ok($$update public.tasks set completed_on = now() - interval '9 days' where id = 'bbbbbbbb-0000-0000-0000-000000000203'$$,
          '42501', null, 'REGRESSION: a PM cannot rewrite a completion time (late → on time)');
select throws_ok($$update public.tasks set assigned_on = now() - interval '30 days' where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$,
          '42501', null, 'A PM cannot rewrite the assignment time');
select throws_ok($$update public.tasks set plan_submitted_at = now() - interval '3 days' where id = 'bbbbbbbb-0000-0000-0000-000000000201'$$,
          '42501', null, 'A PM cannot rewrite a plan time that is already set');
select throws_ok($$update public.tasks set last_update = current_date - 1 where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$,
          '42501', null, 'A PM cannot forge the last-update stamp');
select throws_ok($$update public.tasks set assigned_by = '11111111-0000-0000-0000-000000000001' where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$,
          '42501', null, 'A PM cannot change who assigned a task');
select throws_ok($$update public.tasks set extended_deadline = now() + interval '20 days' where id = 'bbbbbbbb-0000-0000-0000-000000000202'$$,
          '42501', null, 'REGRESSION: an extended deadline cannot be set without an extension record');

select lives_ok($$insert into public.task_extensions (task_id, previous_deadline, new_deadline, reason, granted_by, granted_at, source)
                  values ('bbbbbbbb-0000-0000-0000-000000000202', '2020-01-01', date_trunc('day', now()) + interval '10 days', 'Parts delayed',
                          '11111111-0000-0000-0000-000000000001', '2020-01-01', 'excel_import')$$,
          'A PM adds an extension record directly, with a forged grantor, date, previous deadline and source');
select pg_temp.sys();
select is((select granted_by from public.task_extensions where task_id = 'bbbbbbbb-0000-0000-0000-000000000202' order by id desc limit 1),
          '11111111-0000-0000-0000-000000000003'::uuid, 'REGRESSION: the record names the person who really granted it');
select ok((select granted_at > now() - interval '1 minute' and source = 'app' and previous_deadline > '2021-01-01'
             from public.task_extensions where task_id = 'bbbbbbbb-0000-0000-0000-000000000202' order by id desc limit 1),
          'The record carries the real time, source "app" and the deadline it actually replaced');
select is((select extended_deadline from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000202'),
          date_trunc('day', now()) + interval '10 days', 'The task''s deadline follows the record');
select ok(exists (select 1 from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000202' and l.action = 'Extension granted'
                     and l.actor_user_id = '11111111-0000-0000-0000-000000000003' and l.ts > now() - interval '1 minute'
                     and l.details like 'Deadline extended from % to %Parts delayed'),
          'Audit: who, when, previous and new deadline, and the reason');

select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select lives_ok($$select public.grant_extension('bbbbbbbb-0000-0000-0000-000000000202', date_trunc('day', now()) + interval '12 days', 'Second slip')$$,
          'Grant extension (the app''s path) still works');
select lives_ok($$select public.set_task_deadline('bbbbbbbb-0000-0000-0000-000000000201', date_trunc('day', now()) + interval '6 days')$$,
          'Set deadline (the app''s path) still works');
select lives_ok($$update public.tasks set planned_due_at = null where id = 'bbbbbbbb-0000-0000-0000-000000000201'$$, 'Clearing a manager-set deadline still works');
select throws_ok($$insert into public.task_extensions (task_id, new_deadline) values ('bbbbbbbb-0000-0000-0000-000000000202', now() - interval '1 day')$$,
          '22023', null, 'An extension to a past date is refused');
select pg_temp.sys();
select is((select count(*)::int from public.task_extensions where task_id = 'bbbbbbbb-0000-0000-0000-000000000202'), 2, 'One record per extension granted');
select is((select count(*)::int from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000201' and l.action = 'Edited'
              and l.actor_user_id = '11111111-0000-0000-0000-000000000003' and l.details like 'Deadline changed from % to %'), 2,
          'Audit: setting and clearing a deadline each log previous → new, with the actor');

select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$insert into public.task_extensions (task_id, new_deadline) values ('bbbbbbbb-0000-0000-0000-000000000201', now() + interval '30 days')$$,
          '42501', null, 'An engineer cannot grant themselves an extension');
select pg_temp.act_as('11111111-0000-0000-0000-000000000016');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'Work',
                    'items', jsonb_build_array(jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000202', 'status_after', 'In progress'))))$$,
          'A daily report still stamps the task''s last update (the database''s own path)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.tasks set completed_on = now() - interval '2 days' where id = 'bbbbbbbb-0000-0000-0000-000000000203'$$,
          'An Admin may correct a completion time');
select pg_temp.sys();
select ok(exists (select 1 from public.activity_log l where l.task_id = 'bbbbbbbb-0000-0000-0000-000000000203'
                     and l.actor_user_id = '11111111-0000-0000-0000-000000000001' and l.details like 'Completion time changed from % to %'),
          'and that correction is logged with previous and new value');

-- ===================================================================== SEC-14 · attachments describe a stored file
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'Photos'))$$, 'An engineer has today''s report');
create temp table t_report on commit drop as
  select id, 'aaaaaaaa-0000-0000-0000-000000000002/' || id || '/' as folder from public.daily_reports
   where user_id = '11111111-0000-0000-0000-000000000015' and report_date = app.dhaka_today();
grant select on t_report to authenticated;
select throws_ok($$insert into public.daily_report_attachments (report_id, storage_path, file_name, mime_type, size_bytes)
                   select id, folder || 'eeeeeeee-0000-4000-8000-000000000001-ghost.jpg', 'ghost.jpg', 'image/jpeg', 1000 from t_report$$,
          '23514', null, 'REGRESSION: an attachment row for a file that was never uploaded is refused');
select pg_temp.sys();
insert into storage.objects (bucket_id, name, metadata)
select 'daily-report-files', folder || 'eeeeeeee-0000-4000-8000-000000000002-real.png', '{"size": 2048, "mimetype": "image/png"}'::jsonb from t_report;
insert into storage.objects (bucket_id, name, metadata)
select 'daily-report-files', folder || 'eeeeeeee-0000-4000-8000-000000000003-page.jpg', '{"size": 300, "mimetype": "text/html"}'::jsonb from t_report;
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select lives_ok($$insert into public.daily_report_attachments (report_id, storage_path, file_name, mime_type, size_bytes)
                  select id, folder || 'eeeeeeee-0000-4000-8000-000000000002-real.png', 'real.png', 'application/pdf', 5 from t_report$$,
          'A stored file is attached, with a false type and size claimed');
select pg_temp.sys();
select is((select mime_type || ' ' || size_bytes from public.daily_report_attachments a join t_report r on r.id = a.report_id), 'image/png 2048',
          'REGRESSION: the row carries the stored file''s real type and size, not the claim');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$insert into public.daily_report_attachments (report_id, storage_path, file_name, mime_type, size_bytes)
                   select id, folder || 'eeeeeeee-0000-4000-8000-000000000003-page.jpg', 'page.jpg', 'image/jpeg', 300 from t_report$$,
          '23514', null, 'A stored object of a type outside the allowed list cannot be attached, whatever is claimed');
select ok(app.report_has_file_room((select folder || 'x.jpg' from t_report)), 'With two files stored and a limit of 10, there is room');
select lives_ok($$insert into storage.objects (bucket_id, name, owner) select 'daily-report-files', folder || 'eeeeeeee-0000-4000-8000-000000000004-ok.jpg', '11111111-0000-0000-0000-000000000015' from t_report$$,
          'The author uploads to their open report while there is room');
select pg_temp.sys();
update public.workspace_settings set attachment_max_files = 3 where id = 1;
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) select 'daily-report-files', folder || 'eeeeeeee-0000-4000-8000-000000000005-more.jpg', '11111111-0000-0000-0000-000000000015' from t_report$$,
          '42501', null, 'REGRESSION: Storage refuses an upload beyond the per-report limit, recorded or not');
select pg_temp.act_as('11111111-0000-0000-0000-000000000016');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) select 'daily-report-files', folder || 'eeeeeeee-0000-4000-8000-000000000006-x.jpg', '11111111-0000-0000-0000-000000000016' from t_report$$,
          '42501', null, 'A colleague still cannot upload into someone else''s report');
select pg_temp.sys();
update public.workspace_settings set attachment_max_files = 10 where id = 1;

-- ===================================================================== SEC-5 · forced password change
select pg_temp.act_as('11111111-0000-0000-0000-000000000012');
select throws_ok($$update public.profiles set must_change_password = true where id = '11111111-0000-0000-0000-000000000012'$$,
          '42501', null, 'A user cannot write the password-change flag (either way)');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.profiles set must_change_password = true where id = '11111111-0000-0000-0000-000000000015'$$, 'An Admin requires a user to change their password');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select is((select count(*)::int from public.profiles where id = '11111111-0000-0000-0000-000000000015'), 1, 'A must-change session still reads its own profile');
select is((select count(*)::int from public.projects) + (select count(*)::int from public.tasks) + (select count(*)::int from public.daily_reports)
          + (select count(*)::int from public.notifications) + (select count(*)::int from public.activity_log) + (select count(*)::int from public.departments), 0,
          'REGRESSION: a must-change session reads no projects, tasks, reports, notifications, log or departments');
select throws_ok($$select public.save_daily_report(jsonb_build_object('project_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'update_text', 'bypass'))$$,
          '42501', null, 'REGRESSION: a must-change session cannot save a daily report through the API');
select throws_ok($$select public.complete_task('bbbbbbbb-0000-0000-0000-000000000201')$$, '42501', null, 'nor complete a task');
select is((select jsonb_array_length(d -> 'projects') + jsonb_array_length(d -> 'assigned_tasks') from public.my_dashboard() d), 0, 'and its dashboard is empty');
update public.profiles set must_change_password = false where id = '11111111-0000-0000-0000-000000000015';
select pg_temp.sys();
select is((select must_change_password from public.profiles where id = '11111111-0000-0000-0000-000000000015'), true,
          'REGRESSION: clearing the flag directly changes nothing');
update auth.users set updated_at = now() where id = '11111111-0000-0000-0000-000000000015';
select is((select must_change_password from public.profiles where id = '11111111-0000-0000-0000-000000000015'), true, 'An Auth update that is not a password change leaves the flag');
update auth.users set encrypted_password = extensions.crypt('a-new-password-1', extensions.gen_salt('bf')) where id = '11111111-0000-0000-0000-000000000015';
select is((select must_change_password from public.profiles where id = '11111111-0000-0000-0000-000000000015'), false, 'Storing a new password in Supabase Auth clears the flag');
select pg_temp.act_as('11111111-0000-0000-0000-000000000015');
select ok((select count(*) from public.projects) > 0 and (select count(*) from public.tasks) > 0, 'After the change the session works again');
select throws_ok($$select public.custom_access_token_hook(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000015', 'claims', '{}'::jsonb))$$,
          '42501', null, 'The token hook is not callable by a signed-in user');
select pg_temp.sys();
update public.profiles set must_change_password = true where id = '11111111-0000-0000-0000-000000000016';
select is((public.custom_access_token_hook(jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000016', 'claims', '{}'::jsonb)) -> 'claims')
            - 'user_role', '{"user_active": true, "must_change_password": true}'::jsonb, 'The access token carries the flag for routing');
update public.profiles set must_change_password = false where id = '11111111-0000-0000-0000-000000000016';
-- an Admin who must change their own password is not an Admin until they do
update public.profiles set must_change_password = true where id = '11111111-0000-0000-0000-000000000001';
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select ok(not app.is_admin() and (select count(*) from public.profiles) = 1, 'A must-change Admin has no admin access');
select pg_temp.sys();
update public.profiles set must_change_password = false where id = '11111111-0000-0000-0000-000000000001';

-- ===================================================================== SEC-6 · deactivated accounts
insert into public.notifications (user_id, type, title) values ('11111111-0000-0000-0000-000000000013', 'task_assigned', 'Before deactivation');
create temp table t_before on commit drop as
  select count(*)::int as n, count(*) filter (where read_at is not null)::int as n_read from public.notifications where user_id = '11111111-0000-0000-0000-000000000013';
grant select on t_before to authenticated;
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select ok((select count(*) from public.notifications) > 0 and (select count(*) from public.notification_preferences) > 0, 'An active user reads their notifications and preferences');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.profiles set active = false where id = '11111111-0000-0000-0000-000000000013'$$, 'An Admin deactivates the user');
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select is((select count(*)::int from public.notifications) + (select count(*)::int from public.notification_preferences) + (select count(*)::int from public.activity_log)
          + (select count(*)::int from public.projects) + (select count(*)::int from public.tasks) + (select count(*)::int from public.task_comments), 0,
          'REGRESSION: a deactivated session reads nothing — not even its own notifications, preferences or log rows');
update public.notifications set read_at = now() where user_id = '11111111-0000-0000-0000-000000000013';
delete from public.notifications where user_id = '11111111-0000-0000-0000-000000000013';
update public.profiles set full_name = 'Still here' where id = '11111111-0000-0000-0000-000000000013';
select pg_temp.sys();
select ok((select count(*)::int = (select n from t_before) and count(*) filter (where read_at is not null)::int = (select n_read from t_before)
             from public.notifications where user_id = '11111111-0000-0000-0000-000000000013')
          and (select full_name <> 'Still here' from public.profiles where id = '11111111-0000-0000-0000-000000000013'),
          'REGRESSION: a deactivated session can change nothing: notifications and its own name are untouched');
update public.profiles set active = true where id = '11111111-0000-0000-0000-000000000013';
select pg_temp.act_as('11111111-0000-0000-0000-000000000013');
select ok((select count(*)::int from public.notifications) = (select n from t_before) and (select count(*) from public.projects) > 0, 'Reactivating restores access');

-- ===================================================================== SEC-3 · demotion ends elevated access
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select ok(app.heads_department('d0000000-0000-0000-0000-000000000005') and app.manages_project('aaaaaaaa-0000-0000-0000-000000000001'),
          'Before: the Department Head heads R&D and manages its project');
select lives_ok($$update public.tasks set priority = 'High' where id = 'bbbbbbbb-0000-0000-0000-000000000103'$$, 'Before: they can edit a colleague''s task in it');
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.profiles set role = 'engineer' where id = '11111111-0000-0000-0000-000000000002'$$, 'An Admin demotes the Department Head to engineer');
select pg_temp.sys();
select is((select count(*)::int from public.department_heads where user_id = '11111111-0000-0000-0000-000000000002')
          + (select count(*)::int from public.project_members where user_id = '11111111-0000-0000-0000-000000000002' and member_role = 'pm')
          + (select count(*)::int from public.projects where pm_id = '11111111-0000-0000-0000-000000000002'), 0,
          'The demotion removes their headships, project PM roles and lead-PM assignments');
select ok(exists (select 1 from public.project_members where user_id = '11111111-0000-0000-0000-000000000002' and member_role = 'engineer' and removed_at is null)
          and exists (select 1 from public.activity_log where subject_user_id = '11111111-0000-0000-0000-000000000002' and details like 'Role changed from dept_head to engineer%'),
          'They stay on their projects as an engineer, and the change is logged');
-- even if rows were left behind (as before this migration), the live role decides
set local session_replication_role = replica;
insert into public.department_heads (department_id, user_id) values ('d0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002');
update public.project_members set member_role = 'pm' where user_id = '11111111-0000-0000-0000-000000000002';
set local session_replication_role = origin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select ok(not app.heads_department('d0000000-0000-0000-0000-000000000005') and not app.manages_project('aaaaaaaa-0000-0000-0000-000000000001')
          and not app.is_project_pm('aaaaaaaa-0000-0000-0000-000000000001'),
          'REGRESSION: with stale headship and PM rows still present, a demoted user manages nothing');
select throws_ok($$update public.tasks set priority = 'Low' where id = 'bbbbbbbb-0000-0000-0000-000000000103'$$, '42501', null,
          'REGRESSION: they can no longer edit a colleague''s task');
select throws_ok($$select public.grant_extension('bbbbbbbb-0000-0000-0000-000000000103', now() + interval '9 days', 'self-service')$$, '42501', null, 'nor grant an extension');
select throws_ok($$select * from public.performance_summary(null, null, 'd0000000-0000-0000-0000-000000000005')$$, '42501', null, 'nor read the department''s performance');
select throws_ok($$insert into public.projects (code, name, department_id) values ('PXX', 'Sneaky', 'd0000000-0000-0000-0000-000000000005')$$, '42501', null, 'nor create a project');
select is((select count(*)::int from public.profiles where department_id = 'd0000000-0000-0000-0000-000000000005' and id <> '11111111-0000-0000-0000-000000000002'
              and id not in (select m.user_id from public.project_members m where m.removed_at is null and m.project_id in
                               (select project_id from public.project_members where user_id = '11111111-0000-0000-0000-000000000002' and removed_at is null))), 0,
          'nor read department colleagues they share no project with');
select ok((select count(*) from public.tasks where project_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0, 'They still see the project as a member');
-- a PM demoted to engineer
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select lives_ok($$update public.profiles set role = 'engineer' where id = '11111111-0000-0000-0000-000000000003'$$, 'An Admin demotes a Project Manager to engineer');
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select ok(not app.manages_project('aaaaaaaa-0000-0000-0000-000000000002') and app.is_project_member('aaaaaaaa-0000-0000-0000-000000000002'),
          'REGRESSION: the former PM is an ordinary member of the project and manages nothing');
select throws_ok($$select public.set_task_deadline('bbbbbbbb-0000-0000-0000-000000000202', now() + interval '3 days')$$, '42501', null, 'and cannot set deadlines any more');

select * from finish();
rollback;
