-- =============================================================================
-- Migration 35 · Several task entries in one daily report
--
-- The Submit Daily Report form now takes several task/subtask entries in one report (still one report per
-- person, project and day; still one entry per task: daily_report_items unique (report_id, task_id)). Each entry
-- keeps its own text, so three nullable columns are added to the existing entry table:
--   work_text       "Work done today" for that task (required by the form; NULL on entries saved before this)
--   issues          that entry's issues
--   next_task_text  that entry's next task
-- Status, progress and hours of an entry already lived here (status_after, progress_after, work_hours) and are
-- applied to the task by the unchanged report-item triggers, so the weighted completion stays exactly as it is.
--
-- save_daily_report(p) (as migration 27, plus):
--   * items carry work_text / issues / next_task_text; an item sent WITHOUT work_text (the inline sheet row,
--     older callers) keeps the text its entry already has, and an item note is kept unless a new one is sent;
--   * an Admin may save the report of a current member of the project (p.user_id) and for an earlier date
--     (p.report_date, never after today). Everyone else: their own report for today, exactly as before (the
--     report triggers still enforce that, and the item trigger still allows only the person's own tasks).
--
-- Existing rows are not touched: no backfill, no column or policy is changed, grants are table-level already.
--
-- Rollback (nothing else depends on these columns):
--   restore public.save_daily_report from migration 27 (section "RPCs (A + C)");
--   alter table public.daily_report_items drop column next_task_text, drop column issues, drop column work_text;
-- =============================================================================

alter table public.daily_report_items
  add column work_text      text constraint daily_report_items_work_text_len check (work_text is null or length(work_text) between 1 and 3000),
  add column issues         text constraint daily_report_items_issues_len    check (issues is null or length(issues) <= 3000),
  add column next_task_text text constraint daily_report_items_next_len      check (next_task_text is null or length(next_task_text) <= 1000);

comment on column public.daily_report_items.work_text is 'Work done that day on this task (one entry of a multi-entry daily report).';
comment on column public.daily_report_items.issues is 'Issues of this entry.';
comment on column public.daily_report_items.next_task_text is 'Next task of this entry.';

-- p = {"project_id": uuid, "report_date": date (Admin: any day up to today; others: today), "user_id": uuid (Admin only),
--      "update_text": text, "issues": text, "next_task_id": uuid, "next_task_text": text, "remarks": text (Admin),
--      "work_hours": numeric (hours not tied to a task; absent = keep),
--      "items": [{"task_id": uuid, "progress_after": 0-100, "status_after": "In progress", "note": text,
--                 "work_hours": numeric, "work_text": text, "issues": text, "next_task_text": text}],
--      "remove_task_ids": [uuid]}
create or replace function public.save_daily_report(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id      uuid;
  v_items   jsonb := case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]'::jsonb end;
  v_remove  uuid[] := array(select x::uuid from jsonb_array_elements_text(
                        case when jsonb_typeof(p -> 'remove_task_ids') = 'array' then p -> 'remove_task_ids' else '[]'::jsonb end) x);
  v_admin   boolean := app.is_admin();
  v_set_remarks boolean := p ? 'remarks' and v_admin;
  v_set_hours   boolean := p ? 'work_hours';
  v_project uuid := (p ->> 'project_id')::uuid;
  v_user    uuid := auth.uid();
  v_date    date := coalesce(nullif(p ->> 'report_date', '')::date, app.dhaka_today());
begin
  if nullif(p ->> 'user_id', '') is not null and (p ->> 'user_id')::uuid is distinct from auth.uid() then
    if not v_admin then
      raise exception 'Only an admin can save a daily report for another person' using errcode = '42501';
    end if;
    v_user := (p ->> 'user_id')::uuid;
    if not app.user_is_member(v_user, v_project) then
      raise exception 'The person must be a current member of the project' using errcode = '23514';
    end if;
  end if;
  if v_date > app.dhaka_today() then
    raise exception 'A daily report cannot be dated after today' using errcode = '22023';
  end if;

  insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_id, next_task_text, remarks, work_hours)
  values (v_user, v_project, v_date,
          p ->> 'update_text', p ->> 'issues', nullif(p ->> 'next_task_id', '')::uuid, p ->> 'next_task_text',
          case when v_set_remarks then nullif(p ->> 'remarks', '') end, nullif(p ->> 'work_hours', '')::numeric)
  on conflict (user_id, project_id, report_date) do update
     set update_text = excluded.update_text, issues = excluded.issues, next_task_id = excluded.next_task_id,
         next_task_text = excluded.next_task_text,
         remarks = case when v_set_remarks then excluded.remarks else public.daily_reports.remarks end,
         work_hours = case when v_set_hours then excluded.work_hours else public.daily_reports.work_hours end
  returning id into v_id;

  if cardinality(v_remove) > 0 then
    delete from public.daily_report_items i
     where i.report_id = v_id
       and i.task_id = any (v_remove)
       and i.task_id not in (select (x ->> 'task_id')::uuid from jsonb_array_elements(v_items) x);
  end if;

  -- created_at keeps the entries in the order they were sent (one statement shares now(): a microsecond apart);
  -- an entry already saved keeps its own place
  insert into public.daily_report_items (report_id, task_id, progress_after, status_after, note, work_hours,
                                         work_text, issues, next_task_text, created_at)
  select v_id, (x ->> 'task_id')::uuid, (x ->> 'progress_after')::numeric,
         nullif(x ->> 'status_after', '')::public.task_status, nullif(x ->> 'note', ''), nullif(x ->> 'work_hours', '')::numeric,
         nullif(btrim(x ->> 'work_text'), ''), nullif(btrim(x ->> 'issues'), ''), nullif(btrim(x ->> 'next_task_text'), ''),
         now() + make_interval(secs => n / 1000000.0)
    from jsonb_array_elements(v_items) with ordinality as e(x, n)
  on conflict (report_id, task_id) do update
     set progress_after = excluded.progress_after, status_after = excluded.status_after,
         note           = coalesce(excluded.note, public.daily_report_items.note),
         work_hours     = excluded.work_hours,
         -- an entry from the multi-entry form always has its work text: then all three texts are its own;
         -- an item without it (inline sheet row, older callers) leaves the entry's texts as they are
         work_text      = coalesce(excluded.work_text, public.daily_report_items.work_text),
         issues         = case when excluded.work_text is not null then excluded.issues else public.daily_report_items.issues end,
         next_task_text = case when excluded.work_text is not null then excluded.next_task_text else public.daily_report_items.next_task_text end;
  return v_id;
end $$;
