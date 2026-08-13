begin;

update public.features
set name = 'Accounts',
    description = 'Customer receivables, Supplier payables, immutable Payments, allocations and derived balances.',
    category = 'finance',
    route = '/accounts',
    is_active = true
where key = 'accounts';

alter table public.supplier_documents
  drop constraint if exists supplier_documents_accounts_posting_status_check;

alter table public.supplier_documents
  add constraint supplier_documents_accounts_posting_status_check check (
    accounts_posting_status in ('not_available', 'ready', 'posted', 'reversed')
  );

update public.supplier_documents
set accounts_posting_status = 'ready'
where status = 'approved'
  and accounts_posting_status = 'not_available';

create or replace function private.prepare_supplier_document_accounts_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.accounts_posting_status = 'not_available' then
    new.accounts_posting_status := 'ready';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_documents_prepare_accounts_status on public.supplier_documents;
create trigger supplier_documents_prepare_accounts_status
before update on public.supplier_documents
for each row execute function private.prepare_supplier_document_accounts_status();

create table public.supplier_payables (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_document_id uuid not null,
  supplier_id uuid not null,
  supplier_code_snapshot text not null check (char_length(trim(supplier_code_snapshot)) between 1 and 64),
  supplier_name_snapshot text not null check (char_length(trim(supplier_name_snapshot)) between 2 and 160),
  document_type text not null check (document_type in ('invoice', 'credit_note')),
  document_number_snapshot text not null check (char_length(trim(document_number_snapshot)) between 1 and 120),
  document_date date not null,
  due_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,4) not null check (amount > 0),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  version integer not null default 1 check (version > 0),
  posted_at timestamptz not null default now(),
  posted_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, supplier_document_id)
    references public.supplier_documents(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_id)
    references public.suppliers(workspace_id, id) on delete restrict,
  constraint supplier_payables_reversal_shape check (
    (status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  ),
  constraint supplier_payables_due_shape check (
    (document_type = 'invoice' and due_date is not null and due_date >= document_date)
    or (document_type = 'credit_note' and due_date is null)
  )
);

create unique index supplier_payables_active_document_idx
  on public.supplier_payables(workspace_id, supplier_document_id)
  where status = 'posted';
create index supplier_payables_supplier_due_idx
  on public.supplier_payables(workspace_id, supplier_id, currency, due_date, posted_at desc);
create index supplier_payables_document_idx
  on public.supplier_payables(workspace_id, supplier_document_id, posted_at desc);
create index supplier_payables_posted_by_idx
  on public.supplier_payables(posted_by, posted_at desc);
create index supplier_payables_reversed_by_idx
  on public.supplier_payables(reversed_by, reversed_at desc) where reversed_by is not null;

create table public.supplier_payments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(trim(reference)) between 8 and 64),
  supplier_id uuid not null,
  supplier_code_snapshot text not null check (char_length(trim(supplier_code_snapshot)) between 1 and 64),
  supplier_name_snapshot text not null check (char_length(trim(supplier_name_snapshot)) between 2 and 160),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,4) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'other')),
  external_reference text check (external_reference is null or char_length(external_reference) <= 160),
  notes text check (notes is null or char_length(notes) <= 2000),
  paid_at timestamptz not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  version integer not null default 1 check (version > 0),
  posted_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  foreign key (workspace_id, supplier_id)
    references public.suppliers(workspace_id, id) on delete restrict,
  constraint supplier_payments_reversal_shape check (
    (status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  )
);

create index supplier_payments_supplier_time_idx
  on public.supplier_payments(workspace_id, supplier_id, currency, paid_at desc, id desc);
create index supplier_payments_status_time_idx
  on public.supplier_payments(workspace_id, status, paid_at desc, id desc);
create index supplier_payments_posted_by_idx
  on public.supplier_payments(posted_by, paid_at desc);
create index supplier_payments_reversed_by_idx
  on public.supplier_payments(reversed_by, reversed_at desc) where reversed_by is not null;

create table public.supplier_payment_allocations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_payment_id uuid not null,
  supplier_payable_id uuid not null,
  allocation_type text not null check (allocation_type in ('allocation', 'reversal')),
  amount_delta numeric(14,4) not null check (amount_delta <> 0),
  reversal_of_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, supplier_payment_id)
    references public.supplier_payments(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_payable_id)
    references public.supplier_payables(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id)
    references public.supplier_payment_allocations(workspace_id, id) on delete restrict,
  constraint supplier_payment_allocations_shape check (
    (allocation_type = 'allocation' and amount_delta > 0 and reversal_of_id is null and reason is null)
    or (allocation_type = 'reversal' and amount_delta < 0 and reversal_of_id is not null and reason is not null)
  )
);

create unique index supplier_payment_allocations_one_reversal_idx
  on public.supplier_payment_allocations(workspace_id, reversal_of_id)
  where reversal_of_id is not null;
create index supplier_payment_allocations_payment_idx
  on public.supplier_payment_allocations(workspace_id, supplier_payment_id, occurred_at, id);
create index supplier_payment_allocations_payable_idx
  on public.supplier_payment_allocations(workspace_id, supplier_payable_id, occurred_at, id);
create index supplier_payment_allocations_actor_idx
  on public.supplier_payment_allocations(actor_user_id, occurred_at desc);

create table public.supplier_credit_allocations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credit_payable_id uuid not null,
  invoice_payable_id uuid not null,
  allocation_type text not null check (allocation_type in ('allocation', 'reversal')),
  amount_delta numeric(14,4) not null check (amount_delta <> 0),
  reversal_of_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, credit_payable_id)
    references public.supplier_payables(workspace_id, id) on delete restrict,
  foreign key (workspace_id, invoice_payable_id)
    references public.supplier_payables(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id)
    references public.supplier_credit_allocations(workspace_id, id) on delete restrict,
  constraint supplier_credit_allocations_distinct_check check (credit_payable_id <> invoice_payable_id),
  constraint supplier_credit_allocations_shape check (
    (allocation_type = 'allocation' and amount_delta > 0 and reversal_of_id is null and reason is null)
    or (allocation_type = 'reversal' and amount_delta < 0 and reversal_of_id is not null and reason is not null)
  )
);

create unique index supplier_credit_allocations_one_reversal_idx
  on public.supplier_credit_allocations(workspace_id, reversal_of_id)
  where reversal_of_id is not null;
create index supplier_credit_allocations_credit_idx
  on public.supplier_credit_allocations(workspace_id, credit_payable_id, occurred_at, id);
create index supplier_credit_allocations_invoice_idx
  on public.supplier_credit_allocations(workspace_id, invoice_payable_id, occurred_at, id);
create index supplier_credit_allocations_actor_idx
  on public.supplier_credit_allocations(actor_user_id, occurred_at desc);

create table public.supplier_accounts_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  entity_type text not null check (
    entity_type in ('payable', 'supplier_payment', 'payment_allocation', 'credit_allocation')
  ),
  entity_id uuid not null,
  action text not null check (
    action in (
      'post_supplier_document',
      'reverse_payable',
      'record_supplier_payment',
      'allocate_supplier_payment',
      'reverse_supplier_payment_allocation',
      'reverse_supplier_payment',
      'allocate_supplier_credit',
      'reverse_supplier_credit_allocation'
    )
  ),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index supplier_accounts_command_receipts_entity_idx
  on public.supplier_accounts_command_receipts(workspace_id, entity_type, entity_id, created_at desc);

create or replace function private.enforce_supplier_payable_mutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Posted Supplier payables are immutable';
  end if;
  if old.status = 'posted'
     and new.status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.supplier_document_id = old.supplier_document_id
     and new.supplier_id = old.supplier_id
     and new.supplier_code_snapshot = old.supplier_code_snapshot
     and new.supplier_name_snapshot = old.supplier_name_snapshot
     and new.document_type = old.document_type
     and new.document_number_snapshot = old.document_number_snapshot
     and new.document_date = old.document_date
     and new.due_date is not distinct from old.due_date
     and new.currency = old.currency
     and new.amount = old.amount
     and new.posted_at = old.posted_at
     and new.posted_by = old.posted_by
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and new.version = old.version + 1 then
    return new;
  end if;
  raise exception 'Posted Supplier payables are immutable';
end;
$$;

create trigger supplier_payables_enforce_mutability
before update or delete on public.supplier_payables
for each row execute function private.enforce_supplier_payable_mutability();

create or replace function private.enforce_supplier_payment_mutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Posted Supplier Payments are immutable';
  end if;
  if old.status = 'posted'
     and new.status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.reference = old.reference
     and new.supplier_id = old.supplier_id
     and new.supplier_code_snapshot = old.supplier_code_snapshot
     and new.supplier_name_snapshot = old.supplier_name_snapshot
     and new.currency = old.currency
     and new.amount = old.amount
     and new.payment_method = old.payment_method
     and new.external_reference is not distinct from old.external_reference
     and new.notes is not distinct from old.notes
     and new.paid_at = old.paid_at
     and new.posted_by = old.posted_by
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and new.version = old.version + 1 then
    return new;
  end if;
  raise exception 'Posted Supplier Payments are immutable';
end;
$$;

create trigger supplier_payments_enforce_mutability
before update or delete on public.supplier_payments
for each row execute function private.enforce_supplier_payment_mutability();

create or replace function private.enforce_supplier_allocation_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Supplier settlement allocations are append-only';
end;
$$;

create trigger supplier_payment_allocations_enforce_immutability
before update or delete on public.supplier_payment_allocations
for each row execute function private.enforce_supplier_allocation_immutability();

create trigger supplier_credit_allocations_enforce_immutability
before update or delete on public.supplier_credit_allocations
for each row execute function private.enforce_supplier_allocation_immutability();

revoke all on function private.prepare_supplier_document_accounts_status() from public, anon, authenticated;
revoke all on function private.enforce_supplier_payable_mutability() from public, anon, authenticated;
revoke all on function private.enforce_supplier_payment_mutability() from public, anon, authenticated;
revoke all on function private.enforce_supplier_allocation_immutability() from public, anon, authenticated;

grant execute on function private.prepare_supplier_document_accounts_status() to service_role;
grant execute on function private.enforce_supplier_payable_mutability() to service_role;
grant execute on function private.enforce_supplier_payment_mutability() to service_role;
grant execute on function private.enforce_supplier_allocation_immutability() to service_role;

commit;
