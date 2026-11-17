-- =============================================================================
-- Migration 26 · Announcements (general = department-wide, project = one project's members)
--
-- Separate from Notifications: notifications are per-recipient system messages; an announcement is one row that
-- a set of people may read, with one read mark per reader.
--
-- Who may PUBLISH (and later edit or delete) — enforced by the RLS policies below, not only by the UI:
--   general  Admin: any department. Department Head: departments they head. A Project Manager (role pm or
--            dept_head): their own profile department and the department of every non-archived project they are
--            PM of. Editing a general announcement needs that right for EVERY department it targets.
--   project  app.manages_project(): Admin, the project's PMs, the head of the project's department. Not on an
--            archived project.
-- Who may READ:
--   Admin: everything (never hidden by department or membership).
--   general  people whose profile department is a target, and people who may publish to a target department.
--   project  app.can_see_project(): current project members and the project's managers.
--   The author always sees their own announcements.
-- The original author_id and published_at never change on edit (trigger); updated_by / updated_at record edits.
-- Expired announcements (expires_at in the past) stay in the table; the app leaves them out of active views.
-- Read state is one row per (announcement, reader) in announcement_reads, only ever visible to that reader
-- (and Admin).
--
-- Only new objects; nothing existing changes. Rollback: supabase/rollback_20261001000026.sql, then
--   supabase migration repair --status reverted 20261001000026
-- =============================================================================

-- ---------- Tables ----------------------------------------------------------------
create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('general', 'project')),
  project_id    uuid references public.projects (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  message       text not null check (length(btrim(message)) between 1 and 5000),
  priority      text not null default 'Normal' check (priority in ('Normal', 'Important', 'Urgent')),
  pinned        boolean not null default false,
  expires_at    timestamptz,
  author_id     uuid references public.profiles (id) on delete set null,
  published_at  timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz,
  constraint announcement_kind_project check ((kind = 'project') = (project_id is not null))
);
alter table public.announcements enable row level security;

create table public.announcement_departments (
  announcement_id  uuid not null references public.announcements (id) on delete cascade,
  department_id    uuid not null references public.departments (id) on delete cascade,
  primary key (announcement_id, department_id)
);
alter table public.announcement_departments enable row level security;

create table public.announcement_reads (
  announcement_id  uuid not null references public.announcements (id) on delete cascade,
  user_id          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_reads enable row level security;

create index announcements_published_idx on public.announcements (published_at desc);
create index announcements_project_idx on public.announcements (project_id) where project_id is not null;
create index announcement_departments_dept_idx on public.announcement_departments (department_id);
create index announcement_reads_user_idx on public.announcement_reads (user_id);

-- ---------- Permission helpers (SECURITY DEFINER, empty search_path, like migration 10) ----------
-- Each rule exists once per user (app.user_*: used for the "Read by X of Y" audience) and once for the caller
-- (used by the RLS policies), the caller version being the user version for auth.uid() plus app.session_ok().
-- So the audience is, by construction, exactly the set of people the read policy lets see the announcement.

-- May this user publish a general announcement to this department?
create or replace function app.user_can_announce_to_department(p_uid uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.departments d where d.id = p_dept)
     and (app.user_is_admin(p_uid)
          or app.user_heads_department(p_uid, p_dept)
          or exists (select 1 from public.profiles p
                      where p.id = p_uid and p.active and p.role in ('pm', 'dept_head')
                        and (p.department_id = p_dept
                             or exists (select 1 from public.project_members m
                                          join public.projects pr on pr.id = m.project_id
                                         where m.user_id = p.id and m.member_role = 'pm' and m.removed_at is null
                                           and not pr.archived and pr.department_id = p_dept))));
$$;

-- May the caller publish a general announcement to this department?
create or replace function app.can_announce_to_department(p_dept uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and app.user_can_announce_to_department(auth.uid(), p_dept);
$$;

-- May the caller publish a project announcement for this project?
create or replace function app.can_announce_to_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok()
     and app.user_manages_project(auth.uid(), p_project)
     and exists (select 1 from public.projects pr where pr.id = p_project and not pr.archived);
$$;

-- May the caller edit / delete this announcement? Admin always. Project: manages the project. General: may publish
-- to every department it targets (an announcement still being created, with no departments yet, only its author).
create or replace function app.can_edit_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and (
    app.user_is_admin(auth.uid())
    or exists (select 1 from public.announcements a
                where a.id = p_id
                  and case when a.kind = 'project' then app.user_manages_project(auth.uid(), a.project_id)
                           else case when exists (select 1 from public.announcement_departments ad where ad.announcement_id = a.id)
                                     then not exists (select 1 from public.announcement_departments ad
                                                       where ad.announcement_id = a.id
                                                         and not app.can_announce_to_department(ad.department_id))
                                     else a.author_id = auth.uid() end
                      end));
$$;

-- May this (active) user read this announcement? (row values passed in, so no extra lookup of the row)
create or replace function app.user_can_read_announcement(p_uid uuid, p_id uuid, p_kind text, p_project uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_active(p_uid) and (
    app.user_is_admin(p_uid)
    or p_author = p_uid
    or (p_kind = 'project' and app.user_can_see_project(p_uid, p_project))
    or (p_kind = 'general' and exists (
          select 1 from public.announcement_departments ad
           where ad.announcement_id = p_id
             and (ad.department_id = (select p.department_id from public.profiles p where p.id = p_uid)
                  or app.user_can_announce_to_department(p_uid, ad.department_id)))));
$$;

-- May the caller read this announcement? (the read policy)
create or replace function app.can_read_announcement(p_id uuid, p_kind text, p_project uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and app.user_can_read_announcement(auth.uid(), p_id, p_kind, p_project, p_author);
$$;

create or replace function app.can_read_announcement_id(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.announcements a
                  where a.id = p_id and app.can_read_announcement(a.id, a.kind, a.project_id, a.author_id));
$$;

-- Name and role of an announcement's author/editor. Readers of an announcement may not be able to read that
-- person's profile row (profiles RLS), but they are entitled to see who announced it.
create or replace function app.announcement_person(p_uid uuid)
returns table (full_name text, role public.user_role)
language sql stable security definer set search_path = '' as $$
  select p.full_name, p.role from public.profiles p where p.id = p_uid and app.session_ok();
$$;

-- "Read by X of Y" (only for people who may manage it; null for everyone else). Y = every active user the read
-- policy lets see it — members, PMs, the project's department head, publishers of a target department, Admins and
-- the author — computed with the same rule as the policy (app.user_can_read_announcement). X = how many of them
-- have opened it.
create or replace function app.announcement_reach(p_id uuid)
returns table (readers int, audience int)
language sql stable security definer set search_path = '' as $$
  with a as (select * from public.announcements where id = p_id and app.can_edit_announcement(p_id)),
  aud as (
    select p.id from a join public.profiles p on p.active
     where app.user_can_read_announcement(p.id, a.id, a.kind, a.project_id, a.author_id)
  )
  select (select count(*) from public.announcement_reads r join aud on aud.id = r.user_id where r.announcement_id = p_id)::int,
         (select count(*) from aud)::int
   where exists (select 1 from a);
$$;

-- ---------- Integrity triggers ----------------------------------------------------
-- The database, not the caller, says who published it and when; edits never change that.
create or replace function app.announcements_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
    new.published_at := now();
    new.updated_by := null;
    new.updated_at := null;
  else
    if new.kind is distinct from old.kind then
      raise exception 'An announcement''s type (general or project) cannot be changed. Publish a new one instead.' using errcode = '22023';
    end if;
    new.author_id := old.author_id;
    new.published_at := old.published_at;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_at := now();
  end if;
  new.title := btrim(new.title);
  new.message := btrim(new.message);
  return new;
end $$;
create trigger announcements_before_write before insert or update on public.announcements
  for each row execute function app.announcements_before_write();

-- Checked at commit: a general announcement targets at least one department, a project announcement none.
create or replace function app.announcement_shape_check() returns trigger
language plpgsql security definer set search_path = '' as $$
-- (one function for both tables: the row is read as jsonb, so neither table's column names are compiled in)
declare v_id uuid := coalesce(to_jsonb(new)->>'announcement_id', to_jsonb(old)->>'announcement_id', to_jsonb(new)->>'id')::uuid;
        v_kind text; v_n int;
begin
  select a.kind into v_kind from public.announcements a where a.id = v_id;
  if v_kind is null then return null; end if;                       -- deleted in the same transaction
  select count(*) into v_n from public.announcement_departments where announcement_id = v_id;
  if v_kind = 'general' and v_n = 0 then
    raise exception 'Choose at least one department for a general announcement.' using errcode = '23514';
  elsif v_kind = 'project' and v_n > 0 then
    raise exception 'A project announcement does not target departments.' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger announcements_shape after insert or update on public.announcements
  deferrable initially deferred for each row execute function app.announcement_shape_check();
create constraint trigger announcement_departments_shape after insert or delete on public.announcement_departments
  deferrable initially deferred for each row execute function app.announcement_shape_check();

-- ---------- RLS policies ------------------------------------------------------------
create policy announcements_read on public.announcements for select to authenticated
  using (app.can_read_announcement(id, kind, project_id, author_id));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = (select auth.uid())
              and case when kind = 'project' then app.can_announce_to_project(project_id)
                       else exists (select 1 from public.departments d where d.active and app.can_announce_to_department(d.id)) end);
create policy announcements_update on public.announcements for update to authenticated
  using (app.can_edit_announcement(id))
  with check (case when kind = 'project' then (select app.is_admin()) or app.can_announce_to_project(project_id)
                   else true end);
create policy announcements_delete on public.announcements for delete to authenticated
  using (app.can_edit_announcement(id));

create policy announcement_departments_read on public.announcement_departments for select to authenticated
  using (app.can_read_announcement_id(announcement_id));
create policy announcement_departments_insert on public.announcement_departments for insert to authenticated
  with check (app.can_announce_to_department(department_id) and app.can_edit_announcement(announcement_id));
create policy announcement_departments_delete on public.announcement_departments for delete to authenticated
  using (app.can_announce_to_department(department_id) and app.can_edit_announcement(announcement_id));

create policy announcement_reads_read on public.announcement_reads for select to authenticated
  using ((user_id = (select auth.uid()) and (select app.is_active_user())) or (select app.is_admin()));
create policy announcement_reads_insert on public.announcement_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and app.can_read_announcement_id(announcement_id));
create policy announcement_reads_delete on public.announcement_reads for delete to authenticated
  using (user_id = (select auth.uid()) and (select app.is_active_user()));

-- ---------- RPCs (SECURITY INVOKER: every read and write below goes through the policies above) ----------
-- Everything the caller may read, newest first, pinned first; expired ones included (flagged) so the app can
-- show them under "Expired" for the people who manage them.
create or replace function public.announcement_feed()
returns table (
  id uuid, kind text, project_id uuid, project_code text, project_name text,
  title text, message text, priority text, pinned boolean, expires_at timestamptz, expired boolean,
  published_at timestamptz, author_id uuid, author_name text, author_role public.user_role,
  updated_at timestamptz, updated_by_name text, updated_by_role public.user_role,
  department_ids uuid[], department_names text[], read_at timestamptz, can_edit boolean,
  readers int, audience int)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.kind, a.project_id, pr.code, pr.name,
         a.title, a.message, a.priority, a.pinned, a.expires_at, coalesce(a.expires_at <= now(), false),
         a.published_at, a.author_id, au.full_name, au.role,
         a.updated_at, ed.full_name, ed.role,
         coalesce(dp.ids, '{}'), coalesce(dp.names, '{}'),
         r.read_at, app.can_edit_announcement(a.id),
         rc.readers, rc.audience
    from public.announcements a
    left join public.projects pr on pr.id = a.project_id
    left join lateral app.announcement_person(a.author_id) au on true
    left join lateral app.announcement_person(a.updated_by) ed on true
    left join lateral (select array_agg(d.id order by d.sort_order, d.name) ids,
                              array_agg(d.name::text order by d.sort_order, d.name) names
                         from public.announcement_departments x join public.departments d on d.id = x.department_id
                        where x.announcement_id = a.id) dp on true
    left join public.announcement_reads r on r.announcement_id = a.id and r.user_id = auth.uid()
    left join lateral app.announcement_reach(a.id) rc on true
   order by a.pinned desc, a.published_at desc;
$$;

-- Unread, not expired, visible to the caller (the sidebar badge).
create or replace function public.announcement_unread_count() returns int
language sql stable security invoker set search_path = '' as $$
  select count(*)::int from public.announcements a
   where (a.expires_at is null or a.expires_at > now())
     and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.user_id = auth.uid());
$$;

-- What the caller may publish to: departments (active) and projects (non-archived).
create or replace function public.announcement_targets() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order, d.name)
                               from public.departments d where d.active and app.can_announce_to_department(d.id)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name) order by pr.code)
                            from public.projects pr where not pr.archived and app.can_announce_to_project(pr.id)), '[]'::jsonb));
$$;

-- Create (p.id null) or edit one announcement with its departments, in one transaction.
-- p: {id?, kind, project_id?, department_ids?: uuid[], title, message, priority, pinned, expires_on?: 'yyyy-mm-dd'}
create or replace function public.save_announcement(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := p->>'kind';
  v_project uuid := case when p->>'kind' = 'project' then nullif(p->>'project_id', '')::uuid end;
  v_depts uuid[] := case when p->>'kind' = 'general'
                         then coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(p->'department_ids', '[]')) x), '{}')
                         else '{}' end;
  v_expires_on date := nullif(p->>'expires_on', '')::date;
  v_expires timestamptz;
  v_n int;
begin
  if v_kind not in ('general', 'project') then
    raise exception 'Choose General or Project.' using errcode = '22023';
  end if;
  if v_kind = 'project' and v_project is null then
    raise exception 'Choose a project.' using errcode = '22023';
  end if;
  if v_kind = 'general' and cardinality(v_depts) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if v_expires_on is not null then
    if v_expires_on < app.dhaka_today() then
      raise exception 'The expiry date cannot be in the past.' using errcode = '22023';
    end if;
    v_expires := ((v_expires_on + 1)::timestamp at time zone app.tz());   -- end of that day, Dhaka time
  end if;

  if v_id is null then
    insert into public.announcements (kind, project_id, title, message, priority, pinned, expires_at, author_id)
    values (v_kind, v_project, p->>'title', p->>'message', coalesce(p->>'priority', 'Normal'),
            coalesce((p->>'pinned')::boolean, false), v_expires, auth.uid())
    returning id into v_id;
  else
    update public.announcements a
       set project_id = v_project, title = p->>'title', message = p->>'message',
           priority = coalesce(p->>'priority', 'Normal'), pinned = coalesce((p->>'pinned')::boolean, false),
           expires_at = v_expires, kind = v_kind
     where a.id = v_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'You don''t have permission to do that.' using errcode = '42501';
    end if;
  end if;

  if v_kind = 'general' then
    -- add first, then remove: the editor's right is checked against the departments it already targets
    insert into public.announcement_departments (announcement_id, department_id)
    select v_id, d from unnest(v_depts) d
    on conflict do nothing;
    delete from public.announcement_departments ad
     where ad.announcement_id = v_id and not (ad.department_id = any (v_depts));
    if exists (select 1 from public.announcement_departments ad
                where ad.announcement_id = v_id and not (ad.department_id = any (v_depts))) then
      raise exception 'You don''t have permission to do that.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end $$;

-- Mark every active announcement the caller can see as read.
create or replace function public.mark_all_announcements_read() returns int
language plpgsql volatile security invoker set search_path = '' as $$
declare v_n int;
begin
  insert into public.announcement_reads (announcement_id, user_id)
  select a.id, auth.uid() from public.announcements a
   where (a.expires_at is null or a.expires_at > now())
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- Grants ------------------------------------------------------------------
revoke all on public.announcements, public.announcement_departments, public.announcement_reads from anon, authenticated;
grant select, delete on public.announcements to authenticated;
grant insert (kind, project_id, title, message, priority, pinned, expires_at, author_id) on public.announcements to authenticated;
grant update (kind, project_id, title, message, priority, pinned, expires_at) on public.announcements to authenticated;
grant select, insert, delete on public.announcement_departments to authenticated;
grant select, delete on public.announcement_reads to authenticated;
grant insert (announcement_id, user_id) on public.announcement_reads to authenticated;
grant all on public.announcements, public.announcement_departments, public.announcement_reads to service_role;

revoke execute on function
  app.user_can_announce_to_department(uuid, uuid), app.user_can_read_announcement(uuid, uuid, text, uuid, uuid),
  app.can_announce_to_department(uuid), app.can_announce_to_project(uuid), app.can_edit_announcement(uuid),
  app.can_read_announcement(uuid, text, uuid, uuid), app.can_read_announcement_id(uuid),
  app.announcement_person(uuid), app.announcement_reach(uuid),
  app.announcements_before_write(), app.announcement_shape_check(),
  public.announcement_feed(), public.announcement_unread_count(), public.announcement_targets(),
  public.save_announcement(jsonb), public.mark_all_announcements_read()
  from public, anon;
grant execute on function
  app.user_can_announce_to_department(uuid, uuid), app.user_can_read_announcement(uuid, uuid, text, uuid, uuid),
  app.can_announce_to_department(uuid), app.can_announce_to_project(uuid), app.can_edit_announcement(uuid),
  app.can_read_announcement(uuid, text, uuid, uuid), app.can_read_announcement_id(uuid),
  app.announcement_person(uuid), app.announcement_reach(uuid),
  public.announcement_feed(), public.announcement_unread_count(), public.announcement_targets(),
  public.save_announcement(jsonb), public.mark_all_announcements_read()
  to authenticated;
grant execute on function
  app.user_can_announce_to_department(uuid, uuid), app.user_can_read_announcement(uuid, uuid, text, uuid, uuid),
  app.can_announce_to_department(uuid), app.can_announce_to_project(uuid), app.can_edit_announcement(uuid),
  app.can_read_announcement(uuid, text, uuid, uuid), app.can_read_announcement_id(uuid),
  app.announcement_person(uuid), app.announcement_reach(uuid),
  public.announcement_feed(), public.announcement_unread_count(), public.announcement_targets(),
  public.save_announcement(jsonb), public.mark_all_announcements_read()
  to service_role;
