begin;

update public.features
set name = 'Banking',
    description = 'Bank accounts, statement imports, immutable Bank transactions and reconciliation evidence.',
    category = 'finance',
    route = '/banking',
    is_active = true
where key = 'banking';

create table public.bank_accounts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null check (char_length(trim(code)) between 2 and 32),
  display_name text not null check (char_length(trim(display_name)) between 2 and 120),
  institution_name text not null check (char_length(trim(institution_name)) between 2 and 160),
  masked_identifier text check (masked_identifier is null or char_length(trim(masked_identifier)) between 2 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

create index bank_accounts_workspace_status_idx
  on public.bank_accounts(workspace_id, status, display_name);
create index bank_accounts_created_by_idx
  on public.bank_accounts(created_by, created_at desc);
create index bank_accounts_updated_by_idx
  on public.bank_accounts(updated_by, updated_at desc);

create table public.bank_statement_imports (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_account_id uuid not null,
  source_filename text not null check (char_length(trim(source_filename)) between 1 and 255),
  source_file_hash text not null check (source_file_hash ~ '^[0-9a-f]{64}$'),
  period_start date,
  period_end date,
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, bank_account_id, source_file_hash),
  foreign key (workspace_id, bank_account_id)
    references public.bank_accounts(workspace_id, id) on delete restrict,
  constraint bank_statement_import_period_check check (
    period_start is null or period_end is null or period_end >= period_start
  )
);

create index bank_statement_imports_account_time_idx
  on public.bank_statement_imports(workspace_id, bank_account_id, imported_at desc);
create index bank_statement_imports_actor_idx
  on public.bank_statement_imports(imported_by, imported_at desc);

alter table public.bank_transactions
  add column if not exists bank_account_id uuid,
  add column if not exists statement_import_id uuid,
  add column if not exists currency text,
  add column if not exists external_reference text,
  add column if not exists fingerprint text,
  add column if not exists value_date date,
  add column if not exists source_row_number integer,
  add column if not exists imported_by uuid,
  add column if not exists record_status text not null default 'posted',
  add column if not exists version integer not null default 1,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text;

alter table public.bank_transactions
  drop constraint if exists bank_transactions_currency_check,
  add constraint bank_transactions_currency_check check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  drop constraint if exists bank_transactions_external_reference_check,
  add constraint bank_transactions_external_reference_check check (
    external_reference is null or char_length(trim(external_reference)) <= 200
  ),
  drop constraint if exists bank_transactions_fingerprint_check,
  add constraint bank_transactions_fingerprint_check check (
    fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'
  ),
  drop constraint if exists bank_transactions_source_row_number_check,
  add constraint bank_transactions_source_row_number_check check (
    source_row_number is null or source_row_number > 0
  ),
  drop constraint if exists bank_transactions_record_status_check,
  add constraint bank_transactions_record_status_check check (
    record_status in ('posted', 'reversed')
  ),
  drop constraint if exists bank_transactions_version_check,
  add constraint bank_transactions_version_check check (version > 0),
  drop constraint if exists bank_transactions_reversal_shape,
  add constraint bank_transactions_reversal_shape check (
    (record_status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (record_status = 'reversed' and reversed_at is not null and reversed_by is not null
      and reversal_reason is not null and char_length(trim(reversal_reason)) between 5 and 500)
  );

create unique index if not exists bank_transactions_workspace_id_unique_idx
  on public.bank_transactions(workspace_id, id);

create unique index if not exists bank_transactions_fingerprint_unique_idx
  on public.bank_transactions(workspace_id, bank_account_id, fingerprint)
  where bank_account_id is not null and fingerprint is not null;

create index if not exists bank_transactions_account_date_idx
  on public.bank_transactions(workspace_id, bank_account_id, transaction_date desc, id desc);

create index if not exists bank_transactions_import_idx
  on public.bank_transactions(workspace_id, statement_import_id, source_row_number);

alter table public.bank_transactions
  drop constraint if exists bank_transactions_workspace_bank_account_fkey,
  add constraint bank_transactions_workspace_bank_account_fkey
    foreign key (workspace_id, bank_account_id)
    references public.bank_accounts(workspace_id, id) on delete restrict,
  drop constraint if exists bank_transactions_workspace_statement_import_fkey,
  add constraint bank_transactions_workspace_statement_import_fkey
    foreign key (workspace_id, statement_import_id)
    references public.bank_statement_imports(workspace_id, id) on delete restrict,
  drop constraint if exists bank_transactions_imported_by_fkey,
  add constraint bank_transactions_imported_by_fkey
    foreign key (imported_by) references auth.users(id) on delete restrict,
  drop constraint if exists bank_transactions_reversed_by_fkey,
  add constraint bank_transactions_reversed_by_fkey
    foreign key (reversed_by) references auth.users(id) on delete restrict;

create table public.bank_reconciliation_allocations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_transaction_id uuid not null,
  customer_payment_id uuid,
  supplier_payment_id uuid,
  allocation_type text not null check (allocation_type in ('allocation', 'reversal')),
  amount_delta numeric(14,4) not null check (amount_delta <> 0),
  reversal_of_id uuid,
  reason text check (reason is null or char_length(trim(reason)) between 5 and 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, bank_transaction_id)
    references public.bank_transactions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_payment_id)
    references public.payments(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_payment_id)
    references public.supplier_payments(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id)
    references public.bank_reconciliation_allocations(workspace_id, id) on delete restrict,
  constraint bank_reconciliation_target_shape check (
    (customer_payment_id is not null and supplier_payment_id is null)
    or (customer_payment_id is null and supplier_payment_id is not null)
  ),
  constraint bank_reconciliation_allocation_shape check (
    (allocation_type = 'allocation' and amount_delta > 0 and reversal_of_id is null and reason is null)
    or
    (allocation_type = 'reversal' and amount_delta < 0 and reversal_of_id is not null and reason is not null)
  )
);

create unique index bank_reconciliation_one_reversal_idx
  on public.bank_reconciliation_allocations(workspace_id, reversal_of_id)
  where reversal_of_id is not null;
create index bank_reconciliation_transaction_idx
  on public.bank_reconciliation_allocations(workspace_id, bank_transaction_id, occurred_at, id);
create index bank_reconciliation_customer_payment_idx
  on public.bank_reconciliation_allocations(workspace_id, customer_payment_id, occurred_at, id)
  where customer_payment_id is not null;
create index bank_reconciliation_supplier_payment_idx
  on public.bank_reconciliation_allocations(workspace_id, supplier_payment_id, occurred_at, id)
  where supplier_payment_id is not null;
create index bank_reconciliation_actor_idx
  on public.bank_reconciliation_allocations(actor_user_id, occurred_at desc);

create table public.banking_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 128),
  entity_type text not null check (
    entity_type in ('bank_account', 'statement_import', 'bank_transaction', 'reconciliation')
  ),
  entity_id uuid not null,
  action text not null check (
    action in (
      'create_bank_account',
      'update_bank_account',
      'archive_bank_account',
      'import_bank_statement',
      'reconcile_bank_transaction',
      'reverse_bank_reconciliation',
      'reverse_bank_transaction'
    )
  ),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index banking_command_receipts_entity_idx
  on public.banking_command_receipts(workspace_id, entity_type, entity_id, created_at desc);

create or replace function private.enforce_bank_statement_import_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.workspace_id = new.workspace_id
     and old.bank_account_id = new.bank_account_id
     and old.source_filename = new.source_filename
     and old.source_file_hash = new.source_file_hash
     and old.imported_by = new.imported_by
     and old.imported_at = new.imported_at
     and old.period_start is null
     and old.period_end is null
     and old.imported_count = 0
     and old.duplicate_count = 0
     and old.rejected_count = 0
     and old.review_count = 0
     and new.imported_count >= 0
     and new.duplicate_count >= 0
     and new.rejected_count >= 0
     and new.review_count >= 0 then
    return new;
  end if;
  raise exception 'Bank statement imports are immutable';
end;
$$;

create trigger bank_statement_imports_enforce_immutability
before update or delete on public.bank_statement_imports
for each row execute function private.enforce_bank_statement_import_immutability();

create or replace function private.enforce_bank_transaction_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Imported Bank transactions are immutable';
  end if;

  if old.record_status = 'posted'
     and new.record_status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.transaction_date = old.transaction_date
     and new.description = old.description
     and new.amount = old.amount
     and new.transaction_type = old.transaction_type
     and new.status = old.status
     and new.matched_invoice_id is not distinct from old.matched_invoice_id
     and new.bank_account_id is not distinct from old.bank_account_id
     and new.statement_import_id is not distinct from old.statement_import_id
     and new.currency is not distinct from old.currency
     and new.external_reference is not distinct from old.external_reference
     and new.fingerprint is not distinct from old.fingerprint
     and new.value_date is not distinct from old.value_date
     and new.source_row_number is not distinct from old.source_row_number
     and new.imported_by is not distinct from old.imported_by
     and new.created_at = old.created_at
     and new.updated_at = old.updated_at
     and new.version = old.version + 1
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null then
    return new;
  end if;

  raise exception 'Imported Bank transactions are immutable';
end;
$$;

drop trigger if exists bank_transactions_enforce_immutability on public.bank_transactions;
create trigger bank_transactions_enforce_immutability
before update or delete on public.bank_transactions
for each row execute function private.enforce_bank_transaction_immutability();

create or replace function private.enforce_bank_reconciliation_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Bank reconciliation allocations are append-only';
end;
$$;

create trigger bank_reconciliation_allocations_enforce_immutability
before update or delete on public.bank_reconciliation_allocations
for each row execute function private.enforce_bank_reconciliation_immutability();

revoke all on function private.enforce_bank_statement_import_immutability() from public, anon, authenticated;
revoke all on function private.enforce_bank_transaction_immutability() from public, anon, authenticated;
revoke all on function private.enforce_bank_reconciliation_immutability() from public, anon, authenticated;

grant execute on function private.enforce_bank_statement_import_immutability() to service_role;
grant execute on function private.enforce_bank_transaction_immutability() to service_role;
grant execute on function private.enforce_bank_reconciliation_immutability() to service_role;

commit;
