-- =============================================================================
-- FSMB Project Tracker · Migration 01 · Extensions and the private `app` schema
-- Source: FSMB Supabase Database Implementation Blueprint §11 (file 01)
-- =============================================================================

-- gen_random_uuid() is built in (pg_catalog); pgcrypto supplies crypt()/gen_salt() for seeds.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext   with schema extensions;
create extension if not exists pg_cron;              -- creates schema `cron`
create extension if not exists pg_net;               -- creates schema `net` (HTTP calls to Edge Functions)

-- Private schema for helper, rule and job functions. It is NOT added to the API's
-- exposed schemas, so nothing in it can be called through PostgREST.
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated, service_role;
