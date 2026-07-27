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

insert into public.workspace_feature_overrides (
  workspace_id,
  feature_key,
  enabled,
  reason,
  starts_at
)
select workspace.id,
       feature_key,
       true,
       'Vanita Calendar department visual draft',
       now()
from public.workspaces workspace
cross join (values ('timesheets'), ('meetings')) as draft_features(feature_key)
where workspace.slug = 'vanita-integration'
on conflict (workspace_id, feature_key) do update
set enabled = excluded.enabled,
    reason = excluded.reason,
    starts_at = excluded.starts_at,
    ends_at = null,
    updated_at = now();
