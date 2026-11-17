-- Rollback for migration 26 (announcements). DELETES every announcement, its department targets and read marks.
-- Take a backup first if any announcements should be kept. Afterwards:
--   supabase migration repair --status reverted 20261001000026
begin;
drop function if exists public.mark_all_announcements_read();
drop function if exists public.save_announcement(jsonb);
drop function if exists public.announcement_targets();
drop function if exists public.announcement_unread_count();
drop function if exists public.announcement_feed();
drop table if exists public.announcement_reads;
drop table if exists public.announcement_departments;
drop table if exists public.announcements;
drop function if exists app.announcement_shape_check();
drop function if exists app.announcements_before_write();
drop function if exists app.announcement_reach(uuid);
drop function if exists app.announcement_person(uuid);
drop function if exists app.can_read_announcement_id(uuid);
drop function if exists app.can_read_announcement(uuid, text, uuid, uuid);
drop function if exists app.can_edit_announcement(uuid);
drop function if exists app.can_announce_to_project(uuid);
drop function if exists app.can_announce_to_department(uuid);
drop function if exists app.user_can_read_announcement(uuid, uuid, text, uuid, uuid);
drop function if exists app.user_can_announce_to_department(uuid, uuid);
commit;
