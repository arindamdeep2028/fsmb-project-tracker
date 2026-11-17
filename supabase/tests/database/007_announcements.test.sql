-- =============================================================================
-- FSMB · Migration 26: announcements (pgTAP). Publisher rights, department / project visibility, Admin sees all,
-- edits keep the original author and time, read state per user, expiry, pinning.
-- Self-contained: builds its own departments, people and projects, so it runs on the seed or on imported data.
-- One transaction, rolled back.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

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
-- publish (or edit, when p_id is given) through the app's RPC
create or replace function pg_temp.ann(p_kind text, p_project uuid, p_depts uuid[], p_title text,
                                       p_priority text default 'Normal', p_pinned boolean default false,
                                       p_expires date default null, p_id uuid default null) returns uuid
language sql as $$
  select public.save_announcement(jsonb_build_object(
    'id', p_id, 'kind', p_kind, 'project_id', p_project, 'department_ids', to_jsonb(coalesce(p_depts, '{}')),
    'title', p_title, 'message', p_title || ' — details', 'priority', p_priority, 'pinned', p_pinned,
    'expires_on', p_expires));
$$;
create or replace function pg_temp.sees(p_title text) returns boolean language sql as $$
  select exists (select 1 from public.announcement_feed() f where f.title = p_title);
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.sys(), pg_temp.sees(text),
  pg_temp.ann(text, uuid, uuid[], text, text, boolean, date, uuid) to authenticated, anon;

-- ---------- fixtures --------------------------------------------------------------
-- departments SW …d1, EE …d2, ME …d3, OPT …d4 (names unique to this test)
insert into public.departments (id, name, sort_order) values
  ('7d000000-0000-0000-0000-0000000000d1', 'zz SW Team', 901),
  ('7d000000-0000-0000-0000-0000000000d2', 'zz EE Team', 902),
  ('7d000000-0000-0000-0000-0000000000d3', 'zz ME Team', 903),
  ('7d000000-0000-0000-0000-0000000000d4', 'zz Optical Team', 904);

-- people: admin …01 | head of EE …02 | PM (profile SW, PM of project X in ME) …03 | PM (profile OPT, no project) …04
--         engineers SW …11 (member of X), EE …12, ME …13 (not in X), OPT …14, SW inactive …16
do $$
declare u record;
begin
  for u in select * from (values
    ('7a000000-0000-0000-0000-000000000001'::uuid, 'zz_admin', 'admin',     null::uuid),
    ('7a000000-0000-0000-0000-000000000002'::uuid, 'zz_head',  'dept_head', '7d000000-0000-0000-0000-0000000000d2'::uuid),
    ('7a000000-0000-0000-0000-000000000003'::uuid, 'zz_pm',    'pm',        '7d000000-0000-0000-0000-0000000000d1'::uuid),
    ('7a000000-0000-0000-0000-000000000004'::uuid, 'zz_pm2',   'pm',        '7d000000-0000-0000-0000-0000000000d4'::uuid),
    ('7a000000-0000-0000-0000-000000000011'::uuid, 'zz_sw',    'engineer',  '7d000000-0000-0000-0000-0000000000d1'::uuid),
    ('7a000000-0000-0000-0000-000000000012'::uuid, 'zz_ee',    'engineer',  '7d000000-0000-0000-0000-0000000000d2'::uuid),
    ('7a000000-0000-0000-0000-000000000013'::uuid, 'zz_me',    'engineer',  '7d000000-0000-0000-0000-0000000000d3'::uuid),
    ('7a000000-0000-0000-0000-000000000014'::uuid, 'zz_opt',   'engineer',  '7d000000-0000-0000-0000-0000000000d4'::uuid),
    ('7a000000-0000-0000-0000-000000000016'::uuid, 'zz_gone',  'engineer',  '7d000000-0000-0000-0000-0000000000d1'::uuid),
    -- head of ME with no department of their own and no project membership: sees ME / project X only as head
    ('7a000000-0000-0000-0000-000000000005'::uuid, 'zz_head2', 'dept_head', null::uuid)
  ) v(id, login, role, dept)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.login || '@test.local', '', now(),
            jsonb_build_object('role', u.role, 'department_id', u.dept, 'must_change_password', false),
            jsonb_build_object('full_name', initcap(replace(u.login, '_', ' ')), 'login_name', u.login), now(), now(), '', '', '', '');
  end loop;
end $$;
update public.profiles set active = false where id = '7a000000-0000-0000-0000-000000000016';
insert into public.department_heads (department_id, user_id) values ('7d000000-0000-0000-0000-0000000000d2', '7a000000-0000-0000-0000-000000000002'),
                                                                   ('7d000000-0000-0000-0000-0000000000d3', '7a000000-0000-0000-0000-000000000005');
insert into public.projects (id, code, name, department_id) values
  ('7b000000-0000-0000-0000-0000000000a1', 'ZZX', 'Project X', '7d000000-0000-0000-0000-0000000000d3'),
  ('7b000000-0000-0000-0000-0000000000a2', 'ZZY', 'Project Y', '7d000000-0000-0000-0000-0000000000d1');
insert into public.project_members (project_id, user_id, member_role) values
  ('7b000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-000000000003', 'pm'),
  ('7b000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-000000000011', 'engineer'),
  ('7b000000-0000-0000-0000-0000000000a2', '7a000000-0000-0000-0000-000000000016', 'engineer');
create temp table n_before as select count(*) n from public.notifications;
grant select on n_before to authenticated;

-- ===================================================================== publishing rights
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'eng general')$$, '42501', null,
                 'An engineer cannot publish a general announcement, even to their own department');
select throws_ok($$select pg_temp.ann('project', '7b000000-0000-0000-0000-0000000000a1', null, 'eng project')$$, '42501', null,
                 'An engineer cannot publish a project announcement, even in their own project');
select is((select count(*)::int from jsonb_array_elements(public.announcement_targets()->'departments')), 0, 'An engineer is offered no departments');

select pg_temp.act_as('7a000000-0000-0000-0000-000000000003');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'PM to SW')$$, 'A PM publishes to their own department');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1,7d000000-0000-0000-0000-0000000000d3}', 'PM to SW+ME', 'Important', true)$$,
                'A PM publishes to several departments (own + the department of a project they manage)');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d2}', 'PM to EE')$$, '42501', null,
                 'A PM cannot publish to a department they have no authority in');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1,7d000000-0000-0000-0000-0000000000d2}', 'PM to SW+EE')$$, '42501', null,
                 'One unauthorised department refuses the whole announcement');
select lives_ok($$select pg_temp.ann('project', '7b000000-0000-0000-0000-0000000000a1', null, 'X kickoff', 'Urgent')$$, 'A PM publishes for their own project');
select throws_ok($$select pg_temp.ann('project', '7b000000-0000-0000-0000-0000000000a2', null, 'Y by wrong PM')$$, '42501', null,
                 'A PM cannot publish for a project they do not manage');
select is((select count(*)::int from jsonb_array_elements(public.announcement_targets()->'projects')), 1, 'A PM is offered only the projects they manage');

select pg_temp.act_as('7a000000-0000-0000-0000-000000000004');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d4}', 'PM2 to OPT')$$, 'A PM with no project publishes to their own department');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'PM2 to SW')$$, '42501', null, '…but not to another department');

select pg_temp.act_as('7a000000-0000-0000-0000-000000000002');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d2}', 'Head to EE')$$, 'A department head publishes to the department they head');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d4}', 'Head to OPT')$$, '42501', null, '…but not to another one');

select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1,7d000000-0000-0000-0000-0000000000d2,7d000000-0000-0000-0000-0000000000d3,7d000000-0000-0000-0000-0000000000d4}', 'Admin to all four')$$,
                'Admin publishes to all four departments at once');
select lives_ok($$select pg_temp.ann('project', '7b000000-0000-0000-0000-0000000000a2', null, 'Y by admin')$$, 'Admin publishes for any project');
select throws_ok($$select pg_temp.ann('general', null, '{}', 'no departments')$$, '22023', null, 'A general announcement needs a department');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'past expiry', 'Normal', false, current_date - 2)$$, '22023', null,
                 'The expiry date cannot be in the past');

-- ===================================================================== reading: departments
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select ok(pg_temp.sees('PM to SW') and pg_temp.sees('PM to SW+ME') and pg_temp.sees('Admin to all four'), 'SW engineer sees SW announcements');
select ok(not pg_temp.sees('Head to EE') and not pg_temp.sees('PM2 to OPT'), 'SW engineer does not see EE or Optical ones');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000012');
select ok(pg_temp.sees('Head to EE') and pg_temp.sees('Admin to all four') and not pg_temp.sees('PM to SW'), 'EE engineer sees EE only');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000013');
select ok(pg_temp.sees('PM to SW+ME') and not pg_temp.sees('PM to SW') and pg_temp.sees('Admin to all four'), 'ME engineer sees the SW+ME one, not the SW-only one');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000014');
select ok(pg_temp.sees('PM2 to OPT') and pg_temp.sees('Admin to all four') and not pg_temp.sees('Head to EE'), 'Optical engineer sees Optical only');
select is((select count(*)::int from public.announcements where title = 'PM to SW'), 0, 'Direct table reads are filtered by RLS too');

-- ===================================================================== reading: projects
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select ok(pg_temp.sees('X kickoff'), 'A project member sees the project announcement');
select ok(not pg_temp.sees('Y by admin'), 'A non-member does not see another project''s announcement');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000013');
select ok(not pg_temp.sees('X kickoff'), 'Same department as the project is not enough: membership is required');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000016');
select is((select count(*)::int from public.announcement_feed()), 0, 'An inactive account sees nothing (even its own project)');

-- ===================================================================== Admin sees everything
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.announcement_feed() where title in
           ('PM to SW', 'PM to SW+ME', 'X kickoff', 'PM2 to OPT', 'Head to EE', 'Admin to all four', 'Y by admin')), 7,
          'Admin sees every announcement, whoever published it and whatever it targets');
select ok((select bool_and(can_edit) from public.announcement_feed() where title like 'PM%' or title = 'X kickoff'), 'Admin may manage every announcement');
select is((select author_name || ' / ' || author_role from public.announcement_feed() where title = 'PM to SW'), 'Zz Pm / pm', 'The feed names the author and role');
select is((select department_names from public.announcement_feed() where title = 'PM to SW+ME'), '{"zz SW Team","zz ME Team"}'::text[], 'The feed lists the target departments');
select is((select project_code from public.announcement_feed() where title = 'X kickoff'), 'ZZX', 'The feed names the project');

-- ===================================================================== "Read by X of Y": Y = everyone RLS lets see it
-- Admins (fixture + any already in the database) see everything, so every audience includes all active admins.
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d3}', 'Admin to ME')$$, 'Admin publishes to ME only');
select pg_temp.sys();
create temp table admins as select count(*)::int n from public.profiles where role = 'admin' and active;
grant select on admins to authenticated;
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
select is((select audience from public.announcement_feed() where title = 'X kickoff'), (select n from admins) + 3,
          'Project audience: PM + member + the project department''s head who is NOT a member + Admins (non-member of the same department excluded)');
select is((select audience from public.announcement_feed() where title = 'Admin to ME'), (select n from admins) + 3,
          'General audience: ME staff + the ME head + a PM from another department who manages an ME project + Admins');
select is((select audience from public.announcement_feed() where title = 'Head to EE'), (select n from admins) + 2,
          'General audience: the EE head (also EE staff) + EE engineer + Admins');
select is((select audience from public.announcement_feed() where title = 'PM to SW+ME'), (select n from admins) + 4,
          'Multi-department audience counts each person once; an inactive SW user is left out');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000005');
select ok(pg_temp.sees('X kickoff') and pg_temp.sees('Admin to ME') and not pg_temp.sees('Head to EE'),
          'The ME head (no membership, no own department) really can see the project and ME announcements');
insert into public.announcement_reads (announcement_id) select id from public.announcements where title = 'X kickoff';
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
select is((select readers from public.announcement_feed() where title = 'X kickoff'), 1, 'A read by a non-member head counts in X');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select ok((select readers is null and audience is null from public.announcement_feed() where title = 'X kickoff'),
          'Read by X of Y is hidden from people who cannot manage the announcement');

-- Alignment, exhaustively: for every person in the database and every announcement in this test, what RLS shows
-- that person (acting as them) equals the per-user rule the audience is counted with.
select pg_temp.sys();
create temp table vis (uid uuid, title text, seen boolean, rule boolean);
grant all on vis to authenticated;
do $$
declare u uuid; t text;
begin
  -- (accounts still forced to change their password are blocked for that session only; they stay in the audience)
  for u in select id from public.profiles where not must_change_password loop
    perform pg_temp.act_as(u);
    for t in select unnest(array['PM to SW', 'PM to SW+ME', 'X kickoff', 'PM2 to OPT', 'Head to EE', 'Admin to all four', 'Y by admin', 'Admin to ME']) loop
      insert into vis values (u, t, exists (select 1 from public.announcements a where a.title = t), null);
    end loop;
  end loop;
  perform pg_temp.sys();
end $$;
update vis set rule = app.user_can_read_announcement(vis.uid, a.id, a.kind, a.project_id, a.author_id)
  from public.announcements a where a.title = vis.title;
select is((select count(*)::int from vis where seen is distinct from rule), 0,
          'For every user × announcement, RLS visibility == the audience rule (no one missed, no one extra)');
select ok((select count(*) from vis where seen) > 0 and (select count(*) from vis where not seen) > 0, '…and the comparison covered both visible and hidden cases');
select is((select audience from (select (app.announcement_reach(a.id)).* from public.announcements a where a.title = 'X kickoff') r), null::int,
          'Without a signed-in manager, the reach function reveals nothing');

-- ===================================================================== editing keeps author and time
select pg_temp.sys();
update public.announcements set published_at = now() - interval '2 days' where title = 'PM to SW';
create temp table orig as select id, author_id, published_at from public.announcements where title = 'PM to SW';
grant select on orig to authenticated;
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
select lives_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'PM to SW (edited)', 'Urgent', false, null, (select id from orig))$$,
                'Admin edits a PM''s announcement');
select pg_temp.sys();
select ok((select a.author_id = o.author_id and a.published_at = o.published_at and a.updated_by = '7a000000-0000-0000-0000-000000000001'
             from public.announcements a join orig o on o.id = a.id), 'The original author and publication time stay; the editor is recorded');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000003');
select throws_ok($$update public.announcements set author_id = '7a000000-0000-0000-0000-000000000001' where id = (select id from orig)$$, '42501', null,
                 'The author cannot be changed by anyone (no column privilege)');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'hijack', 'Normal', false, null,
                   (select id from public.announcements where title = 'Admin to all four'))$$, '42501', null,
                 'A PM cannot edit an announcement that targets departments outside their authority');
select throws_ok($$select pg_temp.ann('project', '7b000000-0000-0000-0000-0000000000a1', null, 'kind switch', 'Normal', false, null, (select id from orig))$$, '22023', null,
                 'The type of an announcement cannot change');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select throws_ok($$select pg_temp.ann('general', null, '{7d000000-0000-0000-0000-0000000000d1}', 'eng edit', 'Normal', false, null, (select id from orig))$$, '42501', null,
                 'An engineer cannot edit an announcement they can read');
delete from public.announcements where title = 'PM to SW (edited)';
select pg_temp.sys();
select is((select count(*)::int from public.announcements where title = 'PM to SW (edited)'), 1, 'An engineer cannot delete it either');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000003');
select lives_ok($$insert into public.announcements (kind, project_id, title, message, author_id)
                  values ('project', '7b000000-0000-0000-0000-0000000000a1', 'forged author', 'x', '7a000000-0000-0000-0000-000000000001')$$,
                'A direct insert naming someone else as author…');
select is((select author_id from public.announcements where title = 'forged author'), '7a000000-0000-0000-0000-000000000003'::uuid, '…is stamped with the real author');

-- ===================================================================== read state, pinning, expiry
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
create temp table c0 as select public.announcement_unread_count() n;
select is((select n from c0), 5, 'SW engineer: 5 unread (SW, SW+ME, all four, X kickoff, forged author)');
select is((select title from public.announcement_feed() limit 1), 'PM to SW+ME', 'Pinned announcements come first');
insert into public.announcement_reads (announcement_id) select id from public.announcements where title = 'X kickoff';
select is(public.announcement_unread_count(), 4, 'Opening one lowers the unread count by one');
select ok((select read_at is not null from public.announcement_feed() where title = 'X kickoff'), '…and it stays in the feed, marked read');
select throws_ok($$insert into public.announcement_reads (announcement_id) select id from public.announcements where title = 'X kickoff'$$, '23505', null,
                 'A read mark is stored once');
select throws_ok($$insert into public.announcement_reads (announcement_id, user_id) select id, '7a000000-0000-0000-0000-000000000012' from public.announcements where title = 'X kickoff'$$,
                 '42501', null, 'Nobody can mark an announcement read for someone else');
select pg_temp.act_as('7a000000-0000-0000-0000-000000000012');
select is((select count(*)::int from public.announcement_reads where user_id = '7a000000-0000-0000-0000-000000000011'), 0, 'Read marks are private to their reader');
select pg_temp.sys();
create temp table x_id as select id from public.announcements where title = 'X kickoff';
grant select on x_id to authenticated;
select pg_temp.act_as('7a000000-0000-0000-0000-000000000012');
select throws_ok($$insert into public.announcement_reads (announcement_id) select id from x_id$$, '42501', null,
                 'Nobody can mark read an announcement they cannot see');
select pg_temp.sys();
update public.announcements set expires_at = now() - interval '1 minute' where title = 'Admin to all four';
select pg_temp.act_as('7a000000-0000-0000-0000-000000000011');
select is(public.announcement_unread_count(), 3, 'An expired announcement leaves the unread count');
select ok((select expired from public.announcement_feed() where title = 'Admin to all four'), '…but is still in the database, flagged expired');
select is(public.mark_all_announcements_read(), 3, 'Mark all read marks the active ones');
select is(public.announcement_unread_count(), 0, 'Nothing unread after that');

-- ===================================================================== integrity, Notifications untouched
select pg_temp.sys();
insert into public.announcements (kind, title, message) values ('general', 'orphan', 'x');
select throws_ok($$set constraints all immediate$$, '23514', null, 'A general announcement without departments is refused at commit');

select is((select count(*) from public.notifications), (select n from n_before), 'Announcements create no Notifications rows');

select * from finish();
rollback;
