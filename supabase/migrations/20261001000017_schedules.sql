-- =============================================================================
-- Migration 17 · Scheduled jobs (pg_cron runs in UTC; Dhaka = UTC+6) (Implementation Blueprint §10)
--
-- SQL jobs run inside the database. Email-sending jobs call Edge Functions through pg_net using two
-- Vault secrets that must be created once per environment (see README):
--   project_url  – https://<project-ref>.supabase.co
--   cron_secret  – shared secret checked by the Edge Functions
-- Database and Storage backups run from GitHub Actions (not pg_cron).
-- =============================================================================

create or replace function app.call_edge_function(p_name text, p_body jsonb default '{}') returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'Vault secrets project_url / cron_secret are missing; % not called', p_name;
    return null;
  end if;
  return net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body    := p_body);
end $$;
revoke execute on function app.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Re-runnable: drop any earlier definition of these jobs first.
select cron.unschedule(jobid) from cron.job
 where jobname in ('fsmb-red-mark-scan', 'fsmb-red-mark-digest', 'fsmb-deadline-scan',
                   'fsmb-notify-email', 'fsmb-lock-and-purge', 'fsmb-storage-orphans');

-- 09:05 Dhaka: log red marks (working days are checked inside the function)
select cron.schedule('fsmb-red-mark-scan',   '5 3 * * *',     $$select app.run_red_mark_scan('cron')$$);
-- 09:07 Dhaka: Edge Function emails the admin digest of today's red marks
select cron.schedule('fsmb-red-mark-digest', '7 3 * * *',     $$select app.call_edge_function('red-mark-digest')$$);
-- every 15 min, 08:00–19:45 Dhaka: deadline-approaching and overdue notifications
select cron.schedule('fsmb-deadline-scan',   '*/15 2-13 * * *', $$select app.run_deadline_scan('cron')$$);
-- every 5 min: send queued notification emails
select cron.schedule('fsmb-notify-email',    '*/5 * * * *',   $$select app.call_edge_function('notify-email')$$);
-- 00:05 Dhaka: lock yesterday's daily reports, purge old notifications
select cron.schedule('fsmb-lock-and-purge',  '5 18 * * *',    $$select app.lock_and_purge('cron')$$);
-- 02:00 Dhaka: delete orphaned files through the Storage API
select cron.schedule('fsmb-storage-orphans', '0 20 * * *',    $$select app.call_edge_function('storage-orphans')$$);
