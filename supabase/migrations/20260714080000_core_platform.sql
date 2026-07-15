create schema if not exists private;
revoke all on schema private from public, anon;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.features (
  key text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'operations',
  route text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  plan_id text not null references public.plans(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  plan_id text references public.plans(id) on delete set null,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'admin', 'manager', 'staff')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_memberships_user_profile_fkey foreign key (user_id)
    references public.profiles(user_id) on delete cascade
);

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  owner_name text not null default 'Owner',
  email text not null default '',
  phone text not null default '',
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  invoice_prefix text not null default 'INV',
  vat_rate numeric(5,2) not null default 20 check (vat_rate between 0 and 100),
  timezone text not null default 'Europe/London',
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_themes (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  preset text not null default 'obsidian-gold' check (preset in ('obsidian-gold', 'ocean', 'forest', 'clay', 'slate', 'custom')),
  mode text not null default 'dark' check (mode in ('dark', 'light', 'system')),
  accent_color text not null default '#d3a84b' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family text not null default 'manrope' check (font_family in ('manrope', 'dm-sans', 'system')),
  text_scale numeric(3,2) not null default 1 check (text_scale between 0.85 and 1.25),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable', 'spacious')),
  high_contrast boolean not null default false,
  reduced_motion boolean not null default false,
  client_logo_path text,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'support' check (role in ('founder', 'support')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_feature_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature_key),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id text references public.plans(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'active', 'completed', 'cancelled')),
  minimum_term_months integer not null check (minimum_term_months in (3, 6)),
  monthly_amount numeric(12,2) not null check (monthly_amount > 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  starts_on date not null,
  minimum_ends_on date not null,
  signed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_ends_on > starts_on)
);

create table if not exists public.subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  plan_id text references public.plans(id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null check (status in ('trialing', 'active', 'past_due', 'paused', 'incomplete', 'cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  issued_at date not null default current_date,
  due_at date not null,
  description text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  title text not null,
  booking_date date not null,
  booking_time time not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  staff_name text not null default '',
  status text not null default 'pending' check (status in ('confirmed', 'pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('Email', 'WhatsApp', 'Instagram', 'Web')),
  subject text not null,
  preview text not null default '',
  occurred_at timestamptz not null default now(),
  unread boolean not null default true,
  status text not null default 'open' check (status in ('open', 'replied', 'approval')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  document_type text not null default 'File',
  size_label text not null default '',
  customer_id uuid references public.customers(id) on delete set null,
  linked_to text not null default '',
  storage_path text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_date date not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  transaction_type text not null check (transaction_type in ('credit', 'debit')),
  status text not null default 'unmatched' check (status in ('matched', 'unmatched', 'review')),
  matched_invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger_description text not null default '',
  enabled boolean not null default false,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action text not null,
  detail text not null default '',
  occurred_at timestamptz not null default now(),
  tone text not null default 'neutral' check (tone in ('gold', 'green', 'blue', 'neutral')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_memberships_user_idx on public.workspace_memberships(user_id, status);
create index if not exists workspace_memberships_workspace_status_idx on public.workspace_memberships(workspace_id, status);
create index if not exists workspaces_plan_idx on public.workspaces(plan_id);
create index if not exists customers_workspace_idx on public.customers(workspace_id);
create index if not exists invoices_workspace_status_idx on public.invoices(workspace_id, status);
create index if not exists invoices_customer_idx on public.invoices(customer_id);
create index if not exists bookings_workspace_date_idx on public.bookings(workspace_id, booking_date, booking_time);
create index if not exists bookings_customer_idx on public.bookings(customer_id);
create index if not exists messages_workspace_occurred_idx on public.messages(workspace_id, occurred_at desc);
create index if not exists messages_customer_idx on public.messages(customer_id);
create index if not exists documents_workspace_idx on public.documents(workspace_id);
create index if not exists documents_customer_idx on public.documents(customer_id);
create index if not exists bank_transactions_workspace_date_idx on public.bank_transactions(workspace_id, transaction_date desc);
create index if not exists bank_transactions_invoice_idx on public.bank_transactions(matched_invoice_id);
create index if not exists automations_workspace_idx on public.automations(workspace_id);
create index if not exists activity_items_workspace_occurred_idx on public.activity_items(workspace_id, occurred_at desc);
create index if not exists audit_logs_workspace_created_idx on public.audit_logs(workspace_id, created_at desc);
create index if not exists contracts_workspace_idx on public.contracts(workspace_id);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.can_read_workspace(target_workspace_id uuid)
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

create or replace function private.can_manage_workspace(target_workspace_id uuid)
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
      and membership.role in ('owner', 'admin', 'manager')
  );
$$;

create or replace function private.can_manage_billing(target_workspace_id uuid)
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
      and membership.role in ('owner', 'admin')
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = (select auth.uid())
      and administrator.active = true
  );
$$;

create or replace function private.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid()) or exists (
    select 1
    from public.workspace_memberships viewer
    join public.workspace_memberships target
      on target.workspace_id = viewer.workspace_id
    where viewer.user_id = (select auth.uid())
      and viewer.status = 'active'
      and target.user_id = target_user_id
  );
$$;

create or replace function private.has_feature(target_workspace_id uuid, target_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.can_read_workspace(target_workspace_id)
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = target_workspace_id
        and workspace.status in ('trial', 'active')
    )
    and coalesce(
      (
        select override.enabled
        from public.workspace_feature_overrides override
        where override.workspace_id = target_workspace_id
          and override.feature_key = target_feature_key
          and override.starts_at <= now()
          and (override.ends_at is null or override.ends_at > now())
        limit 1
      ),
      (
        select entitlement.enabled
        from public.workspaces workspace
        join public.plan_features entitlement on entitlement.plan_id = workspace.plan_id
        where workspace.id = target_workspace_id
          and entitlement.feature_key = target_feature_key
        limit 1
      ),
      false
    );
$$;

create or replace function private.can_access_storage_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where membership.workspace_id::text = split_part(object_name, '/', 1)
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and workspace.status in ('trial', 'active')
  );
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'plans', 'plan_features', 'workspaces', 'workspace_memberships',
    'workspace_settings', 'workspace_themes', 'platform_admins',
    'workspace_feature_overrides', 'contracts', 'subscriptions',
    'stripe_webhook_events', 'customers', 'invoices', 'bookings', 'messages',
    'documents', 'bank_transactions', 'automations'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function private.touch_updated_at()', table_name, table_name);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_themes enable row level security;
alter table public.platform_admins enable row level security;
alter table public.workspace_feature_overrides enable row level security;
alter table public.contracts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.bookings enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.automations enable row level security;
alter table public.activity_items enable row level security;
alter table public.audit_logs enable row level security;

create policy "Authenticated users read plans" on public.plans for select to authenticated using (true);
create policy "Authenticated users read features" on public.features for select to authenticated using (true);
create policy "Authenticated users read plan features" on public.plan_features for select to authenticated using (true);
create policy "Users read shared profiles" on public.profiles for select to authenticated using (private.can_view_profile(user_id));
create policy "Users update their profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Members read their workspaces" on public.workspaces for select to authenticated
  using (private.can_read_workspace(id) or private.is_platform_admin());
create policy "Managers update their workspace" on public.workspaces for update to authenticated
  using (private.can_manage_workspace(id)) with check (private.can_manage_workspace(id));
create policy "Members read workspace memberships" on public.workspace_memberships for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Managers update workspace memberships" on public.workspace_memberships for update to authenticated
  using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));
create policy "Members read workspace settings" on public.workspace_settings for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Managers create workspace settings" on public.workspace_settings for insert to authenticated
  with check (private.can_manage_workspace(workspace_id));
create policy "Managers update workspace settings" on public.workspace_settings for update to authenticated
  using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));
create policy "Members read workspace themes" on public.workspace_themes for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Managers create workspace themes" on public.workspace_themes for insert to authenticated
  with check (private.can_manage_workspace(workspace_id));
create policy "Managers update workspace themes" on public.workspace_themes for update to authenticated
  using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id));
create policy "Administrators read their platform role" on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) and active = true);
create policy "Members read feature overrides" on public.workspace_feature_overrides for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Billing managers read contracts" on public.contracts for select to authenticated
  using (private.can_manage_billing(workspace_id));
create policy "Members read subscriptions" on public.subscriptions for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Members read activity" on public.activity_items for select to authenticated
  using (private.can_read_workspace(workspace_id));
create policy "Members read audit logs" on public.audit_logs for select to authenticated
  using ((workspace_id is not null and private.can_read_workspace(workspace_id)) or private.is_platform_admin());

do $$
declare
  table_name text;
  feature_key text;
begin
  foreach table_name in array array['customers', 'invoices', 'bookings', 'messages', 'documents', 'bank_transactions', 'automations'] loop
    feature_key := case table_name
      when 'invoices' then 'accounts'
      when 'bookings' then 'calendar'
      when 'messages' then 'communications'
      when 'bank_transactions' then 'banking'
      when 'automations' then 'automation'
      else table_name
    end;
    execute format('create policy "Members read %1$s" on public.%1$I for select to authenticated using (private.has_feature(workspace_id, %2$L))', table_name, feature_key);
    execute format('create policy "Members create %1$s" on public.%1$I for insert to authenticated with check (private.has_feature(workspace_id, %2$L))', table_name, feature_key);
    execute format('create policy "Members update %1$s" on public.%1$I for update to authenticated using (private.has_feature(workspace_id, %2$L)) with check (private.has_feature(workspace_id, %2$L))', table_name, feature_key);
    execute format('create policy "Managers delete %1$s" on public.%1$I for delete to authenticated using (private.can_manage_workspace(workspace_id) and private.has_feature(workspace_id, %2$L))', table_name, feature_key);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.plans, public.features, public.plan_features to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, update on public.workspace_memberships to authenticated;
grant select, insert, update on public.workspace_settings, public.workspace_themes to authenticated;
grant select on public.platform_admins, public.workspace_feature_overrides, public.contracts, public.subscriptions, public.activity_items, public.audit_logs to authenticated;
grant select, insert, update, delete on public.customers, public.invoices, public.bookings, public.messages, public.documents, public.bank_transactions, public.automations to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function private.can_read_workspace(uuid) from public, anon;
revoke all on function private.can_manage_workspace(uuid) from public, anon;
revoke all on function private.can_manage_billing(uuid) from public, anon;
revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.can_view_profile(uuid) from public, anon;
revoke all on function private.has_feature(uuid, text) from public, anon;
revoke all on function private.can_access_storage_object(text) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.can_read_workspace(uuid), private.can_manage_workspace(uuid),
  private.can_manage_billing(uuid), private.is_platform_admin(), private.can_view_profile(uuid),
  private.has_feature(uuid, text), private.can_access_storage_object(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('workspace-assets', 'workspace-assets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('workspace-documents', 'workspace-documents', false, 26214400, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Members read workspace files" on storage.objects for select to authenticated
  using (bucket_id in ('workspace-assets', 'workspace-documents') and private.can_access_storage_object(name));
create policy "Members upload workspace files" on storage.objects for insert to authenticated
  with check (bucket_id in ('workspace-assets', 'workspace-documents') and private.can_access_storage_object(name));
create policy "Members update workspace files" on storage.objects for update to authenticated
  using (bucket_id in ('workspace-assets', 'workspace-documents') and private.can_access_storage_object(name))
  with check (bucket_id in ('workspace-assets', 'workspace-documents') and private.can_access_storage_object(name));
create policy "Managers delete workspace files" on storage.objects for delete to authenticated
  using (bucket_id in ('workspace-assets', 'workspace-documents') and private.can_access_storage_object(name));

insert into public.plans (id, code, name, description, sort_order)
values
  ('starter', 'starter', 'Starter', 'A focused core workspace for a small team.', 10),
  ('growth', 'growth', 'Growth', 'Connected operations, reporting and team controls.', 20),
  ('pro', 'pro', 'Pro', 'The complete tailored operating foundation.', 30)
on conflict (id) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.features (key, name, description, category, route, sort_order)
values
  ('overview', 'Overview', 'Daily priorities and connected business signals.', 'operations', '/workspace', 10),
  ('accounts', 'Accounts', 'Invoices, payments and reconciliation.', 'operations', '/accounts', 20),
  ('customers', 'Customers', 'Connected customer records.', 'operations', '/customers', 30),
  ('calendar', 'Calendar', 'Bookings and team availability.', 'operations', '/calendar', 40),
  ('communications', 'Communications', 'Messages and approved replies.', 'operations', '/communications', 50),
  ('documents', 'Documents', 'Private business files and records.', 'operations', '/documents', 60),
  ('banking', 'Banking', 'Transaction matching and cash position.', 'operations', '/banking', 70),
  ('reports', 'Reports', 'Performance reporting and insight.', 'insight', '/reports', 80),
  ('automation', 'Automation', 'Approved smart workflows.', 'system', '/automation-hub', 90),
  ('activity', 'Activity', 'Workspace activity and audit history.', 'system', '/activity', 100),
  ('appearance', 'Appearance', 'Branding, typography and accessibility.', 'system', '/settings', 110),
  ('mobile_app', 'Mobile app', 'Installable app and appointment notifications.', 'system', null, 120)
on conflict (key) do update set name = excluded.name, description = excluded.description, category = excluded.category, route = excluded.route, sort_order = excluded.sort_order;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan_id, feature_key, true
from (values
  ('starter', 'overview'), ('starter', 'accounts'), ('starter', 'customers'), ('starter', 'calendar'), ('starter', 'appearance'),
  ('growth', 'overview'), ('growth', 'accounts'), ('growth', 'customers'), ('growth', 'calendar'), ('growth', 'communications'),
  ('growth', 'documents'), ('growth', 'banking'), ('growth', 'reports'), ('growth', 'activity'), ('growth', 'appearance'), ('growth', 'mobile_app'),
  ('pro', 'overview'), ('pro', 'accounts'), ('pro', 'customers'), ('pro', 'calendar'), ('pro', 'communications'),
  ('pro', 'documents'), ('pro', 'banking'), ('pro', 'reports'), ('pro', 'automation'), ('pro', 'activity'), ('pro', 'appearance'), ('pro', 'mobile_app')
) as enabled_features(plan_id, feature_key)
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;

insert into public.workspaces (name, slug, status, plan_id)
values ('BDB Demo Client', 'bdb-demo-client', 'trial', 'growth')
on conflict (slug) do nothing;

insert into public.workspace_settings (workspace_id, owner_name, email, phone, currency, invoice_prefix, vat_rate, timezone)
select id, 'Alex Morgan', 'alex@demo-client.example', '+44 20 7946 0958', 'GBP', 'BDB', 20, 'Europe/London'
from public.workspaces where slug = 'bdb-demo-client'
on conflict (workspace_id) do nothing;

insert into public.workspace_themes (workspace_id, preset, mode, accent_color, font_family, text_scale, density)
select id, 'obsidian-gold', 'dark', '#d3a84b', 'manrope', 1, 'comfortable'
from public.workspaces where slug = 'bdb-demo-client'
on conflict (workspace_id) do nothing;

insert into public.customers (workspace_id, code, name, company, email, phone, address, notes)
select id, 'CL-1048', 'Daniel Webb', 'Webb Property Group', 'daniel@webb-property.example', '+44 7700 900123', '14 King Street, London', 'Mock client record for founder onboarding.'
from public.workspaces where slug = 'bdb-demo-client'
on conflict (workspace_id, code) do nothing;

insert into public.invoices (workspace_id, number, customer_id, issued_at, due_at, description, amount, status)
select workspace.id, 'BDB-1041', customer.id, current_date - 14, current_date - 1, 'Strategy and systems implementation', 1680, 'overdue'
from public.workspaces workspace
join public.customers customer on customer.workspace_id = workspace.id and customer.code = 'CL-1048'
where workspace.slug = 'bdb-demo-client'
on conflict (workspace_id, number) do nothing;

insert into public.bookings (workspace_id, customer_id, title, booking_date, booking_time, duration_minutes, staff_name, status)
select workspace.id, customer.id, 'Discovery follow-up', current_date + 1, '14:30', 60, 'Alex Morgan', 'confirmed'
from public.workspaces workspace
join public.customers customer on customer.workspace_id = workspace.id and customer.code = 'CL-1048'
where workspace.slug = 'bdb-demo-client'
  and not exists (select 1 from public.bookings booking where booking.workspace_id = workspace.id and booking.title = 'Discovery follow-up');

insert into public.messages (workspace_id, customer_id, channel, subject, preview, occurred_at, unread, status)
select workspace.id, customer.id, 'Email', 'Project timeline question', 'Could you confirm the onboarding timeline and next steps?', now() - interval '2 hours', true, 'approval'
from public.workspaces workspace
join public.customers customer on customer.workspace_id = workspace.id and customer.code = 'CL-1048'
where workspace.slug = 'bdb-demo-client'
  and not exists (select 1 from public.messages message where message.workspace_id = workspace.id and message.subject = 'Project timeline question');

insert into public.bank_transactions (workspace_id, transaction_date, description, amount, transaction_type, status)
select id, current_date, 'WEBB PROPERTY GROUP', 1680, 'credit', 'review'
from public.workspaces workspace where slug = 'bdb-demo-client'
  and not exists (select 1 from public.bank_transactions transaction where transaction.workspace_id = workspace.id and transaction.description = 'WEBB PROPERTY GROUP');

insert into public.automations (workspace_id, name, description, trigger_description, enabled)
select id, 'Overdue invoice follow-up', 'Prepare a polite follow-up for approval when an invoice becomes overdue.', 'Invoice becomes overdue', true
from public.workspaces workspace where slug = 'bdb-demo-client'
  and not exists (select 1 from public.automations automation where automation.workspace_id = workspace.id and automation.name = 'Overdue invoice follow-up');

insert into public.activity_items (workspace_id, action, detail, tone)
select id, 'Mock client provisioned', 'Founder control plane is ready for client onboarding.', 'green'
from public.workspaces workspace where slug = 'bdb-demo-client'
  and not exists (select 1 from public.activity_items activity where activity.workspace_id = workspace.id and activity.action = 'Mock client provisioned');

notify pgrst, 'reload schema';
