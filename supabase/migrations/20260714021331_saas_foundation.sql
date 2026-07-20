-- BDB OS SaaS foundation
-- Multi-tenant workspaces, founder administration, contract-led billing,
-- per-client feature entitlements, appearance settings, and operational data.

create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create type public.workspace_status as enum ('trial', 'active', 'suspended', 'cancelled');
create type public.membership_role as enum ('owner', 'admin', 'manager', 'staff', 'viewer');
create type public.membership_status as enum ('invited', 'active', 'suspended');
create type public.platform_role as enum ('founder', 'support');
create type public.contract_status as enum ('draft', 'sent', 'accepted', 'active', 'completed', 'cancelled');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'paused', 'cancelled');
create type public.invoice_status as enum ('draft', 'sent', 'paid', 'overdue');
create type public.booking_status as enum ('confirmed', 'pending', 'completed');
create type public.message_status as enum ('open', 'replied', 'approval');
create type public.transaction_status as enum ('matched', 'unmatched', 'review');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]+$'),
  name text not null,
  description text not null,
  category text not null,
  route text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]+$'),
  name text not null,
  description text not null,
  pricing_model text not null default 'quote' check (pricing_model = 'quote'),
  term_options smallint[] not null default array[3, 6]::smallint[],
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_term_options_valid check (term_options <@ array[3, 6]::smallint[] and cardinality(term_options) > 0)
);

create table public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug::text ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  name text not null check (char_length(name) between 2 and 120),
  legal_name text,
  status public.workspace_status not null default 'trial',
  plan_id uuid references public.plans(id) on delete set null,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null default 'staff',
  status public.membership_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_memberships_user_idx on public.workspace_memberships(user_id, status);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.platform_role not null default 'support',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_feature_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null,
  reason text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature_key),
  constraint feature_override_dates_valid check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status public.contract_status not null default 'draft',
  minimum_term_months smallint not null check (minimum_term_months in (3, 6)),
  monthly_amount numeric(12,2) check (monthly_amount is null or monthly_amount >= 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  starts_on date,
  minimum_ends_on date,
  signed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_dates_valid check (minimum_ends_on is null or starts_on is null or minimum_ends_on > starts_on)
);

create index contracts_workspace_idx on public.contracts(workspace_id, status);

create table public.subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status public.subscription_status not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_themes (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  preset text not null default 'bdb' check (preset in ('bdb', 'slate', 'ocean', 'forest', 'plum', 'custom')),
  mode text not null default 'dark' check (mode in ('dark', 'light', 'system')),
  accent_color text not null default '#d3a84b' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family text not null default 'manrope' check (font_family in ('manrope', 'dm-sans', 'system', 'serif')),
  text_scale numeric(3,2) not null default 1.00 check (text_scale between 0.90 and 1.20),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable', 'spacious')),
  high_contrast boolean not null default false,
  reduced_motion boolean not null default false,
  client_logo_path text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  owner_name text not null default '',
  email extensions.citext,
  phone text,
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  invoice_prefix text not null default 'BDB' check (invoice_prefix ~ '^[A-Z0-9-]{2,12}$'),
  vat_rate numeric(5,2) not null default 20 check (vat_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role public.membership_role not null default 'staff',
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitation_expiry_valid check (expires_at > created_at)
);

create index invitations_workspace_email_idx on public.invitations(workspace_id, email);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_workspace_created_idx on public.audit_logs(workspace_id, created_at desc);

-- Operational tables. Every client-owned row carries workspace_id so RLS can
-- enforce both tenant membership and the effective feature entitlement.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  company text not null default '',
  email extensions.citext,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  unique (workspace_id, id)
);

create index customers_workspace_name_idx on public.customers(workspace_id, name);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text not null,
  customer_id uuid not null,
  issued_at date not null default current_date,
  due_at date not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status public.invoice_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict
);

create index invoices_workspace_status_idx on public.invoices(workspace_id, status, due_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  title text not null,
  booking_date date not null,
  booking_time time not null,
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  staff_name text not null,
  status public.booking_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict
);

create index bookings_workspace_date_idx on public.bookings(workspace_id, booking_date, booking_time);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('Email', 'WhatsApp', 'Instagram', 'Web')),
  subject text not null,
  preview text not null,
  occurred_at timestamptz not null default now(),
  unread boolean not null default false,
  status public.message_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict
);

create index messages_workspace_time_idx on public.messages(workspace_id, occurred_at desc);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid,
  name text not null,
  document_type text not null,
  size_label text not null,
  storage_path text,
  linked_to text not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete set null
);

create index documents_workspace_uploaded_idx on public.documents(workspace_id, uploaded_at desc);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_date date not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  transaction_type text not null check (transaction_type in ('credit', 'debit')),
  status public.transaction_status not null default 'unmatched',
  matched_invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, matched_invoice_id) references public.invoices(workspace_id, id) on delete set null
);

create index bank_transactions_workspace_date_idx on public.bank_transactions(workspace_id, transaction_date desc);

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null,
  trigger_description text not null,
  enabled boolean not null default false,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail text not null,
  tone text not null default 'neutral' check (tone in ('gold', 'green', 'blue', 'neutral')),
  occurred_at timestamptz not null default now()
);

create index activity_workspace_time_idx on public.activity_items(workspace_id, occurred_at desc);

-- Internal authorization helpers. Authorization is derived only from protected
-- tables and auth.uid()/verified JWT claims, never user-editable metadata.

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = (select auth.uid())
      and admin.active
      and coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
  );
$$;

create function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create function private.has_workspace_role(target_workspace_id uuid, allowed_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

create function private.can_read_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or private.is_workspace_member(target_workspace_id);
$$;

create function private.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or private.has_workspace_role(target_workspace_id, array['owner', 'admin', 'manager', 'staff']::public.membership_role[]);
$$;

create function private.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or private.has_workspace_role(target_workspace_id, array['owner', 'admin', 'manager']::public.membership_role[]);
$$;

create function private.has_feature(target_workspace_id uuid, target_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_platform_admin() then true
    else exists (
      select 1
      from public.workspaces workspace
      where workspace.id = target_workspace_id
        and workspace.status in ('trial', 'active')
        and coalesce(
          (
            select override.enabled
            from public.workspace_feature_overrides override
            where override.workspace_id = workspace.id
              and override.feature_key = target_feature_key
              and (override.starts_at is null or override.starts_at <= now())
              and (override.ends_at is null or override.ends_at > now())
          ),
          (
            select plan_feature.enabled
            from public.plan_features plan_feature
            where plan_feature.plan_id = workspace.plan_id
              and plan_feature.feature_key = target_feature_key
          ),
          false
        )
    )
  end;
$$;

revoke all on function private.is_platform_admin() from public;
revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.has_workspace_role(uuid, public.membership_role[]) from public;
revoke all on function private.can_read_workspace(uuid) from public;
revoke all on function private.can_write_workspace(uuid) from public;
revoke all on function private.can_manage_workspace(uuid) from public;
revoke all on function private.has_feature(uuid, text) from public;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.membership_role[]) to authenticated;
grant execute on function private.can_read_workspace(uuid) to authenticated;
grant execute on function private.can_write_workspace(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;
grant execute on function private.has_feature(uuid, text) to authenticated;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'plans', 'workspaces', 'workspace_memberships',
    'workspace_feature_overrides', 'contracts', 'subscriptions',
    'workspace_themes', 'workspace_settings', 'customers', 'invoices',
    'bookings', 'messages', 'bank_transactions', 'automations'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

-- Internal provisioning RPC. Commercial workspaces are created by BDB after a
-- quote is agreed; ordinary authenticated users cannot self-provision a free
-- tenant and bypass the contract workflow.
create function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  starter_plan_id uuid;
  created_workspace_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.workspace_memberships membership
    where membership.user_id = caller_id and membership.status = 'active'
  ) and not private.is_platform_admin() then
    raise exception 'An active workspace already exists for this account';
  end if;

  if char_length(trim(workspace_name)) < 2
    or lower(workspace_slug) !~ '^[a-z0-9][a-z0-9-]{2,62}$' then
    raise exception 'Invalid workspace name or slug';
  end if;

  select id into starter_plan_id from public.plans where code = 'starter' and is_active limit 1;

  insert into public.workspaces (name, slug, plan_id, status)
  values (trim(workspace_name), lower(workspace_slug), starter_plan_id, 'trial')
  returning id into created_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values (created_workspace_id, caller_id, 'owner', 'active', now());

  insert into public.workspace_themes (workspace_id, updated_by)
  values (created_workspace_id, caller_id);

  insert into public.workspace_settings (workspace_id, owner_name)
  select created_workspace_id, coalesce(profile.full_name, '')
  from public.profiles profile where profile.id = caller_id;

  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id)
  values (created_workspace_id, caller_id, 'workspace.created', 'workspace', created_workspace_id::text);

  return created_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon, authenticated;
grant execute on function public.create_workspace(text, text) to service_role;

create function public.get_effective_features(target_workspace_id uuid)
returns table (feature_key text, enabled boolean, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  select feature.key,
    private.has_feature(target_workspace_id, feature.key),
    case
      when exists (
        select 1 from public.workspace_feature_overrides override
        where override.workspace_id = target_workspace_id
          and override.feature_key = feature.key
          and (override.starts_at is null or override.starts_at <= now())
          and (override.ends_at is null or override.ends_at > now())
      ) then 'override'
      else 'plan'
    end
  from public.features feature
  where feature.is_active
    and private.can_read_workspace(target_workspace_id)
  order by feature.sort_order, feature.key;
$$;

revoke all on function public.get_effective_features(uuid) from public, anon;
grant execute on function public.get_effective_features(uuid) to authenticated;

create function public.get_my_workspace_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', workspace.id,
      'name', workspace.name,
      'slug', workspace.slug,
      'status', workspace.status,
      'planCode', plan.code,
      'planName', plan.name
    ),
    'membership', jsonb_build_object('role', membership.role, 'status', membership.status),
    'theme', to_jsonb(theme),
    'features', coalesce((
      select jsonb_object_agg(effective.feature_key, effective.enabled)
      from public.get_effective_features(workspace.id) effective
    ), '{}'::jsonb),
    'isPlatformAdmin', private.is_platform_admin()
  )
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  left join public.plans plan on plan.id = workspace.plan_id
  left join public.workspace_themes theme on theme.workspace_id = workspace.id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
  order by case membership.role when 'owner' then 0 when 'admin' then 1 else 2 end
  limit 1;
$$;

revoke all on function public.get_my_workspace_context() from public, anon;
grant execute on function public.get_my_workspace_context() to authenticated;

-- Seed the quote-led reference plans and module catalogue. Feature overrides
-- remain available per workspace, so every signed contract can be bespoke.

insert into public.features (key, name, description, category, route, sort_order) values
  ('overview', 'Overview', 'Daily priorities and business health at a glance.', 'core', '/workspace', 10),
  ('accounts', 'Accounts', 'Invoices, payments and financial records.', 'finance', '/accounts', 20),
  ('customers', 'Customers', 'Connected customer and company records.', 'core', '/customers', 30),
  ('calendar', 'Calendar', 'Appointments, staff and availability.', 'operations', '/calendar', 40),
  ('communications', 'Communications', 'A unified inbox with assisted drafts.', 'operations', '/communications', 50),
  ('documents', 'Documents', 'Files linked to customers and work.', 'core', '/documents', 60),
  ('banking', 'Banking', 'Transaction review and reconciliation.', 'finance', '/banking', 70),
  ('reports', 'Reports', 'Performance, cash and operational reporting.', 'insight', '/reports', 80),
  ('automation', 'Automation', 'Rules and assisted workflows with approvals.', 'automation', '/automation-hub', 90),
  ('activity', 'Activity', 'A traceable workspace audit trail.', 'core', '/activity', 100),
  ('appearance', 'Appearance', 'Workspace themes, density and accessibility.', 'personalisation', '/settings?tab=appearance', 110),
  ('mobile_app', 'Mobile experience', 'Installable mobile workspace and notifications.', 'mobile', null, 120),
  ('team_members', 'Team access', 'Invite staff with managed roles.', 'administration', null, 130)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order;

insert into public.plans (code, name, description, term_options, sort_order) values
  ('starter', 'Starter', 'The essential workspace for customer records, appointments and documents.', array[3, 6]::smallint[], 10),
  ('growth', 'Growth', 'Connected operations, finance, reporting and automation for a growing team.', array[3, 6]::smallint[], 20),
  ('pro', 'Pro', 'The complete BDB OS with every module and the broadest room to customise.', array[3, 6]::smallint[], 30)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  term_options = excluded.term_options,
  sort_order = excluded.sort_order;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, feature_key, true
from public.plans plan
cross join lateral (
  select unnest(case plan.code
    when 'starter' then array['overview', 'customers', 'calendar', 'documents', 'activity', 'appearance']
    when 'growth' then array['overview', 'accounts', 'customers', 'calendar', 'communications', 'documents', 'reports', 'automation', 'activity', 'appearance', 'mobile_app']
    else array['overview', 'accounts', 'customers', 'calendar', 'communications', 'documents', 'banking', 'reports', 'automation', 'activity', 'appearance', 'mobile_app', 'team_members']
  end) as feature_key
) entitlement
where plan.code in ('starter', 'growth', 'pro')
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;

-- Explicit grants are required for projects where new tables are not exposed to
-- the Data API automatically. RLS below remains the row-level authorization layer.
grant select on public.features, public.plans, public.plan_features to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.workspaces, public.workspace_memberships, public.workspace_themes, public.workspace_settings to authenticated;
grant select on public.workspace_feature_overrides, public.contracts, public.subscriptions, public.platform_admins to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.customers, public.invoices, public.bookings, public.messages, public.documents, public.bank_transactions, public.automations, public.activity_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Enable RLS on every table in the exposed public schema.
alter table public.profiles enable row level security;
alter table public.features enable row level security;
alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.workspace_feature_overrides enable row level security;
alter table public.contracts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.workspace_themes enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.bookings enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.automations enable row level security;
alter table public.activity_items enable row level security;

create policy "Public can view active features" on public.features for select using (is_active);
create policy "Public can view active plans" on public.plans for select using (is_active);
create policy "Public can view plan entitlements" on public.plan_features for select using (
  exists (select 1 from public.plans plan where plan.id = plan_id and plan.is_active)
);

create policy "Users can view their profile" on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.is_platform_admin());
create policy "Users can update their profile" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Platform admins can create profiles" on public.profiles for insert to authenticated
with check (private.is_platform_admin());

create policy "Members can view workspaces" on public.workspaces for select to authenticated
using (private.can_read_workspace(id));
create policy "Managers can update workspaces" on public.workspaces for update to authenticated
using (private.can_manage_workspace(id)) with check (private.can_manage_workspace(id));
create policy "Platform admins can create workspaces" on public.workspaces for insert to authenticated
with check (private.is_platform_admin());

create policy "Members can view memberships" on public.workspace_memberships for select to authenticated
using (private.can_read_workspace(workspace_id));
create policy "Managers can invite members" on public.workspace_memberships for insert to authenticated
with check (private.can_manage_workspace(workspace_id));
create policy "Managers can update members" on public.workspace_memberships for update to authenticated
using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));

create policy "Platform admins can view admin list" on public.platform_admins for select to authenticated
using (private.is_platform_admin());

create policy "Members can view feature overrides" on public.workspace_feature_overrides for select to authenticated
using (private.can_read_workspace(workspace_id));

create policy "Owners can view contracts" on public.contracts for select to authenticated
using (private.is_platform_admin() or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]));
create policy "Owners can view subscriptions" on public.subscriptions for select to authenticated
using (private.is_platform_admin() or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]));

create policy "Members can view themes" on public.workspace_themes for select to authenticated
using (private.can_read_workspace(workspace_id));
create policy "Managers can update themes" on public.workspace_themes for update to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'appearance'))
with check (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'appearance'));
create policy "Managers can create themes" on public.workspace_themes for insert to authenticated
with check (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'appearance'));

create policy "Members can view settings" on public.workspace_settings for select to authenticated
using (private.can_read_workspace(workspace_id));
create policy "Managers can update settings" on public.workspace_settings for update to authenticated
using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));

create policy "Managers can view invitations" on public.invitations for select to authenticated
using (private.can_manage_workspace(workspace_id));
create policy "Managers can create invitations" on public.invitations for insert to authenticated
with check (invited_by = (select auth.uid()) and private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'team_members'));
create policy "Managers can update invitations" on public.invitations for update to authenticated
using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));
create policy "Managers can delete invitations" on public.invitations for delete to authenticated
using (private.can_manage_workspace(workspace_id));

create policy "Owners can view audit logs" on public.audit_logs for select to authenticated
using (private.is_platform_admin() or (workspace_id is not null and private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[])));
create policy "Members can append audit logs" on public.audit_logs for insert to authenticated
with check (actor_user_id = (select auth.uid()) and workspace_id is not null and private.can_write_workspace(workspace_id));

create policy "Customers feature read" on public.customers for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'customers'));
create policy "Customers feature insert" on public.customers for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'customers'));
create policy "Customers feature update" on public.customers for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'customers'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'customers'));
create policy "Customers feature delete" on public.customers for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'customers'));

create policy "Accounts feature read" on public.invoices for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'accounts'));
create policy "Accounts feature insert" on public.invoices for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'accounts'));
create policy "Accounts feature update" on public.invoices for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'accounts'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'accounts'));
create policy "Accounts feature delete" on public.invoices for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'accounts'));

create policy "Calendar feature read" on public.bookings for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'calendar'));
create policy "Calendar feature insert" on public.bookings for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'calendar'));
create policy "Calendar feature update" on public.bookings for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'calendar'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'calendar'));
create policy "Calendar feature delete" on public.bookings for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'calendar'));

create policy "Communications feature read" on public.messages for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'communications'));
create policy "Communications feature insert" on public.messages for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'communications'));
create policy "Communications feature update" on public.messages for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'communications'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'communications'));
create policy "Communications feature delete" on public.messages for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'communications'));

create policy "Documents feature read" on public.documents for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'documents'));
create policy "Documents feature insert" on public.documents for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'documents'));
create policy "Documents feature update" on public.documents for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'documents'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'documents'));
create policy "Documents feature delete" on public.documents for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'documents'));

create policy "Banking feature read" on public.bank_transactions for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'banking'));
create policy "Banking feature insert" on public.bank_transactions for insert to authenticated
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'banking'));
create policy "Banking feature update" on public.bank_transactions for update to authenticated
using (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'banking'))
with check (private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'banking'));
create policy "Banking feature delete" on public.bank_transactions for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'banking'));

create policy "Automation feature read" on public.automations for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'automation'));
create policy "Automation feature insert" on public.automations for insert to authenticated
with check (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'automation'));
create policy "Automation feature update" on public.automations for update to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'automation'))
with check (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'automation'));
create policy "Automation feature delete" on public.automations for delete to authenticated
using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, 'automation'));

create policy "Activity feature read" on public.activity_items for select to authenticated
using (private.can_read_workspace(workspace_id) and private.has_feature(workspace_id, 'activity'));
create policy "Activity feature insert" on public.activity_items for insert to authenticated
with check (actor_user_id = (select auth.uid()) and private.can_write_workspace(workspace_id) and private.has_feature(workspace_id, 'activity'));

-- Contract, subscription, plan, entitlement and founder mutations are performed
-- only by verified platform admins or server-side webhook/service clients. The
-- browser receives no INSERT/UPDATE grants for those tables by design.
