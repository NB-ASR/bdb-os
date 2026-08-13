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
