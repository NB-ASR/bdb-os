-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133442_vanita_release_banking_reconciliation.sql.
-- Sources: 20260731120000_banking_reconciliation_schema.sql through 20260731121500_banking_reference_indexes.sql.
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


begin;

create or replace view public.bank_transaction_reconciliation_balances
with (security_invoker = true)
as
select
  transaction.id,
  transaction.workspace_id,
  transaction.bank_account_id,
  account.code as bank_account_code,
  account.display_name as bank_account_name,
  account.institution_name,
  account.masked_identifier,
  transaction.statement_import_id,
  transaction.transaction_date,
  transaction.value_date,
  transaction.description,
  transaction.external_reference,
  transaction.amount,
  transaction.transaction_type,
  transaction.currency,
  transaction.fingerprint,
  transaction.source_row_number,
  transaction.record_status,
  transaction.reversed_at,
  transaction.reversal_reason,
  transaction.status as legacy_status,
  transaction.matched_invoice_id as legacy_matched_invoice_id,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as reconciled_amount,
  greatest(round(transaction.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as unreconciled_amount,
  case
    when transaction.record_status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < transaction.amount then 'partially_matched'
    else 'matched'
  end as reconciliation_status,
  transaction.created_at
from public.bank_transactions transaction
left join public.bank_accounts account
  on account.workspace_id = transaction.workspace_id
 and account.id = transaction.bank_account_id
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = transaction.workspace_id
 and allocation.bank_transaction_id = transaction.id
group by
  transaction.id,
  transaction.workspace_id,
  transaction.bank_account_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  transaction.statement_import_id,
  transaction.transaction_date,
  transaction.value_date,
  transaction.description,
  transaction.external_reference,
  transaction.amount,
  transaction.transaction_type,
  transaction.currency,
  transaction.fingerprint,
  transaction.source_row_number,
  transaction.record_status,
  transaction.reversed_at,
  transaction.reversal_reason,
  transaction.status,
  transaction.matched_invoice_id,
  transaction.created_at;

create or replace view public.customer_payment_reconciliation_balances
with (security_invoker = true)
as
select
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.customer_id,
  payment.customer_code_snapshot,
  payment.customer_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.received_at,
  payment.status,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as bank_reconciled_amount,
  greatest(round(payment.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as bank_unreconciled_amount,
  case
    when payment.status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < payment.amount then 'partially_matched'
    else 'matched'
  end as bank_reconciliation_status
from public.payments payment
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = payment.workspace_id
 and allocation.customer_payment_id = payment.id
group by
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.customer_id,
  payment.customer_code_snapshot,
  payment.customer_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.received_at,
  payment.status;

create or replace view public.supplier_payment_reconciliation_balances
with (security_invoker = true)
as
select
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.supplier_id,
  payment.supplier_code_snapshot,
  payment.supplier_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.paid_at,
  payment.status,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as bank_reconciled_amount,
  greatest(round(payment.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as bank_unreconciled_amount,
  case
    when payment.status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < payment.amount then 'partially_matched'
    else 'matched'
  end as bank_reconciliation_status
from public.supplier_payments payment
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = payment.workspace_id
 and allocation.supplier_payment_id = payment.id
group by
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.supplier_id,
  payment.supplier_code_snapshot,
  payment.supplier_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.paid_at,
  payment.status;

create or replace view public.bank_account_reconciliation_summaries
with (security_invoker = true)
as
select
  account.id as bank_account_id,
  account.workspace_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  account.currency,
  account.status,
  round(coalesce(sum(
    case when transaction.record_status = 'posted' and transaction.transaction_type = 'credit'
      then transaction.amount else 0 end
  ), 0), 4) as imported_credit_amount,
  round(coalesce(sum(
    case when transaction.record_status = 'posted' and transaction.transaction_type = 'debit'
      then transaction.amount else 0 end
  ), 0), 4) as imported_debit_amount,
  round(coalesce(sum(
    case
      when transaction.record_status = 'posted' and transaction.transaction_type = 'credit'
        then transaction.amount
      when transaction.record_status = 'posted' and transaction.transaction_type = 'debit'
        then -transaction.amount
      else 0
    end
  ), 0), 4) as imported_net_movement,
  count(transaction.id) filter (
    where transaction.record_status = 'posted'
  )::integer as transaction_count,
  count(transaction.id) filter (
    where transaction.record_status = 'posted'
      and transaction.reconciliation_status <> 'matched'
  )::integer as review_count
from public.bank_accounts account
left join public.bank_transaction_reconciliation_balances transaction
  on transaction.workspace_id = account.workspace_id
 and transaction.bank_account_id = account.id
group by
  account.id,
  account.workspace_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  account.currency,
  account.status;

alter table public.bank_accounts enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_reconciliation_allocations enable row level security;
alter table public.banking_command_receipts enable row level security;

drop policy if exists "Banking permission insert" on public.bank_transactions;
drop policy if exists "Banking permission update" on public.bank_transactions;
drop policy if exists "Banking permission delete" on public.bank_transactions;
drop policy if exists "Banking permission read" on public.bank_transactions;
create policy "Banking transaction read"
on public.bank_transactions for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank accounts read"
on public.bank_accounts for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank statement imports read"
on public.bank_statement_imports for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank reconciliation allocations read"
on public.bank_reconciliation_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

drop policy if exists "Payments permission read" on public.payments;
create policy "Payments Accounts or Banking read"
on public.payments for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'accounts', 'view')
  or private.has_workspace_permission(workspace_id, 'banking', 'view')
);

drop policy if exists "Supplier Payments Accounts read" on public.supplier_payments;
create policy "Supplier Payments Accounts or Banking read"
on public.supplier_payments for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'accounts', 'view')
  or private.has_workspace_permission(workspace_id, 'banking', 'view')
);

revoke all on public.bank_accounts from anon, authenticated;
revoke all on public.bank_statement_imports from anon, authenticated;
revoke all on public.bank_transactions from anon, authenticated;
revoke all on public.bank_reconciliation_allocations from anon, authenticated;
revoke all on public.banking_command_receipts from anon, authenticated;

grant select on public.bank_accounts to authenticated;
grant select on public.bank_statement_imports to authenticated;
grant select on public.bank_transactions to authenticated;
grant select on public.bank_reconciliation_allocations to authenticated;
grant select on public.bank_transaction_reconciliation_balances to authenticated;
grant select on public.customer_payment_reconciliation_balances to authenticated;
grant select on public.supplier_payment_reconciliation_balances to authenticated;
grant select on public.bank_account_reconciliation_summaries to authenticated;

grant all on public.bank_accounts to service_role;
grant all on public.bank_statement_imports to service_role;
grant all on public.bank_transactions to service_role;
grant all on public.bank_reconciliation_allocations to service_role;
grant all on public.banking_command_receipts to service_role;
grant select on public.bank_transaction_reconciliation_balances to service_role;
grant select on public.customer_payment_reconciliation_balances to service_role;
grant select on public.supplier_payment_reconciliation_balances to service_role;
grant select on public.bank_account_reconciliation_summaries to service_role;

create or replace function private.prevent_reconciled_payment_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconciliation_total numeric;
begin
  if old.status = 'posted' and new.status = 'reversed' then
    if tg_table_name = 'payments' then
      select round(coalesce(sum(allocation.amount_delta), 0), 4)
      into reconciliation_total
      from public.bank_reconciliation_allocations allocation
      where allocation.workspace_id = old.workspace_id
        and allocation.customer_payment_id = old.id;
    else
      select round(coalesce(sum(allocation.amount_delta), 0), 4)
      into reconciliation_total
      from public.bank_reconciliation_allocations allocation
      where allocation.workspace_id = old.workspace_id
        and allocation.supplier_payment_id = old.id;
    end if;

    if reconciliation_total <> 0 then
      raise exception 'Reverse Bank reconciliation allocations before reversing the Payment';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_prevent_reconciled_reversal on public.payments;
create trigger payments_prevent_reconciled_reversal
before update on public.payments
for each row execute function private.prevent_reconciled_payment_reversal();

drop trigger if exists supplier_payments_prevent_reconciled_reversal on public.supplier_payments;
create trigger supplier_payments_prevent_reconciled_reversal
before update on public.supplier_payments
for each row execute function private.prevent_reconciled_payment_reversal();

revoke all on function private.prevent_reconciled_payment_reversal() from public, anon, authenticated;
grant execute on function private.prevent_reconciled_payment_reversal() to service_role;

commit;


begin;

create or replace function private.banking_actor_can_write(
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
    'banking',
    target_action
  );
$$;

revoke all on function private.banking_actor_can_write(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.banking_actor_can_write(uuid, uuid, text) to service_role;

create or replace function public.create_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_code text,
  p_display_name text,
  p_institution_name text,
  p_masked_identifier text,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Bank account creation access denied';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Bank account idempotency key is invalid';
  end if;
  if p_code is null or char_length(trim(p_code)) not between 2 and 32 then
    raise exception 'Bank account code is invalid';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 120 then
    raise exception 'Bank account name is invalid';
  end if;
  if p_institution_name is null or char_length(trim(p_institution_name)) not between 2 and 160 then
    raise exception 'Bank institution name is invalid';
  end if;
  if p_masked_identifier is not null
     and char_length(trim(p_masked_identifier)) not between 2 and 80 then
    raise exception 'Bank account identifier is invalid';
  end if;
  if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Bank account currency is invalid';
  end if;
  if exists (select 1 from public.bank_accounts account where account.id = p_bank_account_id) then
    raise exception 'Bank account identity conflict';
  end if;

  insert into public.bank_accounts (
    id, workspace_id, code, display_name, institution_name,
    masked_identifier, currency, created_by, updated_by
  ) values (
    p_bank_account_id,
    p_workspace_id,
    upper(trim(p_code)),
    trim(p_display_name),
    trim(p_institution_name),
    nullif(trim(p_masked_identifier), ''),
    upper(trim(p_currency)),
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into account_record;

  command_result := jsonb_build_object(
    'action', 'create_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'create_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account created',
    account_record.display_name || ' · ' || account_record.currency, 'blue',
    'bank_account', account_record.id::text, p_command_id,
    jsonb_build_object('code', account_record.code, 'institution', account_record.institution_name)
  );

  return command_result;
end;
$$;

create or replace function public.update_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_display_name text,
  p_institution_name text,
  p_masked_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Bank account update access denied';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 120 then
    raise exception 'Bank account name is invalid';
  end if;
  if p_institution_name is null or char_length(trim(p_institution_name)) not between 2 and 160 then
    raise exception 'Bank institution name is invalid';
  end if;
  if p_masked_identifier is not null
     and char_length(trim(p_masked_identifier)) not between 2 and 80 then
    raise exception 'Bank account identifier is invalid';
  end if;

  update public.bank_accounts account
  set display_name = trim(p_display_name),
      institution_name = trim(p_institution_name),
      masked_identifier = nullif(trim(p_masked_identifier), ''),
      updated_by = p_actor_user_id,
      updated_at = now(),
      version = account.version + 1
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.version = p_expected_version
    and account.status = 'active'
  returning * into account_record;

  if account_record.id is null then
    if not exists (
      select 1 from public.bank_accounts account
      where account.workspace_id = p_workspace_id and account.id = p_bank_account_id
    ) then raise exception 'Bank account not found'; end if;
    raise exception 'Bank account changed before this update was applied';
  end if;

  command_result := jsonb_build_object(
    'action', 'update_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'update_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account updated',
    account_record.display_name, 'neutral',
    'bank_account', account_record.id::text, p_command_id,
    jsonb_build_object('version', account_record.version)
  );

  return command_result;
end;
$$;

create or replace function public.archive_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'delete') then
    raise exception 'Bank account archive access denied';
  end if;

  update public.bank_accounts account
  set status = 'archived',
      updated_by = p_actor_user_id,
      updated_at = now(),
      version = account.version + 1
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.version = p_expected_version
    and account.status = 'active'
  returning * into account_record;

  if account_record.id is null then
    if not exists (
      select 1 from public.bank_accounts account
      where account.workspace_id = p_workspace_id and account.id = p_bank_account_id
    ) then raise exception 'Bank account not found'; end if;
    raise exception 'Bank account changed before it could be archived';
  end if;

  command_result := jsonb_build_object(
    'action', 'archive_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'archive_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account archived',
    account_record.display_name, 'gold',
    'bank_account', account_record.id::text, p_command_id, '{}'::jsonb
  );

  return command_result;
end;
$$;

create or replace function public.import_bank_statement(
  p_workspace_id uuid,
  p_statement_import_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_bank_account_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  import_record public.bank_statement_imports;
  row_value jsonb;
  transaction_id uuid;
  transaction_date_value date;
  value_date_value date;
  description_value text;
  amount_value numeric;
  transaction_type_value text;
  currency_value text;
  external_reference_value text;
  fingerprint_value text;
  source_row_number_value integer;
  imported_count_value integer := 0;
  duplicate_count_value integer := 0;
  period_start_value date;
  period_end_value date;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Bank statement import access denied';
  end if;
  if p_source_filename is null or char_length(trim(p_source_filename)) not between 1 and 255 then
    raise exception 'Bank statement filename is invalid';
  end if;
  if p_source_file_hash is null or lower(trim(p_source_file_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'Bank statement file hash is invalid';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Bank statement contains no transactions';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Bank statement exceeds the Version 1 import limit';
  end if;

  select * into account_record
  from public.bank_accounts account
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.status = 'active'
  for update;
  if account_record.id is null then raise exception 'Bank account is unavailable'; end if;

  if exists (
    select 1 from public.bank_statement_imports statement_import
    where statement_import.workspace_id = p_workspace_id
      and statement_import.bank_account_id = p_bank_account_id
      and statement_import.source_file_hash = lower(trim(p_source_file_hash))
  ) then
    raise exception 'This Bank statement file has already been imported';
  end if;
  if exists (
    select 1 from public.bank_statement_imports statement_import
    where statement_import.id = p_statement_import_id
  ) then
    raise exception 'Bank statement import identity conflict';
  end if;

  insert into public.bank_statement_imports (
    id, workspace_id, bank_account_id, source_filename, source_file_hash,
    imported_by
  ) values (
    p_statement_import_id, p_workspace_id, p_bank_account_id,
    trim(p_source_filename), lower(trim(p_source_file_hash)), p_actor_user_id
  )
  returning * into import_record;

  for row_value in select value from jsonb_array_elements(p_rows)
  loop
    begin
      transaction_id := (row_value ->> 'id')::uuid;
      transaction_date_value := (row_value ->> 'transactionDate')::date;
      value_date_value := nullif(row_value ->> 'valueDate', '')::date;
      description_value := trim(row_value ->> 'description');
      amount_value := round((row_value ->> 'amount')::numeric, 4);
      transaction_type_value := trim(row_value ->> 'transactionType');
      currency_value := upper(trim(row_value ->> 'currency'));
      external_reference_value := nullif(trim(row_value ->> 'externalReference'), '');
      fingerprint_value := lower(trim(row_value ->> 'fingerprint'));
      source_row_number_value := (row_value ->> 'sourceRowNumber')::integer;
    exception when others then
      raise exception 'Bank statement row % is invalid', coalesce(row_value ->> 'sourceRowNumber', '?');
    end;

    if description_value is null or char_length(description_value) not between 1 and 500 then
      raise exception 'Bank statement row % has an invalid description', source_row_number_value;
    end if;
    if amount_value is null or amount_value <= 0 then
      raise exception 'Bank statement row % has an invalid amount', source_row_number_value;
    end if;
    if transaction_type_value not in ('credit', 'debit') then
      raise exception 'Bank statement row % has an invalid direction', source_row_number_value;
    end if;
    if currency_value <> account_record.currency then
      raise exception 'Bank statement row % currency does not match the Bank account', source_row_number_value;
    end if;
    if fingerprint_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Bank statement row % has an invalid fingerprint', source_row_number_value;
    end if;
    if source_row_number_value <= 0 then
      raise exception 'Bank statement row number is invalid';
    end if;
    if external_reference_value is not null and char_length(external_reference_value) > 200 then
      raise exception 'Bank statement row % reference is too long', source_row_number_value;
    end if;

    if exists (
      select 1 from public.bank_transactions transaction
      where transaction.workspace_id = p_workspace_id
        and transaction.bank_account_id = p_bank_account_id
        and transaction.fingerprint = fingerprint_value
    ) then
      duplicate_count_value := duplicate_count_value + 1;
      continue;
    end if;

    if exists (select 1 from public.bank_transactions transaction where transaction.id = transaction_id) then
      raise exception 'Bank transaction identity conflict';
    end if;

    insert into public.bank_transactions (
      id,
      workspace_id,
      transaction_date,
      description,
      amount,
      transaction_type,
      status,
      bank_account_id,
      statement_import_id,
      currency,
      external_reference,
      fingerprint,
      value_date,
      source_row_number,
      imported_by,
      record_status
    ) values (
      transaction_id,
      p_workspace_id,
      transaction_date_value,
      description_value,
      amount_value,
      transaction_type_value,
      'unmatched',
      p_bank_account_id,
      p_statement_import_id,
      currency_value,
      external_reference_value,
      fingerprint_value,
      value_date_value,
      source_row_number_value,
      p_actor_user_id,
      'posted'
    );

    imported_count_value := imported_count_value + 1;
    period_start_value := least(coalesce(period_start_value, transaction_date_value), transaction_date_value);
    period_end_value := greatest(coalesce(period_end_value, transaction_date_value), transaction_date_value);
  end loop;

  update public.bank_statement_imports
  set period_start = period_start_value,
      period_end = period_end_value,
      imported_count = imported_count_value,
      duplicate_count = duplicate_count_value,
      rejected_count = 0,
      review_count = imported_count_value
  where workspace_id = p_workspace_id
    and id = p_statement_import_id
  returning * into import_record;

  command_result := jsonb_build_object(
    'action', 'import_bank_statement',
    'statementImport', to_jsonb(import_record),
    'importedCount', imported_count_value,
    'duplicateCount', duplicate_count_value
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'statement_import', import_record.id,
    'import_bank_statement', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank statement imported',
    import_record.source_filename || ' · ' || imported_count_value || ' transaction(s)', 'blue',
    'bank_statement_import', import_record.id::text, p_command_id,
    jsonb_build_object(
      'bank_account_id', p_bank_account_id,
      'imported_count', imported_count_value,
      'duplicate_count', duplicate_count_value
    )
  );

  return command_result;
end;
$$;

create or replace function public.reconcile_bank_transaction(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_bank_transaction_id uuid,
  p_target_type text,
  p_target_payment_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  transaction_record public.bank_transactions;
  customer_payment_record public.payments;
  supplier_payment_record public.supplier_payments;
  transaction_allocated numeric;
  payment_allocated numeric;
  available_transaction numeric;
  available_payment numeric;
  allocation_record public.bank_reconciliation_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Bank reconciliation access denied';
  end if;
  if p_target_type not in ('customer_payment', 'supplier_payment') then
    raise exception 'Bank reconciliation target type is invalid';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bank reconciliation amount must be greater than zero';
  end if;
  if exists (
    select 1 from public.bank_reconciliation_allocations allocation
    where allocation.id = p_allocation_id
  ) then
    raise exception 'Bank reconciliation identity conflict';
  end if;

  select * into transaction_record
  from public.bank_transactions transaction
  where transaction.workspace_id = p_workspace_id
    and transaction.id = p_bank_transaction_id
  for update;
  if transaction_record.id is null then raise exception 'Bank transaction not found'; end if;
  if transaction_record.record_status <> 'posted' then
    raise exception 'Bank transaction is unavailable for reconciliation';
  end if;
  if transaction_record.bank_account_id is null or transaction_record.currency is null then
    raise exception 'Legacy Bank transaction must be reviewed before reconciliation';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into transaction_allocated
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.bank_transaction_id = p_bank_transaction_id;

  available_transaction := greatest(round(transaction_record.amount - transaction_allocated, 4), 0);

  if p_target_type = 'customer_payment' then
    if transaction_record.transaction_type <> 'credit' then
      raise exception 'Money received can only reconcile to a Customer Payment';
    end if;

    select * into customer_payment_record
    from public.payments payment
    where payment.workspace_id = p_workspace_id
      and payment.id = p_target_payment_id
    for update;
    if customer_payment_record.id is null then raise exception 'Customer Payment not found'; end if;
    if customer_payment_record.status <> 'posted' then
      raise exception 'Customer Payment is unavailable for reconciliation';
    end if;
    if customer_payment_record.currency <> transaction_record.currency then
      raise exception 'Bank transaction and Customer Payment currencies must match';
    end if;

    select round(coalesce(sum(allocation.amount_delta), 0), 4)
    into payment_allocated
    from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.customer_payment_id = p_target_payment_id;

    available_payment := greatest(round(customer_payment_record.amount - payment_allocated, 4), 0);
  else
    if transaction_record.transaction_type <> 'debit' then
      raise exception 'Money sent can only reconcile to a Supplier Payment';
    end if;

    select * into supplier_payment_record
    from public.supplier_payments payment
    where payment.workspace_id = p_workspace_id
      and payment.id = p_target_payment_id
    for update;
    if supplier_payment_record.id is null then raise exception 'Supplier Payment not found'; end if;
    if supplier_payment_record.status <> 'posted' then
      raise exception 'Supplier Payment is unavailable for reconciliation';
    end if;
    if supplier_payment_record.currency <> transaction_record.currency then
      raise exception 'Bank transaction and Supplier Payment currencies must match';
    end if;

    select round(coalesce(sum(allocation.amount_delta), 0), 4)
    into payment_allocated
    from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.supplier_payment_id = p_target_payment_id;

    available_payment := greatest(round(supplier_payment_record.amount - payment_allocated, 4), 0);
  end if;

  if round(p_amount, 4) > available_transaction then
    raise exception 'Bank reconciliation exceeds the unmatched Bank transaction amount';
  end if;
  if round(p_amount, 4) > available_payment then
    raise exception 'Bank reconciliation exceeds the unreconciled Payment amount';
  end if;

  insert into public.bank_reconciliation_allocations (
    id,
    workspace_id,
    bank_transaction_id,
    customer_payment_id,
    supplier_payment_id,
    allocation_type,
    amount_delta,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_allocation_id,
    p_workspace_id,
    p_bank_transaction_id,
    case when p_target_type = 'customer_payment' then p_target_payment_id else null end,
    case when p_target_type = 'supplier_payment' then p_target_payment_id else null end,
    'allocation',
    round(p_amount, 4),
    p_actor_user_id,
    p_command_id,
    coalesce(p_occurred_at, now())
  )
  returning * into allocation_record;

  command_result := jsonb_build_object(
    'action', 'reconcile_bank_transaction',
    'allocation', to_jsonb(allocation_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'reconciliation', allocation_record.id,
    'reconcile_bank_transaction', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank transaction reconciled',
    transaction_record.description || ' · ' || round(p_amount, 4), 'green',
    'bank_reconciliation', allocation_record.id::text, p_command_id,
    jsonb_build_object(
      'bank_transaction_id', transaction_record.id,
      'target_type', p_target_type,
      'target_payment_id', p_target_payment_id,
      'amount', allocation_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_bank_reconciliation(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_allocation_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  original_record public.bank_reconciliation_allocations;
  reversal_record public.bank_reconciliation_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Bank reconciliation reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Bank reconciliation reversal reason is invalid';
  end if;

  select * into original_record
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.id = p_allocation_id
  for update;
  if original_record.id is null then raise exception 'Bank reconciliation allocation not found'; end if;
  if original_record.allocation_type <> 'allocation' then
    raise exception 'Only original Bank reconciliation allocations can be reversed';
  end if;
  if exists (
    select 1 from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.reversal_of_id = p_allocation_id
  ) then
    raise exception 'Bank reconciliation allocation has already been reversed';
  end if;

  insert into public.bank_reconciliation_allocations (
    id, workspace_id, bank_transaction_id, customer_payment_id, supplier_payment_id,
    allocation_type, amount_delta, reversal_of_id, reason,
    actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.bank_transaction_id,
    original_record.customer_payment_id, original_record.supplier_payment_id,
    'reversal', -original_record.amount_delta, original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  )
  returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_bank_reconciliation',
    'allocation', to_jsonb(reversal_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'reconciliation', reversal_record.id,
    'reverse_bank_reconciliation', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank reconciliation reversed',
    trim(p_reason), 'gold',
    'bank_reconciliation', reversal_record.id::text, p_command_id,
    jsonb_build_object(
      'reversal_of_id', original_record.id,
      'bank_transaction_id', original_record.bank_transaction_id,
      'amount', reversal_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_bank_transaction(
  p_workspace_id uuid,
  p_bank_transaction_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  transaction_record public.bank_transactions;
  reconciliation_total numeric;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'delete') then
    raise exception 'Bank transaction reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Bank transaction reversal reason is invalid';
  end if;

  select * into transaction_record
  from public.bank_transactions transaction
  where transaction.workspace_id = p_workspace_id
    and transaction.id = p_bank_transaction_id
  for update;
  if transaction_record.id is null then raise exception 'Bank transaction not found'; end if;
  if transaction_record.record_status <> 'posted' then
    raise exception 'Bank transaction has already been reversed';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into reconciliation_total
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.bank_transaction_id = p_bank_transaction_id;
  if reconciliation_total <> 0 then
    raise exception 'Reverse Bank reconciliation allocations before reversing the Bank transaction';
  end if;

  update public.bank_transactions
  set record_status = 'reversed',
      reversed_at = now(),
      reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id
    and id = p_bank_transaction_id
  returning * into transaction_record;

  command_result := jsonb_build_object(
    'action', 'reverse_bank_transaction',
    'bankTransaction', to_jsonb(transaction_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_transaction', transaction_record.id,
    'reverse_bank_transaction', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank transaction reversed',
    trim(p_reason), 'gold',
    'bank_transaction', transaction_record.id::text, p_command_id,
    jsonb_build_object(
      'transaction_type', transaction_record.transaction_type,
      'amount', transaction_record.amount,
      'currency', transaction_record.currency
    )
  );

  return command_result;
end;
$$;

revoke all on function public.create_bank_account(uuid, uuid, text, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_bank_account(uuid, uuid, integer, text, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.archive_bank_account(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.import_bank_statement(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_bank_transaction(uuid, uuid, uuid, text, uuid, numeric, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_bank_reconciliation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_bank_transaction(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_bank_account(uuid, uuid, text, uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.update_bank_account(uuid, uuid, integer, text, uuid, uuid, text, text, text) to service_role;
grant execute on function public.archive_bank_account(uuid, uuid, integer, text, uuid, uuid) to service_role;
grant execute on function public.import_bank_statement(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.reconcile_bank_transaction(uuid, uuid, uuid, text, uuid, numeric, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.reverse_bank_reconciliation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.reverse_bank_transaction(uuid, uuid, text, uuid, uuid, text) to service_role;

commit;


begin;

create index if not exists bank_transactions_imported_by_idx
  on public.bank_transactions(imported_by, created_at desc)
  where imported_by is not null;

create index if not exists bank_transactions_reversed_by_idx
  on public.bank_transactions(reversed_by, reversed_at desc)
  where reversed_by is not null;

commit;
