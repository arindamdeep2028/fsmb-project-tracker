-- =============================================================================
-- Migration 18 · Storage: private bucket `daily-report-files` and its policies (Implementation Blueprint §9)
-- Supabase Storage only (no Google Drive). Path: {project_id}/{report_id}/{uuid}-{file name}
--   Engineers – upload to their own open report in projects where they are members; read files
--               of every project they can see
--   PM / Department Head – read project files; delete (manage) files of projects they manage
--   Admin     – read, upload, update and delete every file
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('daily-report-files', 'daily-report-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- True when the caller may upload to this path: the report exists, belongs to the project in the
-- path, was written by the caller today and is not locked.
create or replace function app.can_upload_report_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.daily_reports r
                  where r.id = app.path_uuid(p_name, 2)
                    and r.project_id = app.path_uuid(p_name, 1)
                    and app.owns_open_report(r.id));
$$;
grant execute on function app.can_upload_report_file(text) to authenticated;

create policy report_files_read on storage.objects for select to authenticated
  using (bucket_id = 'daily-report-files'
         and ((select app.is_admin()) or app.can_see_project(app.path_uuid(name, 1))));

create policy report_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-report-files'
              and ((select app.is_admin()) or app.can_upload_report_file(name)));

create policy report_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'daily-report-files'
         and ((select app.is_admin()) or app.can_upload_report_file(name)
              or app.manages_project(app.path_uuid(name, 1))));

create policy report_files_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'daily-report-files' and (select app.is_admin()))
  with check (bucket_id = 'daily-report-files' and (select app.is_admin()));
