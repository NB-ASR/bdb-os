-- BDB OS V1 access hardening
-- Adds invitation lifecycle metadata, database-level founder safeguards, and
-- ensures workspace owners can always administer their own team.

alter table public.workspace_memberships
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists invitation_last_sent_at timestamptz;

update public.workspace_memberships
set invitation_expires_at = coalesce(invitation_expires_at, created_at + interval '7 days'),
    invitation_last_sent_at = coalesce(invitation_last_sent_at, created_at)
where status = 'invited';

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
    when not exists (select 1 from membership) then false
    -- Team administration is a core ownership responsibility and cannot be
    -- removed from an active Business Owner by a plan configuration mistake.
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

create or replace function private.protect_last_founder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_founders integer;
  removes_founder boolean := false;
begin
  if old.role = 'founder' and old.active then
    if tg_op = 'DELETE' then
      removes_founder := true;
    elsif new.role <> 'founder' or not new.active then
      removes_founder := true;
    end if;
  end if;

  if removes_founder then
    select count(*) into remaining_founders
    from public.platform_admins
    where role = 'founder'
      and active
      and user_id <> old.user_id;

    if remaining_founders < 1 then
      raise exception 'The final active Founder cannot be removed or suspended';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists platform_admins_protect_last_founder on public.platform_admins;
create trigger platform_admins_protect_last_founder
before update or delete on public.platform_admins
for each row execute function private.protect_last_founder();

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
  with selected_workspace as (
    select coalesce(
      (select p.active_workspace_id from public.profiles p where p.id = (select auth.uid())),
      (
        select m.workspace_id
        from public.workspace_memberships m
        where m.user_id = (select auth.uid()) and m.status = 'active'
        order by case m.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
                 m.created_at
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
         workspace.id = (select workspace_id from selected_workspace)
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  left join public.business_group_workspaces link on link.workspace_id = workspace.id
  left join public.business_groups group_record on group_record.id = link.group_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and (
      workspace.id = (select workspace_id from selected_workspace)
      or link.group_id in (select group_id from selected_group)
    )
  order by workspace.name;
$$;

revoke all on function public.get_my_linked_workspaces() from public, anon;
grant execute on function public.get_my_linked_workspaces() to authenticated;
