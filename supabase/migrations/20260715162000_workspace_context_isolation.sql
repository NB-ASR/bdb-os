-- Enforce the active business context at the database layer.
-- A user may access the selected workspace and deliberately linked companies in
-- the same Business Group, but unrelated memberships cannot be queried directly.

create or replace function private.is_workspace_context_allowed(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with profile as (
    select p.active_workspace_id
    from public.profiles p
    where p.id = (select auth.uid())
  ), active_group as (
    select link.group_id
    from public.business_group_workspaces link
    join profile on profile.active_workspace_id = link.workspace_id
  )
  select private.is_platform_admin()
    or (
      exists (
        select 1 from public.workspace_memberships membership
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
      )
      and (
        (select active_workspace_id from profile) is null
        or target_workspace_id = (select active_workspace_id from profile)
        or exists (
          select 1 from public.business_group_workspaces target_link
          where target_link.workspace_id = target_workspace_id
            and target_link.group_id in (select group_id from active_group)
        )
      )
    );
$$;

create or replace function private.can_read_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_workspace_context_allowed(target_workspace_id);
$$;

create or replace function private.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or (
      private.is_workspace_context_allowed(target_workspace_id)
      and private.has_workspace_role(
        target_workspace_id,
        array['owner', 'admin', 'manager', 'staff']::public.membership_role[]
      )
    );
$$;

create or replace function private.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or (
      private.is_workspace_context_allowed(target_workspace_id)
      and private.has_workspace_role(
        target_workspace_id,
        array['owner', 'admin', 'manager']::public.membership_role[]
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
    select m.role::text as role, m.access_profile
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
    when not private.is_workspace_context_allowed(target_workspace_id) then false
    when not exists (select 1 from membership) then false
    when target_feature_key = 'team_members'
      and (select access_profile from membership) = 'owner' then true
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

revoke all on function private.is_workspace_context_allowed(uuid) from public;
grant execute on function private.is_workspace_context_allowed(uuid) to authenticated;
