-- Team administration is a core BDB OS responsibility. Ensure the feature row
-- exists before plan mappings are inserted so clean and older databases behave
-- identically.
insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'team_members',
  'Team access',
  'Invite employees and control workspace roles and permissions.',
  'administration',
  '/team',
  130,
  true
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, 'team_members', true
from public.plans plan
where plan.is_active
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;

-- Support the membership, active-context and permission checks used on every
-- authenticated request without changing notification, reminder or storage data.
create index if not exists workspace_memberships_active_user_idx
  on public.workspace_memberships(user_id, workspace_id)
  where status = 'active';
create index if not exists workspace_memberships_active_owner_idx
  on public.workspace_memberships(workspace_id, user_id)
  where status = 'active' and access_profile = 'owner';
create index if not exists profiles_active_workspace_idx
  on public.profiles(active_workspace_id)
  where active_workspace_id is not null;
create index if not exists business_group_workspaces_workspace_group_idx
  on public.business_group_workspaces(workspace_id, group_id);
