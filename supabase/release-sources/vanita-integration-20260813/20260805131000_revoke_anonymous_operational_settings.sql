begin;

revoke all on public.workspace_operational_settings from anon;
grant select on public.workspace_operational_settings to authenticated;
grant all on public.workspace_operational_settings to service_role;

-- This release makes every Vanita Integration module available to existing
-- Main customers without replacing workspace data or authentication settings.
insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, feature_key, true
from public.plans plan
cross join unnest(array[
  'products',
  'services',
  'suppliers',
  'sales',
  'inventory',
  'purchasing',
  'timesheets',
  'meetings'
]::text[]) as release_feature(feature_key)
where plan.is_active
on conflict (plan_id, feature_key) do update
set enabled = excluded.enabled;

insert into public.workspace_template_features (template_id, feature_key, enabled)
select template.id, release_feature.feature_key, true
from public.workspace_templates template
join public.plans plan on plan.id = template.plan_id and plan.is_active
cross join unnest(array[
  'products',
  'services',
  'suppliers',
  'sales',
  'inventory',
  'purchasing',
  'timesheets',
  'meetings'
]::text[]) as release_feature(feature_key)
on conflict (template_id, feature_key) do update
set enabled = excluded.enabled;

commit;
