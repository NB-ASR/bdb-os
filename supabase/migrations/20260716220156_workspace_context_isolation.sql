-- Enforce the active business context at the database layer.
-- A user may access only the selected workspace and deliberately linked companies
-- in the same Business Group, and only where they hold active membership.

create or replace function private.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
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
      limit 1
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
  );
$$;

create or replace function private.is_workspace_context_allowed(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with selected_workspace as (
    select private.current_workspace_id() as workspace_id
  ), selected_group as (
    select link.group_id
    from public.business_group_workspaces link
    join selected_workspace selected on selected.workspace_id = link.workspace_id
  )
  select private.is_platform_admin()
    or (
      (select selected.workspace_id from selected_workspace selected) is not null
      and exists (
        select 1
        from public.workspace_memberships membership
        join public.workspaces workspace on workspace.id = membership.workspace_id
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and workspace.status in ('trial', 'active')
      )
      and (
        target_workspace_id = (select selected.workspace_id from selected_workspace selected)
        or exists (
          select 1
          from public.business_group_workspaces target_link
          where target_link.workspace_id = target_workspace_id
            and target_link.group_id in (select selected_group.group_id from selected_group)
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

create or replace function private.is_active_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or (
      private.is_workspace_context_allowed(target_workspace_id)
      and exists (
        select 1
        from public.workspace_memberships membership
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and membership.access_profile = 'owner'
      )
    );
$$;

create or replace function private.can_administer_workspace_memberships(
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
    when not private.is_workspace_context_allowed(target_workspace_id) then false
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
security invoker
set search_path = ''
as $$
  select workspace.id,
         workspace.name,
         workspace.slug::text,
         link.group_id,
         group_record.name,
         membership.role::text,
         membership.access_profile,
         workspace.id = private.current_workspace_id()
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  left join public.business_group_workspaces link on link.workspace_id = workspace.id
  left join public.business_groups group_record on group_record.id = link.group_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and workspace.status in ('trial', 'active')
    and private.is_workspace_context_allowed(workspace.id)
  order by workspace.name;
$$;

-- A direct profile update must not be usable to jump to an unrelated company.
create or replace function private.enforce_profile_workspace_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_workspace_id uuid;
begin
  if new.active_workspace_id is not distinct from old.active_workspace_id then
    return new;
  end if;

  if actor_id is null or private.is_platform_admin() then
    return new;
  end if;

  if actor_id <> new.id then
    raise exception 'Users may only select a workspace for their own profile';
  end if;

  if new.active_workspace_id is null then
    return new;
  end if;

  select private.current_workspace_id() into selected_workspace_id;

  if not exists (
    select 1
    from public.workspace_memberships membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where membership.workspace_id = new.active_workspace_id
      and membership.user_id = actor_id
      and membership.status = 'active'
      and workspace.status in ('trial', 'active')
  ) then
    raise exception 'The selected workspace is not an active membership';
  end if;

  if selected_workspace_id is null then
    raise exception 'No active workspace is available';
  end if;

  if new.active_workspace_id <> selected_workspace_id
     and not exists (
       select 1
       from public.business_group_workspaces selected_link
       join public.business_group_workspaces target_link
         on target_link.group_id = selected_link.group_id
       where selected_link.workspace_id = selected_workspace_id
         and target_link.workspace_id = new.active_workspace_id
     ) then
    raise exception 'The selected workspace is not linked to the active company';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_workspace_selection on public.profiles;
create trigger profiles_enforce_workspace_selection
before update of active_workspace_id on public.profiles
for each row execute function private.enforce_profile_workspace_selection();

-- Group metadata itself must follow the same selected-company boundary.
drop policy if exists "Members can view their approved business groups" on public.business_groups;
create policy "Members can view their approved business groups"
on public.business_groups for select to authenticated
using (
  private.is_platform_admin() or exists (
    select 1
    from public.business_group_workspaces link
    where link.group_id = business_groups.id
      and private.is_workspace_context_allowed(link.workspace_id)
  )
);

drop policy if exists "Members can view approved group links" on public.business_group_workspaces;
create policy "Members can view approved group links"
on public.business_group_workspaces for select to authenticated
using (private.is_platform_admin() or private.is_workspace_context_allowed(workspace_id));

revoke all on function private.current_workspace_id() from public;
revoke all on function private.is_workspace_context_allowed(uuid) from public;
revoke all on function private.can_read_workspace(uuid) from public;
revoke all on function private.can_write_workspace(uuid) from public;
revoke all on function private.can_manage_workspace(uuid) from public;
revoke all on function private.is_active_workspace_owner(uuid) from public;
revoke all on function private.can_administer_workspace_memberships(uuid, uuid) from public;
revoke all on function private.can_administer_member_permissions(uuid, uuid) from public;
revoke all on function private.has_workspace_permission(uuid, text, text) from public;
revoke all on function private.enforce_profile_workspace_selection() from public;
revoke all on function public.get_my_linked_workspaces() from public, anon;

grant execute on function private.current_workspace_id() to authenticated;
grant execute on function private.is_workspace_context_allowed(uuid) to authenticated;
grant execute on function private.can_read_workspace(uuid) to authenticated;
grant execute on function private.can_write_workspace(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;
grant execute on function private.is_active_workspace_owner(uuid) to authenticated;
grant execute on function private.can_administer_workspace_memberships(uuid, uuid) to authenticated;
grant execute on function private.can_administer_member_permissions(uuid, uuid) to authenticated;
grant execute on function private.has_workspace_permission(uuid, text, text) to authenticated;
grant execute on function public.get_my_linked_workspaces() to authenticated;
