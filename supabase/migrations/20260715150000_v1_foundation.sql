-- BDB OS V1 foundation
-- Founder bootstrap state, invitation-based client access, granular permissions,
-- linked business groups, and server-enforced workspace selection.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists active_workspace_id uuid references public.workspaces(id) on delete set null;

alter table public.workspace_memberships
  add column if not exists access_profile text not null default 'employee'
    check (access_profile in ('owner', 'manager', 'employee', 'custom'));

update public.workspace_memberships
set access_profile = case role::text
  when 'owner' then 'owner'
  when 'admin' then 'owner'
  when 'manager' then 'manager'
  else 'employee'
end
where access_profile = 'employee';

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
    when (select access_profile from membership) = 'manager' then target_action in ('view', 'create', 'edit', 'approve', 'export')
    when (select access_profile from membership) = 'employee' then target_action in ('view', 'create', 'edit')
    else false
  end;
$$;

revoke all on function private.has_workspace_permission(uuid, text, text) from public;
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
security invoker
set search_path = ''
as $$
  with current_profile as (
    select p.active_workspace_id
    from public.profiles p
    where p.id = (select auth.uid())
  ), current_group as (
    select link.group_id
    from public.business_group_workspaces link
    join current_profile profile on profile.active_workspace_id = link.workspace_id
  )
  select workspace.id,
         workspace.name,
         workspace.slug::text,
         link.group_id,
         group_record.name,
         membership.role::text,
         membership.access_profile,
         workspace.id = (select active_workspace_id from current_profile)
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  left join public.business_group_workspaces link on link.workspace_id = workspace.id
  left join public.business_groups group_record on group_record.id = link.group_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and (
      workspace.id = (select active_workspace_id from current_profile)
      or link.group_id in (select group_id from current_group)
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

create policy "Members can view their approved business groups"
on public.business_groups for select to authenticated
using (
  private.is_platform_admin() or exists (
    select 1
    from public.business_group_workspaces link
    join public.workspace_memberships membership on membership.workspace_id = link.workspace_id
    where link.group_id = id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

create policy "Members can view approved group links"
on public.business_group_workspaces for select to authenticated
using (
  private.is_platform_admin() or exists (
    select 1 from public.workspace_memberships membership
    where membership.workspace_id = business_group_workspaces.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

create policy "Managers can view member permissions"
on public.workspace_member_permissions for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'team_members', 'view')
  or user_id = (select auth.uid())
);

create policy "Managers can create member permissions"
on public.workspace_member_permissions for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'team_members', 'edit'));

create policy "Managers can update member permissions"
on public.workspace_member_permissions for update to authenticated
using (private.has_workspace_permission(workspace_id, 'team_members', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'team_members', 'edit'));

create policy "Managers can delete member permissions"
on public.workspace_member_permissions for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'team_members', 'edit'));

-- Replace broad module policies with action-aware policies.
drop policy if exists "Customers feature read" on public.customers;
drop policy if exists "Customers feature insert" on public.customers;
drop policy if exists "Customers feature update" on public.customers;
drop policy if exists "Customers feature delete" on public.customers;
create policy "Customers permission read" on public.customers for select to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'view'));
create policy "Customers permission insert" on public.customers for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'customers', 'create'));
create policy "Customers permission update" on public.customers for update to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'customers', 'edit'));
create policy "Customers permission delete" on public.customers for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'delete'));

drop policy if exists "Accounts feature read" on public.invoices;
drop policy if exists "Accounts feature insert" on public.invoices;
drop policy if exists "Accounts feature update" on public.invoices;
drop policy if exists "Accounts feature delete" on public.invoices;
create policy "Accounts permission read" on public.invoices for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Accounts permission insert" on public.invoices for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'accounts', 'create'));
create policy "Accounts permission update" on public.invoices for update to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'accounts', 'edit'));
create policy "Accounts permission delete" on public.invoices for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'delete'));

drop policy if exists "Calendar feature read" on public.bookings;
drop policy if exists "Calendar feature insert" on public.bookings;
drop policy if exists "Calendar feature update" on public.bookings;
drop policy if exists "Calendar feature delete" on public.bookings;
create policy "Calendar permission read" on public.bookings for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));
create policy "Calendar permission insert" on public.bookings for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'calendar', 'create'));
create policy "Calendar permission update" on public.bookings for update to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'calendar', 'edit'));
create policy "Calendar permission delete" on public.bookings for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'delete'));

drop policy if exists "Communications feature read" on public.messages;
drop policy if exists "Communications feature insert" on public.messages;
drop policy if exists "Communications feature update" on public.messages;
drop policy if exists "Communications feature delete" on public.messages;
create policy "Communications permission read" on public.messages for select to authenticated
using (private.has_workspace_permission(workspace_id, 'communications', 'view'));
create policy "Communications permission insert" on public.messages for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'communications', 'create'));
create policy "Communications permission update" on public.messages for update to authenticated
using (private.has_workspace_permission(workspace_id, 'communications', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'communications', 'edit'));
create policy "Communications permission delete" on public.messages for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'communications', 'delete'));

drop policy if exists "Documents feature read" on public.documents;
drop policy if exists "Documents feature insert" on public.documents;
drop policy if exists "Documents feature update" on public.documents;
drop policy if exists "Documents feature delete" on public.documents;
create policy "Documents permission read" on public.documents for select to authenticated
using (private.has_workspace_permission(workspace_id, 'documents', 'view'));
create policy "Documents permission insert" on public.documents for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'documents', 'create'));
create policy "Documents permission update" on public.documents for update to authenticated
using (private.has_workspace_permission(workspace_id, 'documents', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'documents', 'edit'));
create policy "Documents permission delete" on public.documents for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'documents', 'delete'));

drop policy if exists "Banking feature read" on public.bank_transactions;
drop policy if exists "Banking feature insert" on public.bank_transactions;
drop policy if exists "Banking feature update" on public.bank_transactions;
drop policy if exists "Banking feature delete" on public.bank_transactions;
create policy "Banking permission read" on public.bank_transactions for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));
create policy "Banking permission insert" on public.bank_transactions for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'banking', 'create'));
create policy "Banking permission update" on public.bank_transactions for update to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'banking', 'edit'));
create policy "Banking permission delete" on public.bank_transactions for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'delete'));

drop policy if exists "Automation feature read" on public.automations;
drop policy if exists "Automation feature insert" on public.automations;
drop policy if exists "Automation feature update" on public.automations;
drop policy if exists "Automation feature delete" on public.automations;
create policy "Automation permission read" on public.automations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'automation', 'view'));
create policy "Automation permission insert" on public.automations for insert to authenticated
with check (private.has_workspace_permission(workspace_id, 'automation', 'create'));
create policy "Automation permission update" on public.automations for update to authenticated
using (private.has_workspace_permission(workspace_id, 'automation', 'edit'))
with check (private.has_workspace_permission(workspace_id, 'automation', 'edit'));
create policy "Automation permission delete" on public.automations for delete to authenticated
using (private.has_workspace_permission(workspace_id, 'automation', 'delete'));

-- Owners always retain full access and cannot be accidentally orphaned by a
-- custom permission profile. Client applications still enforce final-owner
-- protections before membership mutations.
