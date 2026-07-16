-- BDB OS V1 access hardening
-- Invitation lifecycle, Founder and Owner continuity, and Owner-only
-- administration of memberships and permission matrices.

alter table public.workspace_memberships
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists invitation_last_sent_at timestamptz;

update public.workspace_memberships
set invitation_expires_at = coalesce(invitation_expires_at, created_at + interval '7 days'),
    invitation_last_sent_at = coalesce(invitation_last_sent_at, created_at)
where status = 'invited';

-- Keep the legacy membership enum compatible while making its relationship to
-- the new access profile explicit and impossible to contradict.
alter table public.workspace_memberships
  drop constraint if exists workspace_memberships_role_profile_coherent;
alter table public.workspace_memberships
  add constraint workspace_memberships_role_profile_coherent
  check (
    (access_profile = 'owner' and role in ('owner', 'admin'))
    or (access_profile = 'manager' and role = 'manager')
    or (access_profile in ('employee', 'custom') and role in ('staff', 'viewer'))
  );

-- Team access can be visible to Managers or explicitly visible to a Custom user,
-- but no non-Owner permission row can grant membership administration.
alter table public.workspace_member_permissions
  drop constraint if exists workspace_member_permissions_team_admin_guard;
alter table public.workspace_member_permissions
  add constraint workspace_member_permissions_team_admin_guard
  check (
    feature_key <> 'team_members'
    or (
      not can_create
      and not can_edit
      and not can_delete
      and not can_approve
      and not can_export
    )
  );

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

revoke all on function private.can_administer_workspace_memberships(uuid, uuid) from public;
grant execute on function private.can_administer_workspace_memberships(uuid, uuid) to authenticated;

-- Replace legacy Manager administration policies. Managers can still perform
-- operational work through can_manage_workspace and action permissions, but
-- membership and permission administration is Owner-only.
drop policy if exists "Managers can invite members" on public.workspace_memberships;
drop policy if exists "Owners can invite members" on public.workspace_memberships;
create policy "Owners can invite members"
on public.workspace_memberships for insert to authenticated
with check (private.can_administer_workspace_memberships(workspace_id, user_id));

drop policy if exists "Managers can update members" on public.workspace_memberships;
drop policy if exists "Owners can update members" on public.workspace_memberships;
create policy "Owners can update members"
on public.workspace_memberships for update to authenticated
using (private.can_administer_workspace_memberships(workspace_id, user_id))
with check (private.can_administer_workspace_memberships(workspace_id, user_id));

drop policy if exists "Managers can delete members" on public.workspace_memberships;
drop policy if exists "Owners can delete members" on public.workspace_memberships;
create policy "Owners can delete members"
on public.workspace_memberships for delete to authenticated
using (private.can_administer_workspace_memberships(workspace_id, user_id));

create or replace function private.enforce_membership_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_workspace_id uuid;
  target_user_id uuid;
begin
  if tg_op = 'DELETE' then
    target_workspace_id := old.workspace_id;
    target_user_id := old.user_id;
  else
    target_workspace_id := new.workspace_id;
    target_user_id := new.user_id;
  end if;
  -- Server-side service-role workflows have no end-user auth.uid() and are
  -- separately authorised by the API. Direct authenticated writes must always
  -- come from another active Owner in the same business.
  if actor_id is null or private.is_platform_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if actor_id = target_user_id then
    raise exception 'Users cannot change their own workspace privileges';
  end if;

  if not private.is_active_workspace_owner(target_workspace_id) then
    raise exception 'Only an active Owner can administer workspace memberships';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.protect_last_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
  removes_active_owner boolean := false;
begin
  if old.access_profile = 'owner' and old.status = 'active' then
    if tg_op = 'DELETE' then
      removes_active_owner := true;
    elsif new.access_profile <> 'owner' or new.status <> 'active' then
      removes_active_owner := true;
    end if;
  end if;

  if removes_active_owner then
    -- Serialize owner-removal decisions for this workspace so two concurrent
    -- requests cannot each believe another Owner will remain.
    perform 1 from public.workspaces where id = old.workspace_id for update;

    select count(*) into remaining_owners
    from public.workspace_memberships membership
    where membership.workspace_id = old.workspace_id
      and membership.user_id <> old.user_id
      and membership.access_profile = 'owner'
      and membership.status = 'active';

    if remaining_owners < 1 then
      raise exception 'The final active Owner cannot be removed, suspended or demoted';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists workspace_memberships_enforce_administrator on public.workspace_memberships;
create trigger workspace_memberships_enforce_administrator
before insert or update or delete on public.workspace_memberships
for each row execute function private.enforce_membership_administrator();

drop trigger if exists workspace_memberships_protect_last_owner on public.workspace_memberships;
create trigger workspace_memberships_protect_last_owner
before update or delete on public.workspace_memberships
for each row execute function private.protect_last_workspace_owner();

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
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bdb-os:last-founder'));

    select count(*) into remaining_founders
    from public.platform_admins admin
    where admin.role = 'founder'
      and admin.active
      and admin.user_id <> old.user_id;

    if remaining_founders < 1 then
      raise exception 'The final active Founder cannot be removed or suspended';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists platform_admins_protect_last_founder on public.platform_admins;
create trigger platform_admins_protect_last_founder
before update or delete on public.platform_admins
for each row execute function private.protect_last_founder();

revoke all on function private.enforce_membership_administrator() from public;
revoke all on function private.protect_last_workspace_owner() from public;
revoke all on function private.protect_last_founder() from public;
