-- =============================================================================
-- FSMB seed data — LOCAL AND STAGING ONLY. Never run against production.
-- `supabase db reset` runs this automatically after the migrations.
-- All seeded users sign in with password:  Fsmb@12345   (email = <login>@fsmb.local)
--
-- Personas (fixed UUIDs so the RLS tests can refer to them):
--   Rashidul Hasan  admin                                   …0001
--   Morsalin        dept_head, heads R&D, PM of P01         …0002
--   Abrar           pm (Mechanical), PM of P02              …0003
--   Peash           pm (Software), PM of P03                …0004
--   Shorif, Imam, Masrur, Deep, Araf, Arif, Rafi  engineers …0011–0017 (Imam is in P01 and P02)
--   Anik            engineer, INACTIVE                      …0018
--   Deep            removed from P02 (removed-member case)
-- =============================================================================

-- ---------- Departments (Excel Lists!B + Installation & Service) ----------
insert into public.departments (id, name, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', 'Electrical', 1),
  ('d0000000-0000-0000-0000-000000000002', 'Mechanical', 2),
  ('d0000000-0000-0000-0000-000000000003', 'Software', 3),
  ('d0000000-0000-0000-0000-000000000004', 'Optics', 4),
  ('d0000000-0000-0000-0000-000000000005', 'R&D', 5),
  ('d0000000-0000-0000-0000-000000000006', 'Logistics', 6),
  ('d0000000-0000-0000-0000-000000000007', 'HR', 7),
  ('d0000000-0000-0000-0000-000000000008', 'Admin', 8),
  ('d0000000-0000-0000-0000-000000000009', 'Sales & Marketing', 9),
  ('d0000000-0000-0000-0000-000000000010', 'Production', 10),
  ('d0000000-0000-0000-0000-000000000011', 'Installation & Service', 11)
on conflict (id) do nothing;

-- ---------- Users: auth.users → trigger creates profiles + notification preferences ----------
do $$
declare
  u record;
begin
  for u in select * from (values
    ('11111111-0000-0000-0000-000000000001'::uuid, 'rashidul', 'Rashidul Hasan', 'admin',     'd0000000-0000-0000-0000-000000000008'),
    ('11111111-0000-0000-0000-000000000002'::uuid, 'morsalin', 'Morsalin',       'dept_head', 'd0000000-0000-0000-0000-000000000005'),
    ('11111111-0000-0000-0000-000000000003'::uuid, 'abrar',    'Abrar',          'pm',        'd0000000-0000-0000-0000-000000000002'),
    ('11111111-0000-0000-0000-000000000004'::uuid, 'peash',    'Peash',          'pm',        'd0000000-0000-0000-0000-000000000003'),
    ('11111111-0000-0000-0000-000000000011'::uuid, 'shorif',   'Shorif',         'engineer',  'd0000000-0000-0000-0000-000000000005'),
    ('11111111-0000-0000-0000-000000000012'::uuid, 'imam',     'Imam',           'engineer',  'd0000000-0000-0000-0000-000000000002'),
    ('11111111-0000-0000-0000-000000000013'::uuid, 'masrur',   'Masrur',         'engineer',  'd0000000-0000-0000-0000-000000000011'),
    ('11111111-0000-0000-0000-000000000014'::uuid, 'deep',     'Deep',           'engineer',  'd0000000-0000-0000-0000-000000000007'),
    ('11111111-0000-0000-0000-000000000015'::uuid, 'araf',     'Araf',           'engineer',  'd0000000-0000-0000-0000-000000000002'),
    ('11111111-0000-0000-0000-000000000016'::uuid, 'arif',     'Arif',           'engineer',  'd0000000-0000-0000-0000-000000000002'),
    ('11111111-0000-0000-0000-000000000017'::uuid, 'rafi',     'Rafi',           'engineer',  'd0000000-0000-0000-0000-000000000001'),
    ('11111111-0000-0000-0000-000000000018'::uuid, 'anik',     'Anik',           'engineer',  'd0000000-0000-0000-0000-000000000009')
  ) v(id, login, full_name, role, dept)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
            u.login || '@fsmb.local', extensions.crypt('Fsmb@12345', extensions.gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                               'role', u.role, 'department_id', u.dept, 'must_change_password', false),
            jsonb_build_object('full_name', u.full_name, 'login_name', u.login, 'legacy_name', u.full_name),
            now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.login || '@fsmb.local', 'email_verified', true),
            'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

update public.profiles set active = false where id = '11111111-0000-0000-0000-000000000018';   -- Anik: inactive

insert into public.department_heads (department_id, user_id)
values ('d0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002')        -- Morsalin heads R&D
on conflict do nothing;

update public.workspace_settings set digest_email = 'admin@fsmb.local' where id = 1;

-- ---------- Projects (lead PM membership is created by trigger) ----------
insert into public.projects (id, code, name, description, department_id, pm_id, status, start_date, target_end, notes, is_demo) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'P01', 'MW800 Documentation', 'User manual and training material for the MW800',
   'd0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', 'Active',
   current_date - 10, current_date + 20, 'Sample project', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'P02', 'Robot Accuracy Testing (Broadcom)', 'Repeatability and accuracy runs',
   'd0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 'Active',
   current_date - 7, current_date + 7, 'Sample project', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'P03', 'Firmware Update Tool', 'Field update utility',
   'd0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004', 'Active',
   current_date - 5, current_date + 30, 'Sample project (other department)', true)
on conflict (id) do nothing;

insert into public.project_members (project_id, user_id, member_role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000011', 'engineer'),  -- Shorif
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000012', 'engineer'),  -- Imam
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000013', 'engineer'),  -- Masrur
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000014', 'engineer'),  -- Deep
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000015', 'engineer'),  -- Araf
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000016', 'engineer'),  -- Arif
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000012', 'engineer'),  -- Imam (2nd project)
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000014', 'engineer'),  -- Deep (removed below)
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000017', 'engineer')   -- Rafi
on conflict do nothing;

update public.project_members set removed_at = now()
 where project_id = 'aaaaaaaa-0000-0000-0000-000000000002' and user_id = '11111111-0000-0000-0000-000000000014';

-- ---------- Responsibilities (top-level tasks) and subtasks; codes are generated ----------
insert into public.tasks (id, project_id, parent_id, title, priority, assigned_to, assigned_by, assigned_on,
                          status, plan_submitted_at, progress_pct, contribution_pct, planned_due_at,
                          blocker_note, completed_on, last_update) values
  -- P01
  ('bbbbbbbb-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-000000000001', null,
   'Collect MW800 training materials', 'High', '11111111-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001',
   now() - interval '3 days', 'Completed', now() - interval '3 days' + interval '1 hour', 100, 25, null, null,
   now() - interval '3 days' + interval '6 hours', current_date - 3),
  ('bbbbbbbb-0000-0000-0000-000000000102', 'aaaaaaaa-0000-0000-0000-000000000001', null,
   'Draft user manual — measurement chapter', 'Important', '11111111-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000002',
   now() - interval '2 days', 'In progress', now() - interval '2 days' + interval '1 hour', 0, 40, now() + interval '5 days', null,
   null, current_date),
  ('bbbbbbbb-0000-0000-0000-000000000103', 'aaaaaaaa-0000-0000-0000-000000000001', null,
   'Internal review of chapter 1', 'Normal', '11111111-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000002',
   now() - interval '2 days', 'Blocked', now() - interval '2 days' + interval '2 hours', 30, 20, now() + interval '2 days',
   'Waiting for FSMT template approval', null, current_date - 1),
  ('bbbbbbbb-0000-0000-0000-000000000104', 'aaaaaaaa-0000-0000-0000-000000000001', null,
   'Send draft outline to Dr. Liao', 'High', '11111111-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000002',
   now() - interval '1 day', 'Not started', null, 0, 15, null, null, null, null),
  -- P02
  ('bbbbbbbb-0000-0000-0000-000000000201', 'aaaaaaaa-0000-0000-0000-000000000002', null,
   'Fixture alignment jig drawing', 'High', '11111111-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000003',
   now() - interval '1 day', 'Plan submitted', now() - interval '1 day' + interval '2 hours', 0, 30, now() + interval '3 days',
   null, null, current_date),
  ('bbbbbbbb-0000-0000-0000-000000000202', 'aaaaaaaa-0000-0000-0000-000000000002', null,
   '30-cycle repeatability run', 'Important', '11111111-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000003',
   now() - interval '1 day', 'Not started', null, 0, 40, null, null, null, null),
  ('bbbbbbbb-0000-0000-0000-000000000203', 'aaaaaaaa-0000-0000-0000-000000000002', null,
   'Broadcom data summary report', 'Important', '11111111-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000003',
   now() - interval '2 days', 'In progress', now() - interval '2 days' + interval '1 hour', 20, 30, null, null, null, current_date),
  -- P03 (Software — outside Morsalin's department)
  ('bbbbbbbb-0000-0000-0000-000000000301', 'aaaaaaaa-0000-0000-0000-000000000003', null,
   'Bootloader handshake', 'Normal', '11111111-0000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000004',
   now() - interval '1 day', 'In progress', now() - interval '1 day' + interval '1 hour', 10, null, now() + interval '10 days',
   null, null, current_date)
on conflict (id) do nothing;

-- Subtasks of P01-T02 (one per person: the responsibility is shared)
insert into public.tasks (id, project_id, parent_id, title, priority, assigned_to, assigned_by, assigned_on,
                          status, plan_submitted_at, progress_pct, contribution_pct, planned_due_at, last_update) values
  ('bbbbbbbb-0000-0000-0000-000000000105', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000102',
   'Insert calibration figures', 'Normal', '11111111-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000012',
   now() - interval '2 days', 'In progress', now() - interval '2 days' + interval '2 hours', 60, 50, now() + interval '3 days', current_date),
  ('bbbbbbbb-0000-0000-0000-000000000106', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000102',
   'Proofread measurement chapter', 'Normal', '11111111-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000012',
   now() - interval '1 day', 'Not started', null, 0, 50, now() + interval '5 days', null)
on conflict (id) do nothing;

-- ---------- An extension (granted by the P02 PM) ----------
insert into public.task_extensions (task_id, previous_deadline, new_deadline, reason, granted_by)
select id, effective_due_at, now() + interval '1 day', 'Customer data arriving late', '11111111-0000-0000-0000-000000000003'
  from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000203';
update public.tasks set extended_deadline = now() + interval '1 day' where id = 'bbbbbbbb-0000-0000-0000-000000000203';

-- ---------- Daily report written as Imam (runs the same triggers as the app) ----------
-- Session-level claims (is_local = false) so they survive psql's autocommit between statements.
-- JWT claims are transaction-local, so each impersonated block is one transaction.
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000012","role":"authenticated"}', false);
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000012', false);
select public.save_daily_report(jsonb_build_object(
  'project_id', 'aaaaaaaa-0000-0000-0000-000000000001',
  'update_text', 'Inserted 12 of 20 calibration figures; chapter structure agreed.',
  'issues', 'Two figures need re-measurement on the MW800 bench.',
  'next_task_id', 'bbbbbbbb-0000-0000-0000-000000000105',
  'remarks', 'Bench booked for tomorrow 10:00.',
  'items', jsonb_build_array(
     jsonb_build_object('task_id', 'bbbbbbbb-0000-0000-0000-000000000105', 'progress_after', 70,
                        'note', 'Figures 1–12 placed'))));
commit;

-- ---------- PM comment written as Morsalin (notifies Imam) ----------
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', false);
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', false);
insert into public.task_comments (task_id, author_id, body)
values ('bbbbbbbb-0000-0000-0000-000000000102', '11111111-0000-0000-0000-000000000002',
        'Please use the new FSMT figure template for the remaining figures.');
commit;

-- ---------- Log red marks for the sample data ----------
select app.run_red_mark_scan('manual');
