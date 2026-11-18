-- Rollback of migration 20261001000029_project_chat (drops only what it added; chat data and chat files are lost).
-- Then: supabase migration repair --status reverted 20261001000029
-- FIRST, with the Storage API (Storage refuses direct SQL deletes): empty the bucket chat-files and delete it
-- (supabase-js as service role: storage.emptyBucket("chat-files") then storage.deleteBucket("chat-files")).
begin;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime drop table public.chat_messages;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_participants') then
    alter publication supabase_realtime drop table public.chat_participants;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_member_periods') then
    alter publication supabase_realtime drop table public.project_member_periods;
  end if;
end $$;

drop policy if exists chat_files_read on storage.objects;
drop policy if exists chat_files_upload on storage.objects;
drop policy if exists chat_files_delete on storage.objects;

drop trigger if exists projects_chat_after_insert on public.projects;
drop trigger if exists project_members_periods on public.project_members;

drop function if exists public.chat_inbox(), public.chat_unread_total(), public.chat_message_rows(uuid, timestamptz, int, uuid),
  public.chat_people(uuid), public.chat_member_events(uuid), public.chat_dm_candidates(), public.start_direct_chat(uuid),
  public.send_chat_message(jsonb), public.mark_chat_read(uuid), public.edit_chat_message(uuid, text);

drop table if exists public.chat_message_edits, public.chat_attachments, public.chat_mentions, public.chat_messages, public.chat_participants,
  public.chat_conversations, public.project_member_periods;

drop function if exists app.user_can_access_conversation(uuid, uuid), app.can_access_conversation(uuid),
  app.can_post_conversation(uuid), app.user_can_dm(uuid, uuid), app.chat_person(uuid), app.chat_unread_since(uuid, uuid),
  app.can_delete_chat_file(text, text), app.projects_chat_after_insert(), app.project_members_periods(),
  app.chat_messages_before_write(), app.chat_message_content_check(), app.chat_messages_after_insert(),
  app.chat_messages_after_delete_mark(), app.chat_attachments_before_insert(), app.chat_messages_after_edit(),
  app.user_can_read_conversation(uuid, uuid), app.can_read_conversation(uuid);

-- Chat notifications (the enum values chat_* cannot be dropped; harmless when unused).
delete from public.notifications where type::text like 'chat\_%';
delete from public.notification_preferences where type::text like 'chat\_%';
commit;
