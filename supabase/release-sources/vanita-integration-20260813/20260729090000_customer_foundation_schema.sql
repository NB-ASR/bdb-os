begin;

alter table public.customers
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists version integer not null default 1,
  add column if not exists legacy_source text,
  add column if not exists legacy_id text,
  add column if not exists migration_batch_id uuid,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.customers
  drop constraint if exists customers_code_length_check,
  drop constraint if exists customers_email_length_check,
  drop constraint if exists customers_status_check,
  drop constraint if exists customers_version_check,
  drop constraint if exists customers_preferences_object_check,
  drop constraint if exists customers_name_length_check,
  drop constraint if exists customers_company_length_check,
  drop constraint if exists customers_phone_length_check,
  drop constraint if exists customers_address_length_check,
  drop constraint if exists customers_notes_length_check,
  drop constraint if exists customers_legacy_pair_check;

alter table public.customers
  add constraint customers_code_length_check check (char_length(trim(code)) between 1 and 64),
  add constraint customers_email_length_check check (email is null or char_length(trim(email::text)) <= 320),
  add constraint customers_status_check check (status in ('active', 'archived')),
  add constraint customers_version_check check (version > 0),
  add constraint customers_preferences_object_check check (jsonb_typeof(preferences) = 'object'),
  add constraint customers_name_length_check check (char_length(trim(name)) between 1 and 160),
  add constraint customers_company_length_check check (char_length(company) <= 160),
  add constraint customers_phone_length_check check (phone is null or char_length(phone) <= 50),
  add constraint customers_address_length_check check (address is null or char_length(address) <= 1000),
  add constraint customers_notes_length_check check (notes is null or char_length(notes) <= 4000),
  add constraint customers_legacy_pair_check check (
    (legacy_source is null and legacy_id is null)
    or (legacy_source is not null and legacy_id is not null)
  );

create unique index if not exists customers_workspace_code_ci_idx
  on public.customers(workspace_id, lower(trim(code)));

create unique index if not exists customers_workspace_legacy_identity_idx
  on public.customers(workspace_id, legacy_source, legacy_id)
  where legacy_source is not null and legacy_id is not null;

create index if not exists customers_workspace_status_name_idx
  on public.customers(workspace_id, status, name);

create index if not exists customers_workspace_email_lookup_idx
  on public.customers(workspace_id, lower(trim(email::text)))
  where email is not null and trim(email::text) <> '';

create index if not exists customers_workspace_phone_lookup_idx
  on public.customers(workspace_id, regexp_replace(phone, '[^0-9]', '', 'g'))
  where phone is not null and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6;

create table if not exists public.customer_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  customer_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete cascade
);

create index if not exists customer_command_receipts_customer_idx
  on public.customer_command_receipts(workspace_id, customer_id, created_at desc);

create table if not exists public.customer_import_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (char_length(trim(source)) between 1 and 64),
  source_snapshot_id text check (source_snapshot_id is null or char_length(source_snapshot_id) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  status text not null default 'processing' check (status in ('processing', 'completed', 'completed_with_errors')),
  received_count integer not null default 0 check (received_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  linked_count integer not null default 0 check (linked_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  exceptions jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  result jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id)
);

create table if not exists public.customer_import_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,
  legacy_id text not null,
  customer_id uuid not null,
  batch_id uuid not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, source, legacy_id),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, batch_id)
    references public.customer_import_batches(workspace_id, id) on delete cascade
);

create index if not exists customer_import_receipts_customer_idx
  on public.customer_import_receipts(workspace_id, customer_id, created_at desc);

create index if not exists customer_import_batches_workspace_created_idx
  on public.customer_import_batches(workspace_id, created_at desc);

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function private.touch_updated_at();

create or replace function private.customer_actor_can_write(
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
    'customers',
    target_action
  );
$$;

commit;
