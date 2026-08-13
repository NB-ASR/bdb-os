create table if not exists public.workspace_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text not null default '',
  plan_id uuid not null references public.plans(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  is_default boolean not null default false,
  settings_defaults jsonb not null default '{"currency":"GBP","invoicePrefix":"BDB","vatRate":20,"timezone":"Europe/London"}'::jsonb
    check (jsonb_typeof(settings_defaults) = 'object'),
  theme_defaults jsonb not null default '{"preset":"obsidian-gold","mode":"dark","accentColor":"#d3a84b","fontFamily":"manrope","textScale":1,"density":"comfortable","highContrast":false,"reducedMotion":false}'::jsonb
    check (jsonb_typeof(theme_defaults) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_templates_one_default_idx
  on public.workspace_templates (is_default)
  where is_default and is_active;
create index if not exists workspace_templates_plan_idx
  on public.workspace_templates (plan_id);
create index if not exists workspace_templates_active_name_idx
  on public.workspace_templates (is_active, name);

create table if not exists public.workspace_template_features (
  template_id uuid not null references public.workspace_templates(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (template_id, feature_key)
);

create index if not exists workspace_template_features_feature_idx
  on public.workspace_template_features (feature_key);

create table if not exists public.workspace_template_permissions (
  template_id uuid not null references public.workspace_templates(id) on delete cascade,
  access_profile text not null check (access_profile in ('manager', 'employee', 'custom')),
  feature_key text not null references public.features(key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (template_id, access_profile, feature_key)
);

create index if not exists workspace_template_permissions_feature_idx
  on public.workspace_template_permissions (feature_key);

create table if not exists public.workspace_access_profile_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  access_profile text not null check (access_profile in ('manager', 'employee', 'custom')),
  feature_key text not null references public.features(key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  source_template_id uuid references public.workspace_templates(id) on delete set null,
  source_template_version integer check (source_template_version is null or source_template_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, access_profile, feature_key)
);

create index if not exists workspace_access_profile_permissions_feature_idx
  on public.workspace_access_profile_permissions (feature_key);
create index if not exists workspace_access_profile_permissions_template_idx
  on public.workspace_access_profile_permissions (source_template_id);

alter table public.workspaces
  add column if not exists workspace_template_id uuid references public.workspace_templates(id) on delete set null,
  add column if not exists workspace_template_version integer check (workspace_template_version is null or workspace_template_version > 0);

create index if not exists workspaces_workspace_template_idx
  on public.workspaces (workspace_template_id);

alter table public.workspace_templates enable row level security;
alter table public.workspace_template_features enable row level security;
alter table public.workspace_template_permissions enable row level security;
alter table public.workspace_access_profile_permissions enable row level security;

revoke all on table public.workspace_templates from anon, authenticated;
revoke all on table public.workspace_template_features from anon, authenticated;
revoke all on table public.workspace_template_permissions from anon, authenticated;
revoke all on table public.workspace_access_profile_permissions from anon, authenticated;

grant all on table public.workspace_templates to service_role;
grant all on table public.workspace_template_features to service_role;
grant all on table public.workspace_template_permissions to service_role;
grant all on table public.workspace_access_profile_permissions to service_role;

insert into public.workspace_templates (
  code,
  name,
  description,
  plan_id,
  is_default,
  settings_defaults,
  theme_defaults
)
select
  trim(both '-' from regexp_replace(lower(plan.code), '[^a-z0-9]+', '-', 'g')) || '-workspace',
  plan.name || ' workspace',
  'Version 1 workspace template aligned with the ' || plan.name || ' plan.',
  plan.id,
  plan.sort_order = (select min(active_plan.sort_order) from public.plans active_plan where active_plan.is_active),
  '{"currency":"GBP","invoicePrefix":"BDB","vatRate":20,"timezone":"Europe/London"}'::jsonb,
  '{"preset":"obsidian-gold","mode":"dark","accentColor":"#d3a84b","fontFamily":"manrope","textScale":1,"density":"comfortable","highContrast":false,"reducedMotion":false}'::jsonb
from public.plans plan
where plan.is_active
on conflict (code) do nothing;

insert into public.workspace_template_features (template_id, feature_key, enabled)
select template.id, feature.key, coalesce(plan_feature.enabled, false)
from public.workspace_templates template
join public.plans plan on plan.id = template.plan_id
cross join public.features feature
left join public.plan_features plan_feature
  on plan_feature.plan_id = plan.id
 and plan_feature.feature_key = feature.key
where template.code = trim(both '-' from regexp_replace(lower(plan.code), '[^a-z0-9]+', '-', 'g')) || '-workspace'
  and feature.is_active
on conflict (template_id, feature_key) do nothing;

insert into public.workspace_template_permissions (
  template_id,
  access_profile,
  feature_key,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_approve,
  can_export
)
select
  template.id,
  profile.access_profile,
  feature.key,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  false,
  profile.access_profile = 'manager',
  profile.access_profile = 'manager'
from public.workspace_templates template
cross join (values ('manager'), ('employee'), ('custom')) as profile(access_profile)
cross join public.features feature
where feature.is_active
on conflict (template_id, access_profile, feature_key) do nothing;

insert into public.workspace_access_profile_permissions (
  workspace_id,
  access_profile,
  feature_key,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_approve,
  can_export
)
select
  workspace.id,
  profile.access_profile,
  feature.key,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  false,
  profile.access_profile = 'manager',
  profile.access_profile = 'manager'
from public.workspaces workspace
cross join (values ('manager'), ('employee'), ('custom')) as profile(access_profile)
cross join public.features feature
where feature.is_active
on conflict (workspace_id, access_profile, feature_key) do nothing;

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
as $function$
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
  ), profile_permission as (
    select permission.*
    from public.workspace_access_profile_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.access_profile = (select access_profile from membership)
      and permission.feature_key = target_feature_key
    limit 1
  )
  select case
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
    when exists (select 1 from profile_permission) then case target_action
      when 'view' then (select can_view from profile_permission)
      when 'create' then (select can_create from profile_permission)
      when 'edit' then (select can_edit from profile_permission)
      when 'delete' then (select can_delete from profile_permission)
      when 'approve' then (select can_approve from profile_permission)
      when 'export' then (select can_export from profile_permission)
      else false
    end
    when (select access_profile from membership) = 'manager'
      then target_action in ('view', 'create', 'edit', 'approve', 'export')
    when (select access_profile from membership) = 'employee'
      then target_action in ('view', 'create', 'edit')
    else false
  end;
$function$;

comment on table public.workspace_templates is
  'Founder-managed, versioned starting configuration for new workspaces. Existing workspaces receive a snapshot and do not follow later template edits automatically.';
comment on table public.workspace_access_profile_permissions is
  'Workspace-scoped Manager, Employee and Custom permission presets copied from the selected provisioning template.';
comment on column public.workspaces.workspace_template_id is
  'Template used when this workspace was provisioned. Null means legacy or deliberately custom provisioning.';
comment on column public.workspaces.workspace_template_version is
  'Template version copied at provisioning time. Later template edits do not mutate this workspace automatically.';
