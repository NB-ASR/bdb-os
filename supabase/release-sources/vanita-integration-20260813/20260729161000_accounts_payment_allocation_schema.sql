begin;

create table public.payments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(trim(reference)) between 8 and 64),
  customer_id uuid not null,
  customer_code_snapshot text not null check (char_length(trim(customer_code_snapshot)) between 1 and 64),
  customer_name_snapshot text not null check (char_length(trim(customer_name_snapshot)) between 1 and 160),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,4) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'other')),
  external_reference text check (external_reference is null or char_length(external_reference) <= 160),
  notes text check (notes is null or char_length(notes) <= 2000),
  received_at timestamptz not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  version integer not null default 1 check (version > 0),
  posted_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  constraint payments_reversal_shape check (
    (status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  )
);

create index payments_workspace_customer_time_idx on public.payments(workspace_id, customer_id, received_at desc, id desc);
create index payments_workspace_status_time_idx on public.payments(workspace_id, status, received_at desc, id desc);
create index payments_posted_by_idx on public.payments(posted_by, received_at desc);
create index payments_reversed_by_idx on public.payments(reversed_by, reversed_at desc) where reversed_by is not null;

create table public.payment_allocations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  allocation_type text not null check (allocation_type in ('allocation', 'reversal')),
  amount_delta numeric(14,4) not null check (amount_delta <> 0),
  reversal_of_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, payment_id) references public.payments(workspace_id, id) on delete restrict,
  foreign key (workspace_id, invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id) references public.payment_allocations(workspace_id, id) on delete restrict,
  constraint payment_allocations_shape check (
    (allocation_type = 'allocation' and amount_delta > 0 and reversal_of_id is null and reason is null)
    or (allocation_type = 'reversal' and amount_delta < 0 and reversal_of_id is not null and reason is not null)
  )
);

create unique index payment_allocations_one_reversal_idx on public.payment_allocations(workspace_id, reversal_of_id) where reversal_of_id is not null;
create index payment_allocations_invoice_idx on public.payment_allocations(workspace_id, invoice_id, occurred_at, id);
create index payment_allocations_payment_idx on public.payment_allocations(workspace_id, payment_id, occurred_at, id);
create index payment_allocations_actor_idx on public.payment_allocations(actor_user_id, occurred_at desc);

create table public.accounts_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  entity_type text not null check (entity_type in ('invoice', 'payment', 'allocation')),
  entity_id uuid not null,
  action text not null check (action in (
    'create_manual_invoice', 'create_sale_invoice', 'update_invoice', 'issue_invoice', 'void_invoice',
    'record_payment', 'allocate_payment', 'reverse_allocation', 'reverse_payment'
  )),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);
create index accounts_command_receipts_entity_idx on public.accounts_command_receipts(workspace_id, entity_type, entity_id, created_at desc);

create or replace function private.enforce_payment_mutability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Posted Payments are immutable'; end if;
  if old.status = 'posted'
     and new.status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.reference = old.reference
     and new.customer_id = old.customer_id
     and new.customer_code_snapshot = old.customer_code_snapshot
     and new.customer_name_snapshot = old.customer_name_snapshot
     and new.currency = old.currency
     and new.amount = old.amount
     and new.payment_method = old.payment_method
     and new.external_reference is not distinct from old.external_reference
     and new.notes is not distinct from old.notes
     and new.received_at = old.received_at
     and new.posted_by = old.posted_by
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and new.version = old.version + 1 then return new;
  end if;
  raise exception 'Posted Payments are immutable';
end;
$$;
create trigger payments_enforce_mutability before update or delete on public.payments
for each row execute function private.enforce_payment_mutability();

create or replace function private.enforce_payment_allocation_immutability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Payment allocations are append-only'; end;
$$;
create trigger payment_allocations_enforce_immutability before update or delete on public.payment_allocations
for each row execute function private.enforce_payment_allocation_immutability();

commit;
