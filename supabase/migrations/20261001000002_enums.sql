-- =============================================================================
-- Migration 02 · Enums (Implementation Blueprint §1)
-- =============================================================================

create type public.user_role           as enum ('admin', 'dept_head', 'pm', 'engineer');
create type public.project_member_role as enum ('pm', 'engineer');
create type public.project_status      as enum ('Active', 'On hold', 'Completed', 'Cancelled');
create type public.task_status         as enum ('Not started', 'Plan submitted', 'In progress', 'Blocked', 'Completed');
create type public.task_priority       as enum ('Important', 'High', 'Normal', 'Low');
create type public.task_type           as enum ('Task', 'Subtask');
create type public.breach_reason       as enum ('plan_missing', 'exec_overdue', 'daily_update_missing', 'completed_late');
create type public.notification_type   as enum ('task_assigned', 'deadline_approaching', 'task_overdue', 'pm_comment', 'status_changed');
create type public.log_scope           as enum ('project', 'user', 'system');
create type public.log_action          as enum (
  'Assigned', 'Task created', 'Plan submitted', 'Daily update', 'Daily report submitted',
  'Status change', 'Completed', 'Progress updated', 'Contribution changed', 'Extension granted',
  'Red mark', 'Comment', 'Project created', 'Edited', 'Member added', 'Member removed',
  'User added', 'Access denied'
);
