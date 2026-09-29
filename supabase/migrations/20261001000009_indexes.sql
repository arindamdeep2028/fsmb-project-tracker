-- =============================================================================
-- Migration 09 · Indexes (Implementation Blueprint §5): 10 unique + 28 lookup
-- =============================================================================

-- Unique rules (daily_report_items(report_id, task_id), profiles.login_name, profiles.email, departments.name, tasks(project_id, code) and
-- daily_reports(user_id, project_id, report_date) already have unique constraints)
create unique index projects_code_active_uq      on public.projects (code) where not archived;
create unique index notifications_dedup_uq       on public.notifications (user_id, dedup_key) where dedup_key is not null;
create unique index activity_log_red_mark_uq     on public.activity_log (task_id, reason_code, log_date) where action = 'Red mark';

-- Lookups used by RLS helpers and pages
create index department_heads_user_idx           on public.department_heads (user_id);
create index profiles_department_idx             on public.profiles (department_id);
create index projects_department_idx             on public.projects (department_id) where not archived;
create index projects_pm_idx                     on public.projects (pm_id);
create index project_members_user_idx            on public.project_members (user_id, project_id) where removed_at is null;
create index project_members_role_idx            on public.project_members (project_id, member_role) where removed_at is null;
create index tasks_tree_idx                      on public.tasks (project_id, parent_id) where not archived;
create index tasks_assignee_idx                  on public.tasks (assigned_to, status) where not archived;
create index tasks_creator_idx                   on public.tasks (project_id, created_by);
create index tasks_effective_due_idx             on public.tasks (effective_due_at) where status <> 'Completed' and not archived;
create index tasks_plan_due_idx                  on public.tasks (plan_due_at) where plan_submitted_at is null and status <> 'Completed';
create index tasks_assigned_by_idx               on public.tasks (assigned_by);
create index tasks_parent_idx                    on public.tasks (parent_id);
create index task_extensions_task_idx            on public.task_extensions (task_id, granted_at desc);
create index task_contributions_task_idx         on public.task_contributions (task_id, recorded_at desc);
create index task_contributions_user_idx         on public.task_contributions (user_id, recorded_at);
create index task_contributions_item_idx         on public.task_contributions (daily_report_item_id);
create index task_comments_task_idx              on public.task_comments (task_id, created_at);
create index task_comments_parent_idx            on public.task_comments (parent_comment_id);
create index task_comments_author_idx            on public.task_comments (author_id);
create index daily_reports_feed_idx              on public.daily_reports (project_id, report_date desc);
create index daily_reports_next_task_idx         on public.daily_reports (next_task_id);
create index daily_report_items_task_idx         on public.daily_report_items (task_id);
create index daily_report_attachments_report_idx on public.daily_report_attachments (report_id);
create index notifications_inbox_idx             on public.notifications (user_id, read_at, created_at desc);
create index notifications_email_queue_idx       on public.notifications (created_at) where email_wanted and emailed_at is null;
create index activity_log_ts_idx                 on public.activity_log (ts desc);
create index activity_log_subject_idx            on public.activity_log (subject_user_id, action, log_date);
create index activity_log_project_idx            on public.activity_log (project_id, ts desc);
create index activity_log_task_idx               on public.activity_log (task_id);
