begin;

alter table public.platform_support_sessions
  drop constraint if exists platform_support_sessions_access_mode_check;

alter table public.platform_support_sessions
  add constraint platform_support_sessions_access_mode_check
  check (access_mode in ('read_only', 'test_write'));

create or replace function private.has_active_support_session_for_actor(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
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
    where support_session.admin_user_id = target_actor_user_id
      and support_session.workspace_id = target_workspace_id
      and support_session.ended_at is null
      and support_session.expires_at > now()
  );
$$;

create or replace function private.has_test_write_support_session(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
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
    where support_session.admin_user_id = target_actor_user_id
      and support_session.workspace_id = target_workspace_id
      and support_session.access_mode = 'test_write'
      and support_session.ended_at is null
      and support_session.expires_at > now()
  );
$$;

create or replace function private.has_test_write_support_session(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_test_write_support_session(target_workspace_id, (select auth.uid()));
$$;

create or replace function private.actor_has_workspace_permission(
  target_workspace_id uuid,
  target_actor_user_id uuid,
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
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = target_feature_key
    limit 1
  )
  select case
    when private.has_test_write_support_session(target_workspace_id, target_actor_user_id) then true
    when private.has_active_support_session_for_actor(target_workspace_id, target_actor_user_id) then false
    when not private.has_feature(target_workspace_id, target_feature_key) then false
    when not exists (select 1 from membership) then false
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
    select member.access_profile
    from public.workspace_memberships member
    where member.workspace_id = target_workspace_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = (select auth.uid())
      and permission.feature_key = target_feature_key
    limit 1
  )
  select case
    when private.has_test_write_support_session(target_workspace_id) then true
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
    when private.has_test_write_support_session(target_workspace_id) then true
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
    when private.has_test_write_support_session(target_workspace_id) then true
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
    when private.has_test_write_support_session(target_workspace_id) then true
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
    when private.has_test_write_support_session(target_workspace_id) then true
    when private.has_active_support_session(target_workspace_id) then false
    when private.is_platform_admin() then true
    else target_user_id <> (select auth.uid())
      and private.is_active_workspace_owner(target_workspace_id)
  end;
$$;

create or replace function private.product_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'products',
    target_action
  );
$$;

create or replace function private.supplier_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'suppliers',
    target_action
  );
$$;

create or replace function private.product_supplier_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
      target_workspace_id,
      target_actor_user_id,
      'products',
      'view'
    )
    and private.actor_has_workspace_permission(
      target_workspace_id,
      target_actor_user_id,
      'suppliers',
      target_action
    );
$$;

create or replace function private.supplier_document_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'purchasing',
    target_action
  );
$$;

create or replace function private.inventory_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'inventory',
    target_action
  );
$$;

create or replace function private.service_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'services',
    target_action
  );
$$;

create or replace function private.sales_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'sales',
    case target_action
      when 'complete' then 'create'
      when 'reverse' then 'approve'
      else target_action
    end
  );
$$;

revoke all on function private.has_active_support_session_for_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_test_write_support_session(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_test_write_support_session(uuid) from public, anon, authenticated;
revoke all on function private.actor_has_workspace_permission(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function private.has_active_support_session_for_actor(uuid, uuid) to service_role;
grant execute on function private.has_test_write_support_session(uuid, uuid) to service_role;
grant execute on function private.actor_has_workspace_permission(uuid, uuid, text, text) to service_role;

comment on column public.platform_support_sessions.access_mode is
  'read_only in normal Founder support; test_write only for guarded integration-preview testing sessions.';

commit;
