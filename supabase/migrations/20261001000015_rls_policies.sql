-- =============================================================================
-- Migration 15 · Row Level Security policies (Implementation Blueprint §8; v2 §11)
--
--   Admin            – full access to every business row (is_admin() passes every scope helper)
--   Department Head  – every project in departments they head (heads_department)
--   Project Manager  – projects where they are a current pm member (is_project_pm / manages_project)
--   Engineer         – projects where they are a current member; inside them only tasks they are
--                      assigned to or created, plus all members' daily reports
-- Column-level limits (what an engineer may change) are enforced by tasks_before_write (migration 12).
-- No policy exists for anon. Rules listing several commands are one policy per command.
-- Audit tables stay append-only by design: activity_log / scan_runs / task_contributions have no
-- user write policies; rows come only from definer triggers and jobs.
-- =============================================================================

-- ---------- workspace_settings ----------
create policy settings_read on public.workspace_settings for select to authenticated
  using ((select app.is_active_user()));
create policy settings_admin_update on public.workspace_settings for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ---------- departments ----------
create policy departments_read on public.departments for select to authenticated
  using ((select app.is_active_user()));
create policy departments_admin_insert on public.departments for insert to authenticated
  with check ((select app.is_admin()));
create policy departments_admin_update on public.departments for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy departments_admin_delete on public.departments for delete to authenticated
  using ((select app.is_admin()));

-- ---------- department_heads ----------
create policy dept_heads_read on public.department_heads for select to authenticated
  using ((select app.is_admin()) or user_id = (select auth.uid()));
create policy dept_heads_admin_insert on public.department_heads for insert to authenticated
  with check ((select app.is_admin()));
create policy dept_heads_admin_update on public.department_heads for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy dept_heads_admin_delete on public.department_heads for delete to authenticated
  using ((select app.is_admin()));

-- ---------- profiles (created only by the auth trigger; never deleted by users) ----------
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_admin())
         or app.in_my_department(id) or app.shares_project_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()))
  with check (id = (select auth.uid()) or (select app.is_admin()));

-- ---------- projects (archive instead of delete) ----------
create policy projects_read on public.projects for select to authenticated
  using (app.can_see_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check ((select app.is_admin()) or app.heads_department(department_id));
create policy projects_update on public.projects for update to authenticated
  using (app.manages_project(id))
  with check ((select app.is_admin()) or app.heads_department(department_id) or app.is_project_pm(id));

-- ---------- project_members (soft removal instead of delete) ----------
create policy members_read on public.project_members for select to authenticated
  using (app.can_see_project(project_id));
create policy members_insert on public.project_members for insert to authenticated
  with check (app.manages_project(project_id));
create policy members_update on public.project_members for update to authenticated
  using (app.manages_project(project_id)) with check (app.manages_project(project_id));

-- ---------- tasks (archive instead of delete) ----------
create policy tasks_read on public.tasks for select to authenticated
  using (app.manages_project(project_id)
         or (app.is_project_member(project_id)
             and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))));
create policy tasks_insert_manager on public.tasks for insert to authenticated
  with check (app.manages_project(project_id));
create policy tasks_insert_engineer on public.tasks for insert to authenticated
  with check (app.is_project_member(project_id)
              and created_by = (select auth.uid())
              and (assigned_to = (select auth.uid()) or app.is_engineer_member(project_id, assigned_to)));
create policy tasks_update_manager on public.tasks for update to authenticated
  using (app.manages_project(project_id)) with check (app.manages_project(project_id));
create policy tasks_update_engineer on public.tasks for update to authenticated
  using (app.is_project_member(project_id)
         and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  with check (app.is_project_member(project_id)
              and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())
                   or app.is_engineer_member(project_id, assigned_to)));

-- ---------- task_extensions (written through grant_extension) ----------
create policy extensions_read on public.task_extensions for select to authenticated
  using (app.can_see_task(task_id));
create policy extensions_insert on public.task_extensions for insert to authenticated
  with check (app.manages_project(app.task_project(task_id)));

-- ---------- task_contributions (history; written only by the tasks trigger) ----------
create policy contributions_read on public.task_contributions for select to authenticated
  using (app.can_see_task(task_id));

-- ---------- task_comments ----------
create policy comments_read on public.task_comments for select to authenticated
  using (app.can_see_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated
  with check (app.can_see_task(task_id) and author_id = (select auth.uid()));
create policy comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_admin_delete on public.task_comments for delete to authenticated
  using ((select app.is_admin()));

-- ---------- daily_reports (every member of the project can read all members' reports) ----------
create policy reports_read on public.daily_reports for select to authenticated
  using (app.can_see_project(project_id));
create policy reports_insert on public.daily_reports for insert to authenticated
  with check ((user_id = (select auth.uid()) and app.is_project_member(project_id)) or (select app.is_admin()));
create policy reports_update on public.daily_reports for update to authenticated
  using ((user_id = (select auth.uid()) and not locked) or (select app.is_admin()))
  with check (user_id = (select auth.uid()) or (select app.is_admin()));

-- ---------- daily_report_items ----------
create policy items_read on public.daily_report_items for select to authenticated
  using (app.can_see_report(report_id));
create policy items_insert on public.daily_report_items for insert to authenticated
  with check (app.owns_open_report(report_id) or (select app.is_admin()));
create policy items_update on public.daily_report_items for update to authenticated
  using (app.owns_open_report(report_id) or (select app.is_admin()))
  with check (app.owns_open_report(report_id) or (select app.is_admin()));
create policy items_delete on public.daily_report_items for delete to authenticated
  using (app.owns_open_report(report_id) or (select app.is_admin()));

-- ---------- daily_report_attachments (PMs / heads / admins may remove project files) ----------
create policy attachments_read on public.daily_report_attachments for select to authenticated
  using (app.can_see_report(report_id));
create policy attachments_insert on public.daily_report_attachments for insert to authenticated
  with check (app.owns_open_report(report_id) or (select app.is_admin()));
create policy attachments_delete on public.daily_report_attachments for delete to authenticated
  using (app.owns_open_report(report_id) or app.manages_project(app.report_project(report_id)));

-- ---------- notifications (recipient only; admins can read all for support) ----------
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- notification_preferences ----------
create policy prefs_read on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy prefs_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy prefs_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- activity_log (append-only) ----------
create policy log_read on public.activity_log for select to authenticated
  using ((select app.is_admin())
         or (scope = 'project' and app.manages_project(project_id))
         or subject_user_id = (select auth.uid())
         or actor_user_id = (select auth.uid()));

-- ---------- scan_runs ----------
create policy scan_runs_admin_read on public.scan_runs for select to authenticated
  using ((select app.is_admin()));
