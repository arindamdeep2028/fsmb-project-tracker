-- =============================================================================
-- Migration 16 · Grants, revokes and the Custom Access Token Hook (Implementation Blueprint §10)
-- Supabase grants broad default privileges to anon/authenticated on schema public; they are
-- narrowed here so that RLS is the second wall, not the only one.
-- =============================================================================

-- ---------- Reset ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app    from public, anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;

-- ---------- authenticated: tables and views ----------
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;                 -- rows limited by RLS / view filters
grant insert, update on public.projects, public.project_members, public.tasks, public.task_comments,
                        public.daily_reports, public.daily_report_items, public.notification_preferences,
                        public.departments, public.department_heads to authenticated;
grant insert on public.daily_report_attachments, public.task_extensions to authenticated;
grant update on public.profiles, public.workspace_settings, public.notifications to authenticated;
grant delete on public.departments, public.department_heads, public.task_comments, public.daily_report_items,
                public.daily_report_attachments, public.notifications to authenticated;

-- ---------- authenticated: app schema (used inside policies and views; schema is not exposed) ----------
grant usage on schema app to authenticated;
grant select on app.task_weights, app.project_metrics to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on function
  app.run_red_mark_scan(text), app.run_deadline_scan(text), app.lock_and_purge(text), app.pending_emails(int),
  app.recompute_open_deadlines(), app.next_task_code(uuid, uuid), app.log_event(public.log_action, uuid, uuid, uuid, text, public.breach_reason, text, public.log_scope),
  app.notify(uuid, public.notification_type, text, text, uuid, uuid, text), app.handle_new_user(),
  app.performance_rows(date, date, uuid, uuid)
from authenticated;

-- ---------- authenticated: RPC functions ----------
grant execute on function
  public.project_engineers(uuid), public.assignable_users(uuid), public.project_progress(uuid),
  public.member_contribution(uuid), public.my_contribution(uuid), public.save_daily_report(jsonb),
  public.complete_task(uuid), public.grant_extension(uuid, timestamptz, text), public.set_task_deadline(uuid, timestamptz),
  public.performance_summary(date, date, uuid), public.my_performance(date, date),
  public.my_dashboard(), public.my_projects_dashboard(), public.department_dashboard(uuid, date, date),
  public.admin_dashboard()
to authenticated;

-- ---------- service_role (Edge Functions, import, backups) ----------
grant usage on schema public, app to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select on all tables in schema app to service_role;
grant execute on all functions in schema public, app to service_role;

-- ---------- future objects: no automatic access for anon / authenticated ----------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app    revoke execute on functions from public, anon, authenticated;

-- ---------- Custom Access Token Hook: adds user_role and user_active claims (routing only) ----------
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}');
  v_role   public.user_role;
  v_active boolean;
begin
  select p.role, p.active into v_role, v_active from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_role::text, 'none')));
  v_claims := jsonb_set(v_claims, '{user_active}', to_jsonb(coalesce(v_active, false)));
  return jsonb_set(event, '{claims}', v_claims);
end $$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
create policy auth_admin_read_profiles on public.profiles for select to supabase_auth_admin using (true);
