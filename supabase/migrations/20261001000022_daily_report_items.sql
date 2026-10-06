-- =============================================================================
-- Migration 22 · Daily report items are never removed implicitly
--
-- A. save_daily_report(p)   used to delete every item of the report that was not in p.items. The update form
--                           lists only open tasks, so reopening a report after its task was completed sent an
--                           empty list and the task entry was deleted. Now items are only added or updated;
--                           an item is removed only when its task id is named in p.remove_task_ids (the user
--                           changed or cleared the Main Task). RLS and the report-item triggers still decide
--                           whose items may be removed (own open report, or Admin).
-- B. save_daily_row(p)      one transaction for a row of the Daily Reports sheet written for another person or
--                           an earlier date (Admin only). It replaces three to five separate statements in the
--                           Server Action, which could leave a report saved with its items already removed.
--                           A new row is inserted, never upserted: an existing report for that person, project
--                           and date raises 23505 and nothing changes.
-- Both functions are SECURITY INVOKER: every existing RLS policy and trigger applies unchanged. No tables,
-- columns, policies or rows change.
--
-- Rollback:
--   drop function public.save_daily_row(jsonb);
--   and restore public.save_daily_report from migration 14 (section 27).
-- =============================================================================

-- ---------- A. Save today's daily report: items are added or updated, removed only on request ----------
-- p = {"project_id": uuid, "update_text": text, "issues": text, "next_task_id": uuid, "next_task_text": text,
--      "remarks": text,
--      "items": [{"task_id": uuid, "progress_after": 0-100, "status_after": "In progress", "note": text}],
--      "remove_task_ids": [uuid]}
create or replace function public.save_daily_report(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id     uuid;
  v_items  jsonb := case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]'::jsonb end;
  v_remove uuid[] := array(select x::uuid from jsonb_array_elements_text(
                       case when jsonb_typeof(p -> 'remove_task_ids') = 'array' then p -> 'remove_task_ids' else '[]'::jsonb end) x);
begin
  insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_id, next_task_text, remarks)
  values (auth.uid(), (p ->> 'project_id')::uuid, coalesce((p ->> 'report_date')::date, app.dhaka_today()),
          p ->> 'update_text', p ->> 'issues', nullif(p ->> 'next_task_id', '')::uuid, p ->> 'next_task_text', p ->> 'remarks')
  on conflict (user_id, project_id, report_date) do update
     set update_text = excluded.update_text, issues = excluded.issues, next_task_id = excluded.next_task_id,
         next_task_text = excluded.next_task_text, remarks = excluded.remarks
  returning id into v_id;

  if cardinality(v_remove) > 0 then
    delete from public.daily_report_items i
     where i.report_id = v_id
       and i.task_id = any (v_remove)
       and i.task_id not in (select (x ->> 'task_id')::uuid from jsonb_array_elements(v_items) x);
  end if;

  insert into public.daily_report_items (report_id, task_id, progress_after, status_after, note)
  select v_id, (x ->> 'task_id')::uuid, (x ->> 'progress_after')::numeric,
         nullif(x ->> 'status_after', '')::public.task_status, x ->> 'note'
    from jsonb_array_elements(v_items) x
  on conflict (report_id, task_id) do update
     set progress_after = excluded.progress_after, status_after = excluded.status_after, note = excluded.note;
  return v_id;
end $$;

-- ---------- B. One row of the Daily Reports sheet for another person or an earlier date (Admin) ----------
-- p = {"report_id": uuid | null, "user_id": uuid, "project_id": uuid, "report_date": date, "update_text": text,
--      "issues": text, "next_task_text": text, "remarks": text,
--      "item": {"task_id": uuid, "progress_after": 0-100, "status_after": "In progress"} | null,
--      "remove_task_ids": [uuid]}
-- report_id null = a new report (refused if one exists); otherwise that report's text is updated.
create or replace function public.save_daily_row(p jsonb) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_report  uuid := nullif(p ->> 'report_id', '')::uuid;
  v_user    uuid := nullif(p ->> 'user_id', '')::uuid;
  v_project uuid := nullif(p ->> 'project_id', '')::uuid;
  v_date    date := nullif(p ->> 'report_date', '')::date;
  v_item    jsonb := case when jsonb_typeof(p -> 'item') = 'object' then p -> 'item' end;
  v_remove  uuid[] := array(select x::uuid from jsonb_array_elements_text(
                        case when jsonb_typeof(p -> 'remove_task_ids') = 'array' then p -> 'remove_task_ids' else '[]'::jsonb end) x);
  v_id      uuid;
begin
  if v_user is null or v_project is null or v_date is null then
    raise exception 'A daily report needs a person, a project and a date' using errcode = '22023';
  end if;
  if v_date > app.dhaka_today() then
    raise exception 'A daily report cannot be dated after today' using errcode = '22023';
  end if;
  if not app.is_admin() and (v_user is distinct from auth.uid() or v_date <> app.dhaka_today()) then
    raise exception 'Only an admin can add or change a daily report for an earlier date or for another person'
      using errcode = '42501';
  end if;

  if v_report is null then
    if not app.user_is_member(v_user, v_project) then
      raise exception 'The person must be a current member of the project' using errcode = '23514';
    end if;
    insert into public.daily_reports (user_id, project_id, report_date, update_text, issues, next_task_text, remarks)
    values (v_user, v_project, v_date, p ->> 'update_text', nullif(p ->> 'issues', ''), nullif(p ->> 'next_task_text', ''),
            nullif(p ->> 'remarks', ''))
    returning id into v_id;                                   -- one_report_per_day: an existing report raises 23505
  else
    update public.daily_reports r
       set update_text = p ->> 'update_text', issues = nullif(p ->> 'issues', ''),
           next_task_text = nullif(p ->> 'next_task_text', ''), remarks = nullif(p ->> 'remarks', '')
     where r.id = v_report and r.user_id = v_user and r.project_id = v_project and r.report_date = v_date
    returning r.id into v_id;
    if v_id is null then
      raise exception 'Not found, or you no longer have access to it.' using errcode = 'P0002';
    end if;
  end if;

  if cardinality(v_remove) > 0 then
    delete from public.daily_report_items i
     where i.report_id = v_id
       and i.task_id = any (v_remove)
       and (v_item is null or i.task_id <> (v_item ->> 'task_id')::uuid);
  end if;

  if v_item is not null then
    insert into public.daily_report_items (report_id, task_id, progress_after, status_after)
    values (v_id, (v_item ->> 'task_id')::uuid, (v_item ->> 'progress_after')::numeric,
            nullif(v_item ->> 'status_after', '')::public.task_status)
    on conflict (report_id, task_id) do update
       set progress_after = excluded.progress_after, status_after = excluded.status_after;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_daily_row(jsonb) from public, anon;
grant execute on function public.save_daily_row(jsonb) to authenticated, service_role;
