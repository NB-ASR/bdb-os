begin;

-- Database authorization must reject suspended profiles even when an older Auth
-- session is still valid. Application redirects are not a security boundary.
create or replace function private.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
  );
$$;

revoke all on function private.is_active_profile() from public;
grant execute on function private.is_active_profile() to authenticated;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_profile()
    and exists (
      select 1
      from public.platform_admins admin
      where admin.user_id = (select auth.uid())
        and admin.active
        and coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    );
$$;

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

create or replace function private.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_profile()
    and exists (
      select 1
      from public.workspace_memberships membership
      join public.workspaces workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
        and workspace.status in ('trial', 'active')
    );
$$;

-- Ordinary users may read their own profile through RLS and update only the
-- fields that belong to personal profile management. Account state and
-- password-enforcement controls remain server-owned.
revoke all on table public.profiles from anon;
revoke insert, delete, truncate, references, trigger on table public.profiles from authenticated;
revoke update on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, avatar_path, active_workspace_id)
  on table public.profiles to authenticated;

create or replace function private.enforce_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted service-role operations have no end-user auth.uid(). Browser calls,
  -- including Founder sessions, must use reviewed server routes for these fields.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Profile identity cannot be changed';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'Account status is managed by BDB OS';
  end if;

  if new.must_change_password is distinct from old.must_change_password then
    raise exception 'Password enforcement is managed by BDB OS';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_profile_security_fields() from public;

drop trigger if exists profiles_protect_security_fields on public.profiles;
create trigger profiles_protect_security_fields
before update on public.profiles
for each row execute function private.enforce_profile_security_fields();

-- Business activity is append-only and must be written through trusted server
-- commands. Members retain tenant-scoped read access through the existing RLS
-- policy, but cannot forge, edit or remove history directly from a browser.
alter table public.activity_items
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists command_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists activity_items_workspace_occurred_idx
  on public.activity_items (workspace_id, occurred_at desc);

create index if not exists activity_items_workspace_entity_idx
  on public.activity_items (workspace_id, entity_type, entity_id)
  where entity_type is not null and entity_id is not null;

revoke all on table public.activity_items from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.activity_items from authenticated;
grant select on table public.activity_items to authenticated;

drop policy if exists "Activity feature insert" on public.activity_items;

comment on function private.is_active_profile() is
  'Fail-closed account-state check used by BDB OS database authorization helpers.';
comment on column public.activity_items.command_id is
  'Correlates an immutable activity entry with the trusted server command that produced it.';
comment on table public.activity_items is
  'Append-only business history. Browser clients may read through RLS; trusted server commands write entries.';

commit;
