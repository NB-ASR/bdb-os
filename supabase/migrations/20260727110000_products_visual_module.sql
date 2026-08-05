insert into public.features (
  key,
  name,
  description,
  category,
  route,
  sort_order,
  is_active
)
values (
  'products',
  'Products',
  'Reusable product catalogue for inventory, supplier documents, sales and invoice lines.',
  'operations',
  '/products',
  46,
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
       'products',
       true,
       'Vanita products visual module migration preview',
       now()
from public.workspaces workspace
where workspace.slug = 'vanita-integration'
on conflict (workspace_id, feature_key) do update
set enabled = excluded.enabled,
    reason = excluded.reason,
    starts_at = excluded.starts_at,
    ends_at = null,
    updated_at = now();
