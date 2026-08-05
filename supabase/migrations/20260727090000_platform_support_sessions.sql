create table public.platform_support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.platform_admins(user_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  access_mode text not null default 'read_only' check (access_mode = 'read_only'),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (expires_at > started_at),
  check (ended_at is null or ended_at >= started_at)
);

create index platform_support_sessions_admin_active_idx
  on public.platform_support_sessions (admin_user_id, expires_at desc)
  where ended_at is null;

create index platform_support_sessions_workspace_idx
  on public.platform_support_sessions (workspace_id, started_at desc);

alter table public.platform_support_sessions enable row level security;

revoke all on public.platform_support_sessions from anon;
grant select on public.platform_support_sessions to authenticated;

create policy "Platform admins can view support sessions"
  on public.platform_support_sessions
  for select
  to authenticated
  using (
    admin_user_id = (select auth.uid())
    or private.is_platform_admin()
  );

create or replace function private.has_active_support_session(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_profile()
    and exists (
      select 1
      from public.platform_support_sessions support_session
      join public.platform_admins platform_admin
        on platform_admin.user_id = support_session.admin_user_id
       and platform_admin.active
      join public.workspaces workspace
        on workspace.id = support_session.workspace_id
       and workspace.status in ('trial', 'active')
      where support_session.admin_user_id = (select auth.uid())
        and support_session.workspace_id = target_workspace_id
        and support_session.ended_at is null
        and support_session.expires_at > now()
    );
$$;

revoke all on function private.has_active_support_session(uuid) from public, anon, authenticated;

create or replace function private.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select support_session.workspace_id
      from public.platform_support_sessions support_session
      join public.platform_admins platform_admin
        on platform_admin.user_id = support_session.admin_user_id
       and platform_admin.active
      join public.workspaces workspace
        on workspace.id = support_session.workspace_id
       and workspace.status in ('trial', 'active')
      join public.profiles profile
        on profile.id = support_session.admin_user_id
       and profile.is_active
      where support_session.admin_user_id = (select auth.uid())
        and support_session.ended_at is null
        and support_session.expires_at > now()
      order by support_session.started_at desc
      limit 1
    ),
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
        and profile.is_active
      limit 1
    ),
    (
      select membership.workspace_id
      from public.workspace_memberships membership
      join public.workspaces workspace on workspace.id = membership.workspace_id
      join public.profiles profile on profile.id = membership.user_id
      where membership.user_id = (select auth.uid())
        and profile.is_active
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
  select private.has_active_support_session(target_workspace_id)
    or private.is_platform_admin()
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
    when private.has_active_support_session(target_workspace_id) then target_action = 'view'
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

create or replace function private.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_active_support_session(target_workspace_id) then false
    when private.is_platform_admin() then true
    else private.is_workspace_context_allowed(target_workspace_id)
      and private.has_workspace_role(
        target_workspace_id,
        array['owner', 'admin', 'manager']::public.membership_role[]
      )
  end;
$$;

create or replace function private.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_active_support_session(target_workspace_id) then false
    when private.is_platform_admin() then true
    else private.is_workspace_context_allowed(target_workspace_id)
      and private.has_workspace_role(
        target_workspace_id,
        array['owner', 'admin', 'manager', 'staff']::public.membership_role[]
      )
  end;
$$;

create or replace function private.is_active_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_active_support_session(target_workspace_id) then false
    when private.is_platform_admin() then true
    else private.is_workspace_context_allowed(target_workspace_id)
      and exists (
        select 1
        from public.workspace_memberships membership
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and membership.access_profile = 'owner'
      )
  end;
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
  select case
    when private.has_active_support_session(target_workspace_id) then false
    when private.is_platform_admin() then true
    else target_user_id <> (select auth.uid())
      and private.is_active_workspace_owner(target_workspace_id)
  end;
$$;

create or replace function public.get_my_support_session()
returns table (
  session_id uuid,
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  reason text,
  access_mode text,
  started_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select support_session.id,
         workspace.id,
         workspace.name,
         workspace.slug::text,
         support_session.reason,
         support_session.access_mode,
         support_session.started_at,
         support_session.expires_at
  from public.platform_support_sessions support_session
  join public.platform_admins platform_admin
    on platform_admin.user_id = support_session.admin_user_id
   and platform_admin.active
  join public.profiles profile
    on profile.id = support_session.admin_user_id
   and profile.is_active
  join public.workspaces workspace
    on workspace.id = support_session.workspace_id
   and workspace.status in ('trial', 'active')
  where support_session.admin_user_id = (select auth.uid())
    and support_session.ended_at is null
    and support_session.expires_at > now()
  order by support_session.started_at desc
  limit 1;
$$;

revoke all on function public.get_my_support_session() from public, anon;
grant execute on function public.get_my_support_session() to authenticated;
