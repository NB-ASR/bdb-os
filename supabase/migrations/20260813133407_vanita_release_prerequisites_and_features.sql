-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133407_vanita_release_prerequisites_and_features.sql.
-- Sources: 20260726135542_revoke_rls_auto_enable_execute.sql through 20260727134000_calendar_department_draft_modules.sql.
-- Keep the automatic RLS event-trigger helper internal to the database.
-- Browser-facing roles must not be able to invoke this SECURITY DEFINER function through RPC.
-- Some clean migration replays do not contain the historical helper, so the revoke must be conditional.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;


insert into public.features (
  key,
  name,
  description,
  category,
  route,
  sort_order,
  is_active
)
values
  (
    'timesheets',
    'Timesheets',
    'Scheduled time, attendance review, exceptions and approval workflow.',
    'operations',
    '/calendar/timesheets',
    31,
    true
  ),
  (
    'meetings',
    'Meetings',
    'Internal, customer and supplier meeting coordination with linked records.',
    'operations',
    '/calendar/meetings',
    32,
    true
  )
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;
