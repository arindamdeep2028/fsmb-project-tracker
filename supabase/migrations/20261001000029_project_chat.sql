-- =============================================================================
-- Migration 29 · Project Chat (one group chat per project + private direct messages)
--
-- WHO MAY READ A CONVERSATION — decided live, never stored:
--   project  app.user_can_see_project(): Admin, the project's PMs, the head of the project's department, and every
--            CURRENT member (project_members.removed_at is null, active account). Nothing is copied when the room is
--            created, so a person added to the project later sees the whole history at once, and a person removed
--            loses access at once (RLS, Realtime and Storage all use the same function).
--   direct   the two people of the pair (dm_user_low / dm_user_high), and — READ ONLY — every active Admin
--            (app.user_can_read_conversation). No other employee can read a direct conversation.
--   Two rules, kept apart on purpose:
--     app.user_can_access_conversation  the conversation's own people (project: as above; direct: the pair). Used for
--                                       posting, @mentions, notifications, read state and the people list.
--     app.user_can_read_conversation    access OR Admin. Used by every READ path: RLS on messages / mentions / files /
--                                       read state / edit history, Storage downloads, Realtime, the read RPCs.
--   So an Admin can read every direct conversation and its full history, but cannot post in someone else's, cannot be
--   @mentioned into it, and gets none of its notifications.
-- WHO MAY POST: the conversation's people, while the project is not archived (project) / both accounts are active
--   (direct).
-- WHO MAY EDIT or DELETE a message: its sender, or an Admin in a project chat (same rule for both; RLS + trigger).
--   Every edit keeps the previous text in chat_message_edits (the first row of a message holds the original);
--   chat_messages.edited_at / edited_by mark the latest edit. Mentions are re-checked and re-recorded on edit; only
--   people newly mentioned by the edit are notified (once per message, as for a new message).
-- WHO MAY START a direct conversation (app.user_can_dm): two active people who share a current project or a
--            department, where one heads the other's department, or where either is an Admin.
--
-- chat_participants holds per-person READ STATE (last_read_at → unread counts and read receipts). For a project chat a
-- row there never grants access; it is created the first time someone opens the chat or posts.
-- project_member_periods keeps every join/leave of a project (project_members overwrites added_at when someone is
-- re-added), so the chat can show who joined when and what was said before they joined.
-- Mentions are written in the body as @[Name](user-uuid). A trigger checks that every mentioned person may read the
-- conversation and records them in chat_mentions; nobody can mention someone outside the project.
-- Notifications (existing notifications table, existing preference rules): one per person per message at most —
--   chat_mention > chat_reply > chat_direct / chat_message; plain new-message notices are collapsed to one per person
--   per conversation until they read it (dedup key includes their last read time).
-- Files: private bucket chat-files, path {conversation_id}/{uuid}/{file name}; readable by whoever may read the
--   conversation; size and type are taken from the stored object.
--
-- Only new objects; nothing existing is changed (new triggers are added beside the existing ones, new enum values).
-- Rollback: supabase/rollback_20261001000029.sql, then supabase migration repair --status reverted 20261001000029
-- =============================================================================

alter type public.notification_type add value if not exists 'chat_message';
alter type public.notification_type add value if not exists 'chat_direct';
alter type public.notification_type add value if not exists 'chat_mention';
alter type public.notification_type add value if not exists 'chat_reply';

-- ---------- Tables ----------------------------------------------------------------
create table public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('project', 'direct')),
  project_id       uuid unique references public.projects (id) on delete cascade,
  dm_user_low      uuid references public.profiles (id) on delete cascade,
  dm_user_high     uuid references public.profiles (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  constraint chat_conversation_shape check (
    (kind = 'project' and project_id is not null and dm_user_low is null and dm_user_high is null)
    or (kind = 'direct' and project_id is null and dm_user_low is not null and dm_user_high is not null
        and dm_user_low < dm_user_high)),
  constraint chat_direct_pair unique (dm_user_low, dm_user_high)
);
alter table public.chat_conversations enable row level security;

create table public.chat_participants (
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  last_read_at     timestamptz,
  first_seen_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.chat_participants enable row level security;

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null,
  body             text not null default '' check (length(body) <= 4000),
  reply_to_id      uuid references public.chat_messages (id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id) on delete set null,
  edited_at        timestamptz,
  edited_by        uuid references public.profiles (id) on delete set null
);
alter table public.chat_messages enable row level security;

create table public.chat_mentions (
  message_id  uuid not null references public.chat_messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (message_id, user_id)
);
alter table public.chat_mentions enable row level security;

create table public.chat_attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.chat_messages (id) on delete cascade,
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  storage_path     text not null unique check (length(storage_path) <= 400),
  file_name        text not null check (length(file_name) between 1 and 255),
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
alter table public.chat_attachments enable row level security;

-- Edit history: one row per edit with the text as it was BEFORE that edit (so the oldest row is the original).
create table public.chat_message_edits (
  id             bigint generated always as identity primary key,
  message_id     uuid not null references public.chat_messages (id) on delete cascade,
  previous_body  text not null,
  edited_by      uuid references public.profiles (id) on delete set null,
  edited_at      timestamptz not null default now()
);
alter table public.chat_message_edits enable row level security;

create table public.project_member_periods (
  id           bigint generated always as identity primary key,
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  member_role  public.project_member_role not null,
  joined_at    timestamptz not null,
  left_at      timestamptz,
  added_by     uuid references public.profiles (id) on delete set null,
  removed_by   uuid references public.profiles (id) on delete set null,
  constraint project_member_period_order check (left_at is null or left_at >= joined_at)
);
alter table public.project_member_periods enable row level security;

create index chat_messages_conv_time_idx on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_reply_idx on public.chat_messages (reply_to_id) where reply_to_id is not null;
create index chat_messages_sender_idx on public.chat_messages (sender_id, conversation_id);
create index chat_mentions_user_idx on public.chat_mentions (user_id);
create index chat_attachments_message_idx on public.chat_attachments (message_id);
create index chat_message_edits_message_idx on public.chat_message_edits (message_id, edited_at);
create index chat_participants_user_idx on public.chat_participants (user_id);
create index chat_conversations_dm_high_idx on public.chat_conversations (dm_user_high) where kind = 'direct';
create index project_member_periods_idx on public.project_member_periods (project_id, user_id, joined_at);
create unique index project_member_periods_open_idx on public.project_member_periods (project_id, user_id) where left_at is null;

-- ---------- Permission helpers (SECURITY DEFINER, empty search_path, like migration 10) ----------
create or replace function app.user_can_access_conversation(p_uid uuid, p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_active(p_uid)
     and exists (select 1 from public.chat_conversations c
                  where c.id = p_conv
                    and case when c.kind = 'project' then app.user_can_see_project(p_uid, c.project_id)
                             else p_uid in (c.dm_user_low, c.dm_user_high) end);
$$;

create or replace function app.can_access_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and app.user_can_access_conversation(auth.uid(), p_conv);
$$;

-- READ rule: the conversation's own people, or any active Admin (direct conversations included, read only).
create or replace function app.user_can_read_conversation(p_uid uuid, p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_can_access_conversation(p_uid, p_conv)
      or (app.user_is_admin(p_uid) and exists (select 1 from public.chat_conversations c where c.id = p_conv));
$$;

create or replace function app.can_read_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and app.user_can_read_conversation(auth.uid(), p_conv);
$$;

create or replace function app.can_post_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_access_conversation(p_conv)
     and exists (select 1 from public.chat_conversations c
                  left join public.projects pr on pr.id = c.project_id
                 where c.id = p_conv
                   and case when c.kind = 'project' then not pr.archived
                            else app.user_is_active(c.dm_user_low) and app.user_is_active(c.dm_user_high) end);
$$;

create or replace function app.user_can_dm(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and app.user_is_active(p_a) and app.user_is_active(p_b)
     and (app.user_is_admin(p_a) or app.user_is_admin(p_b)
          or exists (select 1 from public.profiles x join public.profiles y on y.id = p_b
                      where x.id = p_a and x.department_id is not null and x.department_id = y.department_id)
          or exists (select 1 from public.project_members a
                       join public.project_members b on b.project_id = a.project_id
                      where a.user_id = p_a and b.user_id = p_b and a.removed_at is null and b.removed_at is null)
          or exists (select 1 from public.department_heads dh join public.profiles y on y.department_id = dh.department_id
                      where dh.user_id = p_a and y.id = p_b)
          or exists (select 1 from public.department_heads dh join public.profiles x on x.department_id = dh.department_id
                      where dh.user_id = p_b and x.id = p_a));
$$;

-- Name and role of someone the caller meets in a conversation (profiles RLS may hide an Admin or a department head
-- who posts in a project chat, but readers are entitled to see who wrote).
create or replace function app.chat_person(p_uid uuid)
returns table (full_name text, role public.user_role)
language sql stable security definer set search_path = '' as $$
  select p.full_name, p.role from public.profiles p where p.id = p_uid and app.session_ok();
$$;

-- From when messages count as unread for this person: their last read time, or (project, current member) when they
-- joined; someone who only has access through a management role and never opened the chat has nothing unread.
create or replace function app.chat_unread_since(p_conv uuid, p_uid uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case
           when c.kind = 'direct' and p_uid not in (c.dm_user_low, c.dm_user_high) then 'infinity'::timestamptz
           when c.kind = 'direct' then coalesce(cp.last_read_at, '-infinity'::timestamptz)
           when cp.last_read_at is null and per.joined_at is null then 'infinity'::timestamptz
           else greatest(coalesce(cp.last_read_at, '-infinity'::timestamptz), coalesce(per.joined_at, '-infinity'::timestamptz))
         end
    from public.chat_conversations c
    left join public.chat_participants cp on cp.conversation_id = c.id and cp.user_id = p_uid
    left join lateral (select max(x.joined_at) joined_at from public.project_member_periods x
                        join public.project_members m on m.project_id = x.project_id and m.user_id = x.user_id and m.removed_at is null
                       where x.project_id = c.project_id and x.user_id = p_uid and x.left_at is null) per on c.kind = 'project'
   where c.id = p_conv;
$$;

-- May the caller delete this stored chat file? Admin; or the uploader while the file is not part of a live message.
create or replace function app.can_delete_chat_file(p_name text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_ok() and (
    app.user_is_admin(auth.uid())
    or (p_owner = auth.uid()::text
        and not exists (select 1 from public.chat_attachments a join public.chat_messages m on m.id = a.message_id
                         where a.storage_path = p_name and m.deleted_at is null)));
$$;

-- ---------- One group chat per project --------------------------------------------------------
create or replace function app.projects_chat_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_conversations (kind, project_id, created_by) values ('project', new.id, auth.uid())
  on conflict (project_id) do nothing;
  return null;
end $$;
create trigger projects_chat_after_insert after insert on public.projects
  for each row execute function app.projects_chat_after_insert();

insert into public.chat_conversations (kind, project_id, created_at)
select 'project', pr.id, pr.created_at from public.projects pr
on conflict (project_id) do nothing;

-- ---------- Membership periods (history of joins and removals) ------------------------------------
create or replace function app.project_members_periods() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.removed_at is null then
      insert into public.project_member_periods (project_id, user_id, member_role, joined_at, added_by)
      values (new.project_id, new.user_id, new.member_role, coalesce(new.added_at, now()), new.added_by)
      on conflict do nothing;
    end if;
  elsif old.removed_at is null and new.removed_at is not null then
    update public.project_member_periods set left_at = greatest(new.removed_at, joined_at), removed_by = new.removed_by
     where project_id = new.project_id and user_id = new.user_id and left_at is null;
  elsif old.removed_at is not null and new.removed_at is null then
    insert into public.project_member_periods (project_id, user_id, member_role, joined_at, added_by)
    values (new.project_id, new.user_id, new.member_role, coalesce(new.added_at, now()), new.added_by)
    on conflict do nothing;
  elsif new.member_role is distinct from old.member_role and new.removed_at is null then
    update public.project_member_periods set member_role = new.member_role
     where project_id = new.project_id and user_id = new.user_id and left_at is null;
  end if;
  return null;
end $$;
create trigger project_members_periods after insert or update on public.project_members
  for each row execute function app.project_members_periods();

insert into public.project_member_periods (project_id, user_id, member_role, joined_at, left_at, added_by, removed_by)
select m.project_id, m.user_id, m.member_role, m.added_at, case when m.removed_at is not null then greatest(m.removed_at, m.added_at) end,
       m.added_by, m.removed_by
  from public.project_members m;

-- ---------- Message integrity ---------------------------------------------------------------------
create or replace function app.chat_messages_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_changed text[];
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.sender_id := auth.uid(); end if;
    new.created_at := clock_timestamp();
    new.deleted_at := null; new.deleted_by := null; new.edited_at := null; new.edited_by := null;
    new.body := btrim(coalesce(new.body, ''));
    if new.reply_to_id is not null and not exists (
         select 1 from public.chat_messages r where r.id = new.reply_to_id and r.conversation_id = new.conversation_id) then
      raise exception 'The message you replied to is not in this conversation.' using errcode = '23514';
    end if;
    for v_uid in
      select distinct (m[1])::uuid
        from regexp_matches(new.body, '@\[[^\]\n]{1,120}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g') m
    loop
      if not app.user_can_access_conversation(v_uid, new.conversation_id) then
        raise exception 'You can only mention people who are members of this conversation.' using errcode = '23514';
      end if;
    end loop;
    return new;
  end if;

  v_changed := app.changed_columns(to_jsonb(old), to_jsonb(new));
  if v_changed = '{}'::text[] then return new; end if;
  -- foreign keys cleared by a delete elsewhere (ON DELETE SET NULL)
  if v_changed <@ array['reply_to_id', 'sender_id', 'deleted_by']
     and (new.reply_to_id is null or not 'reply_to_id' = any (v_changed))
     and (new.sender_id is null or not 'sender_id' = any (v_changed))
     and (new.deleted_by is null or not 'deleted_by' = any (v_changed)) then
    return new;
  end if;
  -- the only edit: deleting (the text is cleared; the row stays so replies keep their place)
  if v_changed <@ array['deleted_at', 'deleted_by', 'body'] and new.deleted_at is not null then
    if old.deleted_at is not null then
      raise exception 'This message was already deleted.' using errcode = '23514';
    end if;
    new.deleted_at := now(); new.deleted_by := auth.uid(); new.body := '';
    return new;
  end if;
  -- editing: the text only, of a message that is not deleted, by its sender or an Admin in a project chat
  if v_changed <@ array['body', 'edited_at', 'edited_by'] and 'body' = any (v_changed) and new.deleted_at is null then
    if old.deleted_at is not null then
      raise exception 'A deleted message cannot be edited.' using errcode = '23514';
    end if;
    if auth.uid() is not null and not (
         old.sender_id = auth.uid()
         or (app.is_admin() and exists (select 1 from public.chat_conversations c where c.id = old.conversation_id and c.kind = 'project'))) then
      raise exception 'You can only edit your own messages.' using errcode = '42501';
    end if;
    new.body := btrim(coalesce(new.body, ''));
    if new.body = old.body then
      new.edited_at := old.edited_at; new.edited_by := old.edited_by;
      return new;
    end if;
    if new.body = '' and not exists (select 1 from public.chat_attachments a where a.message_id = old.id) then
      raise exception 'Write a message or attach a file.' using errcode = '23514';
    end if;
    for v_uid in
      select distinct (m[1])::uuid
        from regexp_matches(new.body, '@\[[^\]\n]{1,120}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g') m
    loop
      if not app.user_can_access_conversation(v_uid, old.conversation_id) then
        raise exception 'You can only mention people who are members of this conversation.' using errcode = '23514';
      end if;
    end loop;
    insert into public.chat_message_edits (message_id, previous_body, edited_by, edited_at)
    values (old.id, old.body, auth.uid(), now());
    new.edited_at := now(); new.edited_by := auth.uid();
    return new;
  end if;
  raise exception 'Only the text of a message can be edited.' using errcode = '42501';
end $$;
create trigger chat_messages_before_write before insert or update on public.chat_messages
  for each row execute function app.chat_messages_before_write();

-- A message has text or at least one file (checked at commit, after send_chat_message added the files).
create or replace function app.chat_message_content_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.chat_messages m
              where m.id = new.id and m.deleted_at is null and m.body = ''
                and not exists (select 1 from public.chat_attachments a where a.message_id = m.id)) then
    raise exception 'Write a message or attach a file.' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger chat_messages_content after insert on public.chat_messages
  deferrable initially deferred for each row execute function app.chat_message_content_check();

-- After a message: conversation time, mentions, the sender's read mark, notifications.
create or replace function app.chat_messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c record; v_sender text; v_reply_author uuid; v_preview text; r record;
  v_type text; v_dedup text; v_title text; v_link text; v_code text;
begin
  select cc.*, pr.code, pr.name pname into c
    from public.chat_conversations cc left join public.projects pr on pr.id = cc.project_id
   where cc.id = new.conversation_id;
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;

  insert into public.chat_mentions (message_id, user_id)
  select distinct new.id, (m[1])::uuid
    from regexp_matches(new.body, '@\[[^\]\n]{1,120}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g') m
  on conflict do nothing;

  if new.sender_id is not null then
    insert into public.chat_participants (conversation_id, user_id, last_read_at)
    values (new.conversation_id, new.sender_id, new.created_at)
    on conflict (conversation_id, user_id) do update
      set last_read_at = greatest(coalesce(public.chat_participants.last_read_at, '-infinity'), excluded.last_read_at);
  end if;

  select p.full_name into v_sender from public.profiles p where p.id = new.sender_id;
  v_sender := coalesce(v_sender, 'Someone');
  select m.sender_id into v_reply_author from public.chat_messages m where m.id = new.reply_to_id;
  v_preview := regexp_replace(new.body, '@\[([^\]\n]{1,120})\]\([0-9a-fA-F-]{36}\)', '@\1', 'g');
  v_preview := case when v_preview = '' then 'Sent a file' else left(v_preview, 300) end;
  v_link := '/chat?c=' || new.conversation_id || '&m=' || new.id;
  v_code := case when c.kind = 'project' then c.code || ' · ' || c.pname end;

  for r in
    select p.id uid,
           exists (select 1 from public.chat_mentions mm where mm.message_id = new.id and mm.user_id = p.id) mentioned,
           p.id = v_reply_author replied,
           (c.kind = 'direct'
            or exists (select 1 from public.project_members pm where pm.project_id = c.project_id and pm.user_id = p.id and pm.removed_at is null)
            or exists (select 1 from public.chat_messages pm where pm.conversation_id = c.id and pm.sender_id = p.id and pm.id <> new.id)) follows
      from public.profiles p
     where p.active and p.id is distinct from new.sender_id
       and app.user_can_access_conversation(p.id, new.conversation_id)
  loop
    if r.mentioned then
      v_type := 'chat_mention'; v_dedup := 'chat:msg:' || new.id;
      v_title := v_sender || ' mentioned you' || coalesce(' in ' || v_code, '');
    elsif r.replied then
      v_type := 'chat_reply'; v_dedup := 'chat:msg:' || new.id;
      v_title := v_sender || ' replied to your message' || coalesce(' in ' || v_code, '');
    elsif not r.follows then
      continue;
    else
      v_type := case when c.kind = 'direct' then 'chat_direct' else 'chat_message' end;
      v_dedup := 'chat:' || new.conversation_id || ':' ||
                 coalesce((select floor(extract(epoch from cp.last_read_at) * 1000)::bigint::text
                             from public.chat_participants cp where cp.conversation_id = c.id and cp.user_id = r.uid), '0');
      v_title := case when c.kind = 'direct' then 'New message from ' || v_sender else 'New messages in ' || v_code end;
    end if;
    insert into public.notifications (user_id, type, title, body, project_id, actor_id, dedup_key, link)
    values (r.uid, v_type::public.notification_type, left(v_title, 200),
            left(case when v_type = 'chat_message' then v_sender || ': ' || v_preview else v_preview end, 2000),
            c.project_id, new.sender_id, v_dedup, v_link)
    on conflict (user_id, dedup_key) where dedup_key is not null do nothing;
  end loop;
  return null;
end $$;
create trigger chat_messages_after_insert after insert on public.chat_messages
  for each row execute function app.chat_messages_after_insert();

-- A deleted message loses its files and mentions (the app removes the stored files).
create or replace function app.chat_messages_after_delete_mark() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.chat_attachments where message_id = new.id;
    delete from public.chat_mentions where message_id = new.id;
  end if;
  return null;
end $$;
create trigger chat_messages_after_delete_mark after update of deleted_at on public.chat_messages
  for each row execute function app.chat_messages_after_delete_mark();

-- After an edit: chat_mentions follows the new text; people newly mentioned get one chat_mention notification
-- (same dedup key as a new message, so nobody is notified twice for one message).
create or replace function app.chat_messages_after_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; v_editor text; v_new uuid[]; v_old uuid[]; v_uid uuid; v_preview text;
begin
  if new.deleted_at is not null or new.body is not distinct from old.body then return null; end if;
  select coalesce(array_agg(distinct (m[1])::uuid), '{}') into v_new
    from regexp_matches(new.body, '@\[[^\]\n]{1,120}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g') m;
  select coalesce(array_agg(mm.user_id), '{}') into v_old from public.chat_mentions mm where mm.message_id = new.id;
  delete from public.chat_mentions where message_id = new.id and not (user_id = any (v_new));
  insert into public.chat_mentions (message_id, user_id) select new.id, u from unnest(v_new) u on conflict do nothing;

  select cc.*, pr.code, pr.name pname into c
    from public.chat_conversations cc left join public.projects pr on pr.id = cc.project_id where cc.id = new.conversation_id;
  select p.full_name into v_editor from public.profiles p where p.id = coalesce(auth.uid(), new.sender_id);
  v_preview := regexp_replace(new.body, '@\[([^\]\n]{1,120})\]\([0-9a-fA-F-]{36}\)', '@\1', 'g');
  foreach v_uid in array v_new loop
    continue when v_uid = any (v_old) or v_uid is not distinct from coalesce(auth.uid(), new.sender_id);
    insert into public.notifications (user_id, type, title, body, project_id, actor_id, dedup_key, link)
    values (v_uid, 'chat_mention', left(coalesce(v_editor, 'Someone') || ' mentioned you'
              || coalesce(' in ' || c.code || ' · ' || c.pname, ''), 200),
            left(case when v_preview = '' then 'Sent a file' else v_preview end, 2000),
            c.project_id, coalesce(auth.uid(), new.sender_id), 'chat:msg:' || new.id,
            '/chat?c=' || new.conversation_id || '&m=' || new.id)
    on conflict (user_id, dedup_key) where dedup_key is not null do nothing;
  end loop;
  return null;
end $$;
create trigger chat_messages_after_edit after update of body on public.chat_messages
  for each row execute function app.chat_messages_after_edit();

-- Files: the stored object must exist in this conversation's folder, uploaded by the caller; size and type come
-- from the stored object, not from the caller.
create or replace function app.chat_attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  if not exists (select 1 from public.chat_messages m
                  where m.id = new.message_id and m.conversation_id = new.conversation_id
                    and m.deleted_at is null and (auth.uid() is null or m.sender_id = auth.uid())) then
    raise exception 'You can only attach files to your own message.' using errcode = '42501';
  end if;
  if app.path_uuid(new.storage_path, 1) is distinct from new.conversation_id or app.path_uuid(new.storage_path, 2) is null then
    raise exception 'That file doesn''t belong to this conversation.' using errcode = '42501';
  end if;
  select ob.owner_id, ob.metadata into o from storage.objects ob where ob.bucket_id = 'chat-files' and ob.name = new.storage_path;
  if not found then
    raise exception 'The file wasn''t uploaded. Try again.' using errcode = '23514';
  end if;
  if auth.uid() is not null and o.owner_id is distinct from auth.uid()::text then
    raise exception 'You can only attach files you uploaded.' using errcode = '42501';
  end if;
  new.mime_type := coalesce(o.metadata->>'mimetype', 'application/octet-stream');
  new.size_bytes := coalesce((o.metadata->>'size')::bigint, 0);
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.created_at := now();
  new.file_name := left(btrim(new.file_name), 255);
  return new;
end $$;
create trigger chat_attachments_before_insert before insert on public.chat_attachments
  for each row execute function app.chat_attachments_before_insert();

-- ---------- RLS policies ------------------------------------------------------------
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (app.can_read_conversation(id));

create policy chat_participants_read on public.chat_participants for select to authenticated
  using (app.can_read_conversation(conversation_id));
create policy chat_participants_insert on public.chat_participants for insert to authenticated
  with check (user_id = (select auth.uid()) and app.can_access_conversation(conversation_id));
create policy chat_participants_update on public.chat_participants for update to authenticated
  using (user_id = (select auth.uid()) and app.can_access_conversation(conversation_id))
  with check (user_id = (select auth.uid()) and app.can_access_conversation(conversation_id));

create policy chat_messages_read on public.chat_messages for select to authenticated
  using (app.can_read_conversation(conversation_id));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and app.can_post_conversation(conversation_id));
-- delete (soft) and edit: the sender, or an Admin in a project chat (which columns, and how, is the trigger's job)
create policy chat_messages_delete_mark on public.chat_messages for update to authenticated
  using (app.can_access_conversation(conversation_id)
         and (sender_id = (select auth.uid())
              or ((select app.is_admin()) and exists (select 1 from public.chat_conversations c
                                                       where c.id = conversation_id and c.kind = 'project'))))
  with check (app.can_access_conversation(conversation_id));

create policy chat_mentions_read on public.chat_mentions for select to authenticated
  using (app.can_read_conversation((select m.conversation_id from public.chat_messages m where m.id = message_id)));

create policy chat_attachments_read on public.chat_attachments for select to authenticated
  using (app.can_read_conversation(conversation_id));

-- Edit history: whoever may read the conversation, while the message is not deleted (an Admin always).
create policy chat_message_edits_read on public.chat_message_edits for select to authenticated
  using (exists (select 1 from public.chat_messages m
                  where m.id = message_id and app.can_read_conversation(m.conversation_id)
                    and (m.deleted_at is null or (select app.is_admin()))));
create policy chat_attachments_insert on public.chat_attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and app.can_post_conversation(conversation_id));

create policy project_member_periods_read on public.project_member_periods for select to authenticated
  using (app.can_see_project(project_id));

-- ---------- Storage: private bucket chat-files ------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 26214400, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy chat_files_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and app.can_read_conversation(app.path_uuid(name, 1)));
create policy chat_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and app.path_uuid(name, 2) is not null
              and app.can_post_conversation(app.path_uuid(name, 1)));
create policy chat_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and app.can_delete_chat_file(name, owner_id));

-- ---------- RPCs ----------
-- Writes are SECURITY INVOKER (they go through the policies above). The two read RPCs that return many rows
-- (chat_inbox, chat_message_rows) are SECURITY DEFINER with the read rule applied ONCE, explicitly
-- (app.can_read_conversation / app.user_can_read_conversation: the same functions the read policies use);
-- going through RLS re-ran that rule for every row, reply, mention and file (seconds per page of 50 messages).
-- The caller's conversations: every project chat they may read, and their direct conversations.
create or replace function public.chat_inbox()
returns table (
  id uuid, kind text, project_id uuid, project_code text, project_name text, project_archived boolean,
  other_user_id uuid, other_name text, other_role public.user_role,
  last_message_at timestamptz, last_body text, last_sender_id uuid, last_sender_name text, last_deleted boolean,
  last_has_files boolean, unread int, mentions int, can_post boolean, is_participant boolean, participant_names text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, pr.id, pr.code, pr.name, pr.archived,
         case when c.kind = 'direct' then case when c.dm_user_low = auth.uid() then c.dm_user_high else c.dm_user_low end end,
         o.full_name, o.role,
         c.last_message_at, lm.body, lm.sender_id, ls.full_name, lm.deleted_at is not null, coalesce(lm.files, false),
         coalesce(u.unread, 0), coalesce(u.mentions, 0), app.can_post_conversation(c.id),
         app.user_can_access_conversation(auth.uid(), c.id),
         case when c.kind = 'direct' then (select string_agg(p.full_name, ' ↔ ' order by p.full_name) from public.profiles p
                                            where p.id in (c.dm_user_low, c.dm_user_high)) end
    from public.chat_conversations c
    left join public.projects pr on pr.id = c.project_id
    left join lateral app.chat_person(case when c.dm_user_low = auth.uid() then c.dm_user_high else c.dm_user_low end) o
           on c.kind = 'direct'
    left join lateral (select m.body, m.sender_id, m.deleted_at,
                              exists (select 1 from public.chat_attachments a where a.message_id = m.id) files
                         from public.chat_messages m where m.conversation_id = c.id
                        order by m.created_at desc limit 1) lm on true
    left join lateral app.chat_person(lm.sender_id) ls on true
    left join lateral (select count(*)::int unread,
                              count(*) filter (where exists (select 1 from public.chat_mentions mm
                                                              where mm.message_id = m.id and mm.user_id = auth.uid()))::int mentions
                         from public.chat_messages m
                        where m.conversation_id = c.id and m.deleted_at is null
                          and m.sender_id is distinct from auth.uid()
                          and m.created_at > app.chat_unread_since(c.id, auth.uid())) u on true
   where app.session_ok()
     and app.user_can_read_conversation(auth.uid(), c.id)
     and (c.kind = 'project' or c.last_message_at is not null or c.created_by = auth.uid())
   order by c.last_message_at desc nulls last, pr.code;
$$;

create or replace function public.chat_unread_total() returns int
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(unread), 0)::int from public.chat_inbox();
$$;

-- One page of messages (newest first), or one message (p_id). Text of deleted messages is never returned.
create or replace function public.chat_message_rows(p_conv uuid, p_before timestamptz default null, p_limit int default 50, p_id uuid default null)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, sender_name text, sender_role public.user_role,
  body text, created_at timestamptz, deleted boolean,
  reply_to_id uuid, reply_sender_id uuid, reply_sender_name text, reply_body text, reply_deleted boolean,
  attachments jsonb, mention_ids uuid[], edited_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.conversation_id, m.sender_id, sp.full_name, sp.role,
         case when m.deleted_at is null then m.body else '' end, m.created_at, m.deleted_at is not null,
         m.reply_to_id, r.sender_id, rp.full_name,
         case when r.deleted_at is null then left(r.body, 300) else '' end, r.deleted_at is not null,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path, 'file_name', a.file_name,
                                                       'mime_type', a.mime_type, 'size_bytes', a.size_bytes) order by a.created_at)
                     from public.chat_attachments a where a.message_id = m.id), '[]'::jsonb),
         coalesce((select array_agg(mm.user_id) from public.chat_mentions mm where mm.message_id = m.id), '{}'),
         case when m.deleted_at is null then m.edited_at end
    from public.chat_messages m
    left join lateral app.chat_person(m.sender_id) sp on true
    left join public.chat_messages r on r.id = m.reply_to_id
    left join lateral app.chat_person(r.sender_id) rp on r.id is not null
   where m.conversation_id = p_conv
     and app.can_read_conversation(p_conv)
     and (p_id is null or m.id = p_id)
     and (p_before is null or m.created_at < p_before)
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Everyone who may read the conversation (the members panel, @mention list and read receipts).
create or replace function public.chat_people(p_conv uuid)
returns table (user_id uuid, full_name text, role public.user_role, member_role text, access text,
               joined_at timestamptz, last_read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role, m.member_role::text,
         case when m.user_id is not null then case when m.member_role = 'pm' then 'pm' else 'member' end
              when c.kind = 'direct' then 'member'
              when app.user_is_admin(p.id) then 'admin'
              else 'department_head' end,
         per.joined_at, cp.last_read_at
    from public.chat_conversations c
    join public.profiles p on p.active and app.user_can_access_conversation(p.id, c.id)
    left join public.project_members m on c.kind = 'project' and m.project_id = c.project_id and m.user_id = p.id and m.removed_at is null
    left join lateral (select max(x.joined_at) joined_at from public.project_member_periods x
                        where x.project_id = c.project_id and x.user_id = p.id and x.left_at is null) per on c.kind = 'project'
    left join public.chat_participants cp on cp.conversation_id = c.id and cp.user_id = p.id
   where c.id = p_conv and app.can_read_conversation(p_conv)
   order by case when m.member_role = 'pm' then 0 when m.user_id is not null then 1 else 2 end, p.full_name;
$$;

-- Joins and removals of the project (shown in the chat timeline).
create or replace function public.chat_member_events(p_conv uuid)
returns table (user_id uuid, full_name text, member_role text, joined_at timestamptz, left_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.user_id, p.full_name, x.member_role::text, x.joined_at, x.left_at
    from public.chat_conversations c
    join public.project_member_periods x on x.project_id = c.project_id
    join public.profiles p on p.id = x.user_id
   where c.id = p_conv and c.kind = 'project' and app.can_read_conversation(p_conv)
   order by x.joined_at;
$$;

-- People the caller may start a direct conversation with.
create or replace function public.chat_dm_candidates()
returns table (user_id uuid, full_name text, role public.user_role, department text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role, d.name::text
    from public.profiles p left join public.departments d on d.id = p.department_id
   where app.session_ok() and app.user_can_dm(auth.uid(), p.id)
   order by p.full_name;
$$;

-- Open (or create) the direct conversation with one person. SECURITY DEFINER: creates the pair row.
create or replace function public.start_direct_chat(p_other uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if not app.session_ok() then raise exception 'Sign in again.' using errcode = '42501'; end if;
  if not app.user_can_dm(v_me, p_other) then
    raise exception 'You can message people who share a project or a department with you.' using errcode = '42501';
  end if;
  select c.id into v_id from public.chat_conversations c
   where c.kind = 'direct' and c.dm_user_low = least(v_me, p_other) and c.dm_user_high = greatest(v_me, p_other);
  if v_id is null then
    insert into public.chat_conversations (kind, dm_user_low, dm_user_high, created_by)
    values ('direct', least(v_me, p_other), greatest(v_me, p_other), v_me)
    on conflict (dm_user_low, dm_user_high) do nothing
    returning id into v_id;
    if v_id is null then
      select c.id into v_id from public.chat_conversations c
       where c.kind = 'direct' and c.dm_user_low = least(v_me, p_other) and c.dm_user_high = greatest(v_me, p_other);
    end if;
  end if;
  insert into public.chat_participants (conversation_id, user_id) values (v_id, v_me), (v_id, p_other)
  on conflict do nothing;
  return v_id;
end $$;

-- Send one message with its files. p: {conversation_id, body, reply_to_id?, attachments?: [{storage_path, file_name}]}
create or replace function public.send_chat_message(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare v_id uuid; v_conv uuid := nullif(p->>'conversation_id', '')::uuid; a jsonb;
begin
  if jsonb_array_length(coalesce(p->'attachments', '[]'::jsonb)) > 10 then
    raise exception 'Attach up to 10 files to one message.' using errcode = '22023';
  end if;
  insert into public.chat_messages (conversation_id, sender_id, body, reply_to_id)
  values (v_conv, auth.uid(), coalesce(p->>'body', ''), nullif(p->>'reply_to_id', '')::uuid)
  returning id into v_id;
  for a in select * from jsonb_array_elements(coalesce(p->'attachments', '[]'::jsonb)) loop
    insert into public.chat_attachments (message_id, conversation_id, storage_path, file_name, uploaded_by)
    values (v_id, v_conv, a->>'storage_path', coalesce(nullif(a->>'file_name', ''), 'file'), auth.uid());
  end loop;
  return v_id;
end $$;

-- Mark a conversation read (also the chat notifications that point at it).
create or replace function public.mark_chat_read(p_conv uuid) returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if not app.can_access_conversation(p_conv) then return; end if;
  -- clock_timestamp(): the same clock as chat_messages.created_at (now() is the transaction start)
  insert into public.chat_participants (conversation_id, user_id, last_read_at)
  values (p_conv, auth.uid(), clock_timestamp())
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(coalesce(public.chat_participants.last_read_at, '-infinity'), excluded.last_read_at);
  update public.notifications n set read_at = now()
   where n.user_id = auth.uid() and n.read_at is null
     and n.type in ('chat_message', 'chat_direct', 'chat_mention', 'chat_reply')
     and n.link like '/chat?c=' || p_conv || '&%';
end $$;

-- Edit one message's text (sender, or Admin in a project chat: the update policy and the trigger decide).
create or replace function public.edit_chat_message(p_id uuid, p_body text) returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare v_n int;
begin
  if length(coalesce(p_body, '')) > 4000 then
    raise exception 'Messages are limited to 4000 characters.' using errcode = '22023';
  end if;
  update public.chat_messages set body = coalesce(p_body, '') where id = p_id and deleted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
end $$;

-- ---------- Realtime ------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- project_member_periods: an open chat refreshes its member / @mention list the moment someone joins or leaves
    foreach t in array array['chat_messages', 'chat_participants', 'project_member_periods'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- Grants ------------------------------------------------------------------
revoke all on public.chat_conversations, public.chat_participants, public.chat_messages, public.chat_mentions,
              public.chat_attachments, public.project_member_periods, public.chat_message_edits from anon, authenticated;
grant select on public.chat_conversations, public.chat_participants, public.chat_messages, public.chat_mentions,
                public.chat_attachments, public.project_member_periods, public.chat_message_edits to authenticated;
grant insert (conversation_id, user_id, last_read_at), update (last_read_at) on public.chat_participants to authenticated;
grant insert (conversation_id, sender_id, body, reply_to_id), update (deleted_at, body) on public.chat_messages to authenticated;
grant insert (message_id, conversation_id, storage_path, file_name, uploaded_by) on public.chat_attachments to authenticated;
grant all on public.chat_conversations, public.chat_participants, public.chat_messages, public.chat_mentions,
             public.chat_attachments, public.project_member_periods, public.chat_message_edits to service_role;

revoke execute on function
  app.user_can_access_conversation(uuid, uuid), app.can_access_conversation(uuid), app.can_post_conversation(uuid),
  app.user_can_read_conversation(uuid, uuid), app.can_read_conversation(uuid),
  app.user_can_dm(uuid, uuid), app.chat_person(uuid), app.chat_unread_since(uuid, uuid), app.can_delete_chat_file(text, text),
  app.projects_chat_after_insert(), app.project_members_periods(), app.chat_messages_before_write(),
  app.chat_message_content_check(), app.chat_messages_after_insert(), app.chat_messages_after_delete_mark(),
  app.chat_attachments_before_insert(), app.chat_messages_after_edit(),
  public.chat_inbox(), public.chat_unread_total(), public.chat_message_rows(uuid, timestamptz, int, uuid),
  public.chat_people(uuid), public.chat_member_events(uuid), public.chat_dm_candidates(), public.start_direct_chat(uuid),
  public.send_chat_message(jsonb), public.mark_chat_read(uuid), public.edit_chat_message(uuid, text)
  from public, anon;
grant execute on function
  app.user_can_access_conversation(uuid, uuid), app.can_access_conversation(uuid), app.can_post_conversation(uuid),
  app.user_can_read_conversation(uuid, uuid), app.can_read_conversation(uuid),
  app.user_can_dm(uuid, uuid), app.chat_person(uuid), app.chat_unread_since(uuid, uuid), app.can_delete_chat_file(text, text),
  public.chat_inbox(), public.chat_unread_total(), public.chat_message_rows(uuid, timestamptz, int, uuid),
  public.chat_people(uuid), public.chat_member_events(uuid), public.chat_dm_candidates(), public.start_direct_chat(uuid),
  public.send_chat_message(jsonb), public.mark_chat_read(uuid), public.edit_chat_message(uuid, text)
  to authenticated, service_role;
