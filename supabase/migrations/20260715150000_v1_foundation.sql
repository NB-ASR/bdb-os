-- BDB OS V1 foundation
-- Founder bootstrap state, invitation-based client access, granular permissions,
-- linked business groups, and action-aware workspace permissions.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists active_workspace_id uuid references public.workspaces(id) on delete set null;

alter table public.workspace_memberships
  add column if not exists access_profile text not null default 'employee';

update public.workspace_memberships
set access_profile = case role::text
  when 'owner' then 'owner'
  when 'admin' then 'owner'
  when 'manager' then 'manager'
  else 'employee'
end
where access_profile = 'employee'
   or access_profile is null
   or access_profile not in ('owner', 'manager', 'employee', 'custom');

alter table public.workspace_memberships
  drop constraint if exists workspace_memberships_access_profile_check;
alter table public.workspace_memberships
  add constraint workspace_memberships_access_profile_check
  check (access_profile in ('owner', 'manager', 'employee', 'custom'));

create table if not exists public.business_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug extensions.citext not null unique check (slug::text ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_group_workspaces (
  group_id uuid not null references public.business_groups(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, workspace_id)
);

create table if not exists public.workspace_member_permissions (
  workspace_id uuid not null,
  user_id uuid not null,
  feature_key text not null references public.features(key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, feature_key),
  foreign key (workspace_id, user_id)
    references public.workspace_memberships(workspace_id, user_id) on delete cascade
);

create index if not exists workspace_member_permissions_user_idx
  on public.workspace_member_permissions(user_id, workspace_id);
create index if not exists business_group_workspaces_group_idx
  on public.business_group_workspaces(group_id, workspace_id);

-- Keep timestamps consistent with the existing SaaS foundation.
drop trigger if exists business_groups_touch_updated_at on public.business_groups;
create trigger business_groups_touch_updated_at
before update on public.business_groups
for each row execute function private.touch_updated_at();

drop trigger if exists workspace_member_permissions_touch_updated_at on public.workspace_member_permissions;
create trigger workspace_member_permissions_touch_updated_at
before update on public.workspace_member_permissions
for each row execute function private.touch_updated_at();

create or replace function private.is_active_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or exists (
      select 1
      from public.workspace_memberships membership
      where membership.workspace_id = target_workspace_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.access_profile = 'owner'
    );
$$;

create or replace function private.can_administer_member_permissions(
  target_workspace_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or (
      target_user_id <> (select auth.uid())
      and private.is_active_workspace_owner(target_workspace_id)
      and exists (
        select 1
        from public.workspace_memberships target_membership
        where target_membership.workspace_id = target_workspace_id
          and target_membership.user_id = target_user_id
          and target_membership.access_profile <> 'owner'
      )
    );
$$;

create or replace function private.has_workspace_permission(
  target_workspace_id uuid,
  target_feature_key text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with membership as (
    select m.access_profile
    from public.workspace_memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
    limit 1
  ), explicit_permission as (
    select p.*
    from public.workspace_member_permissions p
    where p.workspace_id = target_workspace_id
      and p.user_id = (select auth.uid())
      and p.feature_key = target_feature_key
    limit 1
  )
  select case
    when private.is_platform_admin() then true
    when not exists (select 1 from membership) then false
    when target_feature_key = 'team_members' then case
      when (select access_profile from membership) = 'owner' then true
      when not private.has_feature(target_workspace_id, target_feature_key) then false
      when (select access_profile from membership) = 'manager' then target_action = 'view'
      when (select access_profile from membership) = 'custom'
        and target_action = 'view'
        and exists (select 1 from explicit_permission)
        then (select can_view from explicit_permission)
      else false
    end
    when not private.has_feature(target_workspace_id, target_feature_key) then false
    when (select access_profile from membership) = 'owner' then true
    when exists (select 1 from explicit_permission) then case target_action
      when 'view' then (select can_view from explicit_permission)
      when 'create' then (select can_create from explicit_permission)
      when 'edit' then (select can_edit from explicit_permission)
      when 'delete' then (select can_delete from explicit_permission)
      when 'approve' then (select can_approve from explicit_permission)
      when 'export' then (select can_export from explicit_permission)
      else false
    end
    when (select access_profile from membership) = 'manager'
      then target_action in ('view', 'create', 'edit', 'approve', 'export')
    when (select access_profile from membership) = 'employee'
      then target_action in ('view', 'create', 'edit')
    else false
  end;
$$;

revoke all on function private.is_active_workspace_owner(uuid) from public;
revoke all on function private.can_administer_member_permissions(uuid, uuid) from public;
revoke all on function private.has_workspace_permission(uuid, text, text) from public;
grant execute on function private.is_active_workspace_owner(uuid) to authenticated;
grant execute on function private.can_administer_member_permissions(uuid, uuid) to authenticated;
grant execute on function private.has_workspace_permission(uuid, text, text) to authenticated;

create or replace function public.get_my_linked_workspaces()
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  group_id uuid,
  group_name text,
  membership_role text,
  access_profile text,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_workspace as (
    select coalesce(
      (
        select profile.active_workspace_id
        from public.profiles profile
        join public.workspace_memberships active_membership
          on active_membership.workspace_id = profile.active_workspace_id
         and active_membership.user_id = profile.id
         and active_membership.status = 'active'
        join public.workspaces active_workspace
          on active_workspace.id = active_membership.workspace_id
         and active_workspace.status in ('trial', 'active')
        where profile.id = (select auth.uid())
      ),
      (
        select membership.workspace_id
        from public.workspace_memberships membership
        join public.workspaces workspace on workspace.id = membership.workspace_id
        where membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and workspace.status in ('trial', 'active')
        order by case membership.access_profile
          when 'owner' then 0
          when 'manager' then 1
          when 'employee' then 2
          else 3
        end, membership.created_at, membership.workspace_id
        limit 1
      )
    ) as workspace_id
  ), selected_group as (
    select link.group_id
    from public.business_group_workspaces link
    join selected_workspace selected on selected.workspace_id = link.workspace_id
  )
  select workspace.id,
         workspace.name,
         workspace.slug::text,
         link.group_id,
         group_record.name,
         membership.role::text,
         membership.access_profile,
         workspace.id = (select selected.workspace_id from selected_workspace selected)
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  left join public.business_group_workspaces link on link.workspace_id = workspace.id
  left join public.business_groups group_record on group_record.id = link.group_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and workspace.status in ('trial', 'active')
    and (
      workspace.id = (select selected.workspace_id from selected_workspace selected)
      or link.group_id in (select selected_group.group_id from selected_group)
    )
  order by workspace.name;
$$;

revoke all on function public.get_my_linked_workspaces() from public, anon;
grant execute on function public.get_my_linked_workspaces() to authenticated;

alter table public.business_groups enable row level security;
alter table public.business_group_workspaces enable row level security;
alter table public.workspace_member_permissions enable row level security;

grant select on public.business_groups, public.business_group_workspaces to authenticated;
grant select, insert, update, delete on public.workspace_member_permissions to authenticated;

-- Initial group visibility is narrowed further once active-context enforcement is installed.
drop policy if exists "Members can view their approved business groups" on public.business_groups;
create policy "Members can view their approved business groups"
on public.business_groups for select to authenticated
using (
  private.is_platform_admin() or exists (
    select 1
    from public.business_group_workspaces link
    join public.workspace_memberships membership on membership.workspace_id = link.workspace_id
    where link.group_id = business_groups.id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

drop policy if exists "Members can view approved group links" on public.business_group_workspaces;
create policy "Members can view approved group links"
on public.business_group_workspaces for select to authenticated
using (
  private.is_platform_admin() or exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = business_group_workspaces.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

drop policy if exists "Managers can view member permissions" on public.workspace_member_permissions;
drop policy if exists "Owners and members can view member permissions" on public.workspace_member_permissions;
create policy "Owners and members can view member permissions"
on public.workspace_member_permissions for select to authenticated
using (
  private.is_platform_admin()
  or private.is_active_workspace_owner(workspace_id)
  or user_id = (select auth.uid())
);

drop policy if exists "Managers can create member permissions" on public.workspace_member_permissions;
drop policy if exists "Owners can create member permissions" on public.workspace_member_permissions;
create policy "Owners can create member permissions"
on public.workspace_member_permissions for insert to authenticated
with check (private.can_administer_member_permissions(workspace_id, user_id));

drop policy if exists "Managers can update member permissions" on public.workspace_member_permissions;
drop policy if exists "Owners can update member permissions" on public.workspace_member_permissions;
create policy "Owners can update member permissions"
on public.workspace_member_permissions for update to authenticated
using (private.can_administer_member_permissions(workspace_id, user_id))
with check (private.can_administer_member_permissions(workspace_id, user_id));

drop policy if exists "Managers can delete member permissions" on public.workspace_member_permissions;
drop policy if exists "Owners can delete member permissions" on public.workspace_member_permissions;
create policy "Owners can delete member permissions"
on public.workspace_member_permissions for delete to authenticated
using (private.can_administer_member_permissions(workspace_id, user_id));

-- Replace broad module policies with action-aware policies while retaining the
-- existing operational tables, notifications, reminders and storage helpers.
do $$
declare
  module record;
begin
  for module in
    select * from (values
      ('customers', 'Customers', 'customers'),
      ('invoices', 'Accounts', 'accounts'),
      ('bookings', 'Calendar', 'calendar'),
      ('messages', 'Communications', 'communications'),
      ('documents', 'Documents', 'documents'),
      ('bank_transactions', 'Banking', 'banking'),
      ('automations', 'Automation', 'automation')
    ) as modules(table_name, policy_prefix, feature_key)
  loop
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' feature read', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' feature insert', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' feature update', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' feature delete', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' permission read', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' permission insert', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' permission update', module.table_name);
    execute format('drop policy if exists %I on public.%I', module.policy_prefix || ' permission delete', module.table_name);

    execute format(
      'create policy %I on public.%I for select to authenticated using (private.has_workspace_permission(workspace_id, %L, ''view''))',
      module.policy_prefix || ' permission read', module.table_name, module.feature_key
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.has_workspace_permission(workspace_id, %L, ''create''))',
      module.policy_prefix || ' permission insert', module.table_name, module.feature_key
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.has_workspace_permission(workspace_id, %L, ''edit'')) with check (private.has_workspace_permission(workspace_id, %L, ''edit''))',
      module.policy_prefix || ' permission update', module.table_name, module.feature_key, module.feature_key
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.has_workspace_permission(workspace_id, %L, ''delete''))',
      module.policy_prefix || ' permission delete', module.table_name, module.feature_key
    );
  end loop;
end;
$$;
