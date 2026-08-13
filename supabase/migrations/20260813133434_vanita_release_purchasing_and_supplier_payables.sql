-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133434_vanita_release_purchasing_and_supplier_payables.sql.
-- Sources: 20260731100000_purchasing_supplier_proposal.sql through 20260731113000_supplier_payables_read_policy_hardening.sql.
begin;

create or replace function private.normalise_supplier_identity_name(p_value text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select nullif(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))),
      '[^a-z0-9]+',
      '',
      'g'
    ),
    ''
  );
$$;

create or replace function public.apply_supplier_document_review_with_supplier_proposal(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_header jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  previous_result jsonb;
  adjusted_header jsonb := coalesce(p_header, '{}'::jsonb);
  requested_supplier_id uuid;
  resolved_supplier_id uuid;
  extracted_supplier_name text;
  normalized_supplier_name text;
  matching_supplier_count integer := 0;
  supplier_code_base text;
  supplier_code text;
  supplier_code_suffix integer := 1;
  created_supplier public.suppliers;
begin
  if p_action not in ('save_review', 'approve') then
    raise exception 'Unsupported supplier document action';
  end if;

  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id
    and id = p_document_id
  for update;

  if document_record.id is null then
    raise exception 'Supplier document not found';
  end if;

  requested_supplier_id := nullif(adjusted_header->>'supplierId', '')::uuid;

  if requested_supplier_id = p_document_id
     and not exists (
       select 1
       from public.suppliers supplier
       where supplier.workspace_id = p_workspace_id
         and supplier.id = requested_supplier_id
     ) then
    if p_action = 'save_review' then
      adjusted_header := jsonb_set(adjusted_header, '{supplierId}', '""'::jsonb, true);
    else
      extracted_supplier_name := nullif(trim(document_record.extracted_supplier_text), '');
      normalized_supplier_name := private.normalise_supplier_identity_name(extracted_supplier_name);

      if extracted_supplier_name is null
         or char_length(extracted_supplier_name) not between 2 and 160
         or normalized_supplier_name is null then
        raise exception 'The extracted Supplier name must be confirmed before creating a Supplier';
      end if;

      if not private.supplier_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
        raise exception 'Supplier creation access denied';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_workspace_id::text || ':' || normalized_supplier_name, 0)
      );

      select count(*)
      into matching_supplier_count
      from public.suppliers supplier
      where supplier.workspace_id = p_workspace_id
        and supplier.status = 'active'
        and supplier.supplier_type = 'product'
        and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name;

      if matching_supplier_count > 1 then
        raise exception 'Several Suppliers match the extracted name; choose the correct Supplier explicitly';
      end if;

      if matching_supplier_count = 1 then
        select supplier.id
        into resolved_supplier_id
        from public.suppliers supplier
        where supplier.workspace_id = p_workspace_id
          and supplier.status = 'active'
          and supplier.supplier_type = 'product'
          and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name
        order by supplier.id::text
        limit 1;
      else
        supplier_code_base := upper(regexp_replace(extracted_supplier_name, '[^A-Za-z0-9]+', '', 'g'));
        supplier_code_base := left(coalesce(nullif(supplier_code_base, ''), 'SUPPLIER'), 56);
        supplier_code := supplier_code_base;

        while exists (
          select 1
          from public.suppliers supplier
          where supplier.workspace_id = p_workspace_id
            and supplier.code = supplier_code
        ) loop
          supplier_code := left(supplier_code_base, greatest(1, 56 - char_length(supplier_code_suffix::text) - 1))
            || '-' || supplier_code_suffix::text;
          supplier_code_suffix := supplier_code_suffix + 1;
        end loop;

        insert into public.suppliers (
          id,
          workspace_id,
          code,
          name,
          supplier_type,
          payment_terms_days,
          default_discount,
          document_currency,
          notes,
          created_by,
          updated_by
        ) values (
          gen_random_uuid(),
          p_workspace_id,
          supplier_code,
          extracted_supplier_name,
          'product',
          0,
          0,
          upper(coalesce(nullif(trim(adjusted_header->>'currency'), ''), document_record.currency, 'EUR')),
          'Created from approved supplier document ' || coalesce(
            nullif(trim(adjusted_header->>'documentNumber'), ''),
            p_document_id::text
          ),
          p_actor_user_id,
          p_actor_user_id
        )
        returning * into created_supplier;

        resolved_supplier_id := created_supplier.id;

        insert into public.activity_items (
          workspace_id,
          actor_user_id,
          action,
          detail,
          tone,
          entity_type,
          entity_id,
          command_id,
          metadata
        ) values (
          p_workspace_id,
          p_actor_user_id,
          'Supplier created from supplier document',
          created_supplier.name || ' · ' || created_supplier.code::text,
          'blue',
          'supplier',
          created_supplier.id::text,
          p_command_id,
          jsonb_build_object(
            'supplier_id', created_supplier.id,
            'supplier_document_id', p_document_id,
            'source', 'supplier_document_approval',
            'extracted_name', extracted_supplier_name
          )
        );
      end if;

      adjusted_header := jsonb_set(
        adjusted_header,
        '{supplierId}',
        to_jsonb(resolved_supplier_id::text),
        true
      );
    end if;
  end if;

  return public.apply_supplier_document_review(
    p_workspace_id,
    p_document_id,
    p_action,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_expected_version,
    adjusted_header,
    p_lines
  );
end;
$$;

revoke all on function private.normalise_supplier_identity_name(text) from public, anon, authenticated;
revoke all on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function private.normalise_supplier_identity_name(text) to service_role;
grant execute on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) to service_role;

comment on function private.normalise_supplier_identity_name(text) is
  'Normalises extracted and catalogue Supplier names for conservative exact matching.';
comment on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) is
  'Approves supplier documents with a human-confirmed Supplier proposal. Exact matches are reused; otherwise one Product Supplier is created atomically before the existing review command runs.';

commit;


begin;

create or replace function public.apply_supplier_document_review_with_supplier_proposal(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_header jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  previous_result jsonb;
  adjusted_header jsonb := coalesce(p_header, '{}'::jsonb);
  requested_supplier_id uuid;
  resolved_supplier_id uuid;
  extracted_supplier_name text;
  normalized_supplier_name text;
  matching_supplier_count integer := 0;
  supplier_code_base text;
  supplier_code text;
  supplier_code_suffix integer := 1;
  created_supplier public.suppliers;
begin
  if p_action not in ('save_review', 'approve') then
    raise exception 'Unsupported supplier document action';
  end if;

  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id
    and id = p_document_id
  for update;

  if document_record.id is null then
    raise exception 'Supplier document not found';
  end if;

  requested_supplier_id := nullif(adjusted_header->>'supplierId', '')::uuid;

  if requested_supplier_id = p_document_id
     and not exists (
       select 1
       from public.suppliers supplier
       where supplier.workspace_id = p_workspace_id
         and supplier.id = requested_supplier_id
     ) then
    if p_action = 'save_review' then
      adjusted_header := jsonb_set(adjusted_header, '{supplierId}', '""'::jsonb, true);
    else
      extracted_supplier_name := nullif(trim(document_record.extracted_supplier_text), '');
      normalized_supplier_name := private.normalise_supplier_identity_name(extracted_supplier_name);

      if extracted_supplier_name is null
         or char_length(extracted_supplier_name) not between 2 and 160
         or normalized_supplier_name is null then
        raise exception 'The extracted Supplier name must be confirmed before creating a Supplier';
      end if;

      if not private.supplier_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
        raise exception 'Supplier creation access denied';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_workspace_id::text || ':' || normalized_supplier_name, 0)
      );

      select count(*)
      into matching_supplier_count
      from public.suppliers supplier
      where supplier.workspace_id = p_workspace_id
        and supplier.status = 'active'
        and supplier.supplier_type = 'product'
        and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name;

      if matching_supplier_count > 1 then
        raise exception 'Several Suppliers match the extracted name; choose the correct Supplier explicitly';
      end if;

      if matching_supplier_count = 1 then
        select supplier.id
        into resolved_supplier_id
        from public.suppliers supplier
        where supplier.workspace_id = p_workspace_id
          and supplier.status = 'active'
          and supplier.supplier_type = 'product'
          and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name
        order by supplier.id::text
        limit 1;
      else
        supplier_code_base := upper(regexp_replace(extracted_supplier_name, '[^A-Za-z0-9]+', '', 'g'));
        supplier_code_base := left(coalesce(nullif(supplier_code_base, ''), 'SUPPLIER'), 56);
        supplier_code := supplier_code_base;

        while exists (
          select 1
          from public.suppliers supplier
          where supplier.workspace_id = p_workspace_id
            and supplier.code = supplier_code
        ) loop
          supplier_code := left(supplier_code_base, greatest(1, 56 - char_length(supplier_code_suffix::text) - 1))
            || '-' || supplier_code_suffix::text;
          supplier_code_suffix := supplier_code_suffix + 1;
        end loop;

        insert into public.suppliers (
          id, workspace_id, code, name, supplier_type, payment_terms_days,
          default_discount, document_currency, notes, created_by, updated_by
        ) values (
          gen_random_uuid(), p_workspace_id, supplier_code, extracted_supplier_name,
          'product', 0, 0,
          upper(coalesce(nullif(trim(adjusted_header->>'currency'), ''), document_record.currency, 'EUR')),
          'Created from approved supplier document ' || coalesce(
            nullif(trim(adjusted_header->>'documentNumber'), ''), p_document_id::text
          ),
          p_actor_user_id, p_actor_user_id
        ) returning * into created_supplier;

        resolved_supplier_id := created_supplier.id;

        insert into public.activity_items (
          workspace_id, actor_user_id, action, detail, tone,
          entity_type, entity_id, command_id, metadata
        ) values (
          p_workspace_id, p_actor_user_id,
          'Supplier created from supplier document',
          created_supplier.name || ' · ' || created_supplier.code::text,
          'blue', 'supplier', created_supplier.id::text, p_command_id,
          jsonb_build_object(
            'supplier_id', created_supplier.id,
            'supplier_document_id', p_document_id,
            'source', 'supplier_document_approval',
            'extracted_name', extracted_supplier_name
          )
        );
      end if;

      adjusted_header := jsonb_set(
        adjusted_header, '{supplierId}', to_jsonb(resolved_supplier_id::text), true
      );
    end if;
  end if;

  return public.apply_supplier_document_review(
    p_workspace_id, p_document_id, p_action, p_idempotency_key,
    p_actor_user_id, p_command_id, p_expected_version, adjusted_header, p_lines
  );
end;
$$;

revoke all on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) to service_role;

comment on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) is
  'Approves a human-confirmed extracted Supplier proposal and resolves an exact existing Supplier UUID without unsupported UUID aggregates.';

commit;


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


begin;

create or replace view public.supplier_payable_balances
with (security_invoker = true)
as
with payment_totals as (
  select allocation.workspace_id,
         allocation.supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_payment_amount
  from public.supplier_payment_allocations allocation
  join public.supplier_payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.supplier_payment_id
  where payment.status = 'posted'
  group by allocation.workspace_id, allocation.supplier_payable_id
), invoice_credit_totals as (
  select allocation.workspace_id,
         allocation.invoice_payable_id as supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_credit_amount
  from public.supplier_credit_allocations allocation
  join public.supplier_payables credit
    on credit.workspace_id = allocation.workspace_id
   and credit.id = allocation.credit_payable_id
  where credit.status = 'posted'
  group by allocation.workspace_id, allocation.invoice_payable_id
), credit_used_totals as (
  select allocation.workspace_id,
         allocation.credit_payable_id as supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as used_credit_amount
  from public.supplier_credit_allocations allocation
  join public.supplier_payables invoice
    on invoice.workspace_id = allocation.workspace_id
   and invoice.id = allocation.invoice_payable_id
  where invoice.status = 'posted'
  group by allocation.workspace_id, allocation.credit_payable_id
)
select payable.*,
       case when payable.document_type = 'invoice' and payable.status = 'posted'
         then coalesce(payment.allocated_payment_amount, 0)
         else 0
       end::numeric(14,4) as allocated_payment_amount,
       case when payable.document_type = 'invoice' and payable.status = 'posted'
         then coalesce(credit.allocated_credit_amount, 0)
         else 0
       end::numeric(14,4) as allocated_credit_amount,
       case
         when payable.status <> 'posted' then 0
         when payable.document_type = 'invoice'
           then round(coalesce(payment.allocated_payment_amount, 0) + coalesce(credit.allocated_credit_amount, 0), 4)
         else coalesce(used.used_credit_amount, 0)
       end::numeric(14,4) as allocated_amount,
       case when payable.status = 'posted' and payable.document_type = 'invoice'
         then greatest(round(payable.amount - coalesce(payment.allocated_payment_amount, 0) - coalesce(credit.allocated_credit_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as outstanding_amount,
       case when payable.status = 'posted' and payable.document_type = 'credit_note'
         then greatest(round(payable.amount - coalesce(used.used_credit_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_credit,
       case
         when payable.status = 'reversed' then 'reversed'
         when payable.document_type = 'credit_note' and greatest(round(payable.amount - coalesce(used.used_credit_amount, 0), 4), 0) = 0 then 'credit_used'
         when payable.document_type = 'credit_note' then 'credit_available'
         when greatest(round(payable.amount - coalesce(payment.allocated_payment_amount, 0) - coalesce(credit.allocated_credit_amount, 0), 4), 0) = 0 then 'paid'
         when round(coalesce(payment.allocated_payment_amount, 0) + coalesce(credit.allocated_credit_amount, 0), 4) > 0 then 'partially_paid'
         when payable.due_date < current_date then 'overdue'
         else 'unpaid'
       end as settlement_status
from public.supplier_payables payable
left join payment_totals payment
  on payment.workspace_id = payable.workspace_id
 and payment.supplier_payable_id = payable.id
left join invoice_credit_totals credit
  on credit.workspace_id = payable.workspace_id
 and credit.supplier_payable_id = payable.id
left join credit_used_totals used
  on used.workspace_id = payable.workspace_id
 and used.supplier_payable_id = payable.id;

create or replace view public.supplier_payment_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.supplier_payment_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.supplier_payment_allocations allocation
  group by allocation.workspace_id, allocation.supplier_payment_id
)
select payment.*,
       case when payment.status = 'posted' then coalesce(total.allocated_amount, 0) else 0 end::numeric(14,4) as allocated_amount,
       case when payment.status = 'posted'
         then greatest(round(payment.amount - coalesce(total.allocated_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_amount
from public.supplier_payments payment
left join allocation_totals total
  on total.workspace_id = payment.workspace_id
 and total.supplier_payment_id = payment.id;

create or replace view public.supplier_account_balances
with (security_invoker = true)
as
with party_keys as (
  select payable.workspace_id, payable.supplier_id, payable.currency,
         max(payable.supplier_code_snapshot) as supplier_code,
         max(payable.supplier_name_snapshot) as supplier_name
  from public.supplier_payables payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
  union
  select payment.workspace_id, payment.supplier_id, payment.currency,
         max(payment.supplier_code_snapshot) as supplier_code,
         max(payment.supplier_name_snapshot) as supplier_name
  from public.supplier_payments payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
), payable_totals as (
  select payable.workspace_id,
         payable.supplier_id,
         payable.currency,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.amount else 0 end), 4) as posted_invoice_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_payment_amount else 0 end), 4) as allocated_payment_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_credit_amount else 0 end), 4) as allocated_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.outstanding_amount else 0 end), 4) as outstanding_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.amount else 0 end), 4) as supplier_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.unallocated_credit else 0 end), 4) as unallocated_credit
  from public.supplier_payable_balances payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
), payment_totals as (
  select payment.workspace_id,
         payment.supplier_id,
         payment.currency,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as payments_sent,
         round(sum(payment.unallocated_amount), 4) as unallocated_payment
  from public.supplier_payment_balances payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
)
select party.workspace_id,
       party.supplier_id,
       party.supplier_code,
       party.supplier_name,
       party.currency,
       coalesce(payable.posted_invoice_amount, 0)::numeric(14,4) as posted_invoice_amount,
       coalesce(payment.payments_sent, 0)::numeric(14,4) as payments_sent,
       coalesce(payable.allocated_payment_amount, 0)::numeric(14,4) as allocated_payment_amount,
       coalesce(payable.allocated_credit_amount, 0)::numeric(14,4) as allocated_credit_amount,
       coalesce(payable.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.unallocated_payment, 0)::numeric(14,4) as unallocated_payment,
       coalesce(payable.supplier_credit_amount, 0)::numeric(14,4) as supplier_credit_amount,
       coalesce(payable.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(
         coalesce(payable.outstanding_amount, 0)
         - coalesce(payment.unallocated_payment, 0)
         - coalesce(payable.unallocated_credit, 0),
         4
       )::numeric(14,4) as net_balance,
       case
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) < 0 then 'supplier_credit'
         else 'clear'
       end as balance_status
from party_keys party
left join payable_totals payable
  on payable.workspace_id = party.workspace_id
 and payable.supplier_id = party.supplier_id
 and payable.currency = party.currency
left join payment_totals payment
  on payment.workspace_id = party.workspace_id
 and payment.supplier_id = party.supplier_id
 and payment.currency = party.currency;

alter table public.supplier_payables enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;
alter table public.supplier_credit_allocations enable row level security;
alter table public.supplier_accounts_command_receipts enable row level security;

create policy "Supplier payables Accounts read"
on public.supplier_payables for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier Payments Accounts read"
on public.supplier_payments for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier Payment allocations Accounts read"
on public.supplier_payment_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier credit allocations Accounts read"
on public.supplier_credit_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

revoke all on public.supplier_payables from anon, authenticated;
grant select on public.supplier_payables to authenticated;
revoke all on public.supplier_payments from anon, authenticated;
grant select on public.supplier_payments to authenticated;
revoke all on public.supplier_payment_allocations from anon, authenticated;
grant select on public.supplier_payment_allocations to authenticated;
revoke all on public.supplier_credit_allocations from anon, authenticated;
grant select on public.supplier_credit_allocations to authenticated;
revoke all on public.supplier_accounts_command_receipts from anon, authenticated;

revoke all on public.supplier_payable_balances from anon;
revoke all on public.supplier_payment_balances from anon;
revoke all on public.supplier_account_balances from anon;
grant select on public.supplier_payable_balances to authenticated;
grant select on public.supplier_payment_balances to authenticated;
grant select on public.supplier_account_balances to authenticated;

comment on view public.supplier_payable_balances is
  'Derived Supplier invoice outstanding amounts and unallocated Supplier credit-note balances.';
comment on view public.supplier_payment_balances is
  'Derived allocated and unallocated amounts for immutable outgoing Supplier Payments.';
comment on view public.supplier_account_balances is
  'Derived Supplier balance by currency. Positive net balance is owed to the Supplier; negative is Supplier credit or prepayment.';

commit;


begin;

create or replace function public.post_supplier_document_payable(
  p_workspace_id uuid,
  p_payable_id uuid,
  p_supplier_document_id uuid,
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
  document_record public.supplier_documents;
  supplier_record public.suppliers;
  payable_record public.supplier_payables;
  payable_amount numeric;
  payable_due_date date;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier payable posting access denied';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Supplier payable idempotency key is invalid';
  end if;
  if exists (
    select 1 from public.supplier_payables payable
    where payable.id = p_payable_id
  ) then
    raise exception 'Supplier payable identity conflict';
  end if;

  select * into document_record
  from public.supplier_documents document
  where document.workspace_id = p_workspace_id
    and document.id = p_supplier_document_id
  for update;

  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status <> 'approved' then raise exception 'Only approved Supplier documents can be posted to Accounts Payable'; end if;
  if document_record.supplier_id is null then raise exception 'Approved Supplier document has no Supplier'; end if;
  if document_record.document_type not in ('invoice', 'credit_note') then raise exception 'Only Supplier invoices and credit notes can be posted'; end if;
  if document_record.document_number is null or document_record.document_date is null then
    raise exception 'Supplier document identity is incomplete';
  end if;
  if exists (
    select 1
    from public.supplier_payables payable
    where payable.workspace_id = p_workspace_id
      and payable.supplier_document_id = p_supplier_document_id
      and payable.status = 'posted'
  ) then
    raise exception 'Supplier document already has an active payable posting';
  end if;

  select * into supplier_record
  from public.suppliers supplier
  where supplier.workspace_id = p_workspace_id
    and supplier.id = document_record.supplier_id
    and supplier.status = 'active';
  if supplier_record.id is null then raise exception 'Supplier is unavailable'; end if;

  payable_amount := round(coalesce(document_record.gross_amount, document_record.net_after_discount, 0), 4);
  if payable_amount <= 0 then raise exception 'Supplier document amount must be greater than zero'; end if;
  payable_due_date := case
    when document_record.document_type = 'invoice'
      then greatest(coalesce(document_record.due_date, document_record.document_date), document_record.document_date)
    else null
  end;

  insert into public.supplier_payables (
    id,
    workspace_id,
    supplier_document_id,
    supplier_id,
    supplier_code_snapshot,
    supplier_name_snapshot,
    document_type,
    document_number_snapshot,
    document_date,
    due_date,
    currency,
    amount,
    posted_by
  ) values (
    p_payable_id,
    p_workspace_id,
    p_supplier_document_id,
    supplier_record.id,
    supplier_record.code::text,
    supplier_record.name,
    document_record.document_type,
    document_record.document_number,
    document_record.document_date,
    payable_due_date,
    document_record.currency,
    payable_amount,
    p_actor_user_id
  ) returning * into payable_record;

  update public.supplier_documents
  set accounts_posting_status = 'posted',
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id
    and id = p_supplier_document_id;

  command_result := jsonb_build_object(
    'action', 'post_supplier_document',
    'payable', to_jsonb(payable_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'payable', payable_record.id,
    'post_supplier_document', command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    case when payable_record.document_type = 'invoice'
      then 'Supplier invoice posted to Accounts Payable'
      else 'Supplier credit note posted to Accounts Payable'
    end,
    payable_record.supplier_name_snapshot || ' · ' || payable_record.document_number_snapshot,
    'green',
    'supplier_payable',
    payable_record.id::text,
    p_command_id,
    jsonb_build_object(
      'supplier_id', payable_record.supplier_id,
      'supplier_document_id', payable_record.supplier_document_id,
      'document_type', payable_record.document_type,
      'currency', payable_record.currency,
      'amount', payable_record.amount,
      'banking_side_effect', false,
      'inventory_side_effect', false
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_supplier_payable(
  p_workspace_id uuid,
  p_payable_id uuid,
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
  payable_record public.supplier_payables;
  allocation_total numeric;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier payable reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Supplier payable reversal reason is invalid';
  end if;

  select * into payable_record
  from public.supplier_payables payable
  where payable.workspace_id = p_workspace_id
    and payable.id = p_payable_id
  for update;

  if payable_record.id is null then raise exception 'Supplier payable not found'; end if;
  if payable_record.status <> 'posted' then raise exception 'Supplier payable has already been reversed'; end if;

  if payable_record.document_type = 'invoice' then
    select round(
      coalesce((
        select sum(allocation.amount_delta)
        from public.supplier_payment_allocations allocation
        where allocation.workspace_id = p_workspace_id
          and allocation.supplier_payable_id = p_payable_id
      ), 0)
      + coalesce((
        select sum(allocation.amount_delta)
        from public.supplier_credit_allocations allocation
        where allocation.workspace_id = p_workspace_id
          and allocation.invoice_payable_id = p_payable_id
      ), 0),
      4
    ) into allocation_total;
  else
    select round(coalesce(sum(allocation.amount_delta), 0), 4)
    into allocation_total
    from public.supplier_credit_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.credit_payable_id = p_payable_id;
  end if;

  if allocation_total <> 0 then
    raise exception 'Reverse Supplier allocations before reversing the payable posting';
  end if;

  update public.supplier_payables
  set status = 'reversed',
      reversed_at = now(),
      reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id
    and id = p_payable_id
  returning * into payable_record;

  update public.supplier_documents
  set accounts_posting_status = 'reversed',
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id
    and id = payable_record.supplier_document_id;

  command_result := jsonb_build_object(
    'action', 'reverse_payable',
    'payable', to_jsonb(payable_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'payable', payable_record.id,
    'reverse_payable', command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Supplier payable posting reversed',
    payable_record.supplier_name_snapshot || ' · ' || payable_record.document_number_snapshot,
    'gold',
    'supplier_payable',
    payable_record.id::text,
    p_command_id,
    jsonb_build_object(
      'supplier_document_id', payable_record.supplier_document_id,
      'reason', payable_record.reversal_reason,
      'banking_side_effect', false,
      'inventory_side_effect', false
    )
  );

  return command_result;
end;
$$;

revoke all on function public.post_supplier_document_payable(uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reverse_supplier_payable(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.post_supplier_document_payable(uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.reverse_supplier_payable(uuid, uuid, text, uuid, uuid, text) to service_role;

comment on function public.post_supplier_document_payable(uuid, uuid, uuid, text, uuid, uuid) is
  'Explicitly posts one approved Supplier invoice or credit note into the immutable Accounts Payable ledger. Creates no Inventory or Banking side effects.';
comment on function public.reverse_supplier_payable(uuid, uuid, text, uuid, uuid, text) is
  'Reverses an unallocated Supplier payable posting while preserving the source document and posting history.';

commit;


begin;

create or replace function public.record_supplier_payment(
  p_workspace_id uuid,
  p_supplier_payment_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_supplier_id uuid,
  p_currency text,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_external_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  supplier_record public.suppliers;
  payment_record public.supplier_payments;
  payment_reference text;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Supplier Payment recording access denied';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Supplier Payment idempotency key is invalid';
  end if;
  if exists (select 1 from public.supplier_payments payment where payment.id = p_supplier_payment_id) then
    raise exception 'Supplier Payment identity conflict';
  end if;
  if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Supplier Payment currency is invalid';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Supplier Payment amount must be greater than zero'; end if;
  if p_payment_method not in ('cash', 'card', 'bank_transfer', 'cheque', 'other') then
    raise exception 'Supplier Payment method is invalid';
  end if;
  if p_paid_at is null then raise exception 'Supplier Payment date is invalid'; end if;
  if p_external_reference is not null and char_length(trim(p_external_reference)) > 160 then
    raise exception 'Supplier Payment external reference is invalid';
  end if;
  if p_notes is not null and char_length(trim(p_notes)) > 2000 then
    raise exception 'Supplier Payment notes are invalid';
  end if;

  select * into supplier_record
  from public.suppliers supplier
  where supplier.workspace_id = p_workspace_id
    and supplier.id = p_supplier_id
    and supplier.status = 'active';
  if supplier_record.id is null then raise exception 'Supplier is unavailable'; end if;

  payment_reference := 'SPAY-' || upper(left(replace(p_supplier_payment_id::text, '-', ''), 12));

  insert into public.supplier_payments (
    id,
    workspace_id,
    reference,
    supplier_id,
    supplier_code_snapshot,
    supplier_name_snapshot,
    currency,
    amount,
    payment_method,
    external_reference,
    notes,
    paid_at,
    posted_by
  ) values (
    p_supplier_payment_id,
    p_workspace_id,
    payment_reference,
    supplier_record.id,
    supplier_record.code::text,
    supplier_record.name,
    upper(trim(p_currency)),
    round(p_amount, 4),
    p_payment_method,
    nullif(trim(p_external_reference), ''),
    nullif(trim(p_notes), ''),
    p_paid_at,
    p_actor_user_id
  ) returning * into payment_record;

  command_result := jsonb_build_object(
    'action', 'record_supplier_payment',
    'payment', to_jsonb(payment_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'supplier_payment', payment_record.id,
    'record_supplier_payment', command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Supplier Payment recorded',
    payment_record.supplier_name_snapshot || ' · ' || payment_record.reference,
    'blue',
    'supplier_payment',
    payment_record.id::text,
    p_command_id,
    jsonb_build_object(
      'supplier_id', payment_record.supplier_id,
      'currency', payment_record.currency,
      'amount', payment_record.amount,
      'banking_side_effect', false
    )
  );

  return command_result;
end;
$$;

create or replace function public.allocate_supplier_payment(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_supplier_payment_id uuid,
  p_supplier_payable_id uuid,
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
  payment_record public.supplier_payments;
  payable_record public.supplier_payables;
  allocated_payment numeric;
  allocated_invoice_payment numeric;
  allocated_invoice_credit numeric;
  available_payment numeric;
  outstanding_invoice numeric;
  allocation_record public.supplier_payment_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier Payment allocation access denied';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Supplier Payment allocation amount must be greater than zero'; end if;
  if exists (select 1 from public.supplier_payment_allocations allocation where allocation.id = p_allocation_id) then
    raise exception 'Supplier Payment allocation identity conflict';
  end if;

  select * into payment_record
  from public.supplier_payments payment
  where payment.workspace_id = p_workspace_id
    and payment.id = p_supplier_payment_id
  for update;
  if payment_record.id is null then raise exception 'Supplier Payment not found'; end if;
  if payment_record.status <> 'posted' then raise exception 'Supplier Payment is unavailable for allocation'; end if;

  select * into payable_record
  from public.supplier_payables payable
  where payable.workspace_id = p_workspace_id
    and payable.id = p_supplier_payable_id
  for update;
  if payable_record.id is null then raise exception 'Supplier payable not found'; end if;
  if payable_record.status <> 'posted' or payable_record.document_type <> 'invoice' then
    raise exception 'Supplier Payment can only be allocated to an active Supplier invoice';
  end if;
  if payment_record.supplier_id <> payable_record.supplier_id then
    raise exception 'Supplier Payment and payable must belong to the same Supplier';
  end if;
  if payment_record.currency <> payable_record.currency then
    raise exception 'Supplier Payment and payable currencies must match';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into allocated_payment
  from public.supplier_payment_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.supplier_payment_id = p_supplier_payment_id;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into allocated_invoice_payment
  from public.supplier_payment_allocations allocation
  join public.supplier_payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.supplier_payment_id
  where allocation.workspace_id = p_workspace_id
    and allocation.supplier_payable_id = p_supplier_payable_id
    and payment.status = 'posted';

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into allocated_invoice_credit
  from public.supplier_credit_allocations allocation
  join public.supplier_payables credit
    on credit.workspace_id = allocation.workspace_id
   and credit.id = allocation.credit_payable_id
  where allocation.workspace_id = p_workspace_id
    and allocation.invoice_payable_id = p_supplier_payable_id
    and credit.status = 'posted';

  available_payment := greatest(round(payment_record.amount - allocated_payment, 4), 0);
  outstanding_invoice := greatest(round(payable_record.amount - allocated_invoice_payment - allocated_invoice_credit, 4), 0);

  if round(p_amount, 4) > available_payment then
    raise exception 'Supplier Payment allocation exceeds the unallocated Payment amount';
  end if;
  if round(p_amount, 4) > outstanding_invoice then
    raise exception 'Supplier Payment allocation exceeds the Supplier invoice outstanding amount';
  end if;

  insert into public.supplier_payment_allocations (
    id,
    workspace_id,
    supplier_payment_id,
    supplier_payable_id,
    allocation_type,
    amount_delta,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_allocation_id,
    p_workspace_id,
    p_supplier_payment_id,
    p_supplier_payable_id,
    'allocation',
    round(p_amount, 4),
    p_actor_user_id,
    p_command_id,
    coalesce(p_occurred_at, now())
  ) returning * into allocation_record;

  command_result := jsonb_build_object(
    'action', 'allocate_supplier_payment',
    'allocation', to_jsonb(allocation_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'payment_allocation', allocation_record.id,
    'allocate_supplier_payment', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Supplier Payment allocated',
    payment_record.reference || ' → ' || payable_record.document_number_snapshot,
    'green',
    'supplier_payment_allocation',
    allocation_record.id::text,
    p_command_id,
    jsonb_build_object(
      'supplier_payment_id', payment_record.id,
      'supplier_payable_id', payable_record.id,
      'amount', allocation_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_supplier_payment_allocation(
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
  original_record public.supplier_payment_allocations;
  reversal_record public.supplier_payment_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier Payment allocation reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Supplier Payment allocation reversal reason is invalid';
  end if;

  select * into original_record
  from public.supplier_payment_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.id = p_allocation_id
  for update;
  if original_record.id is null then raise exception 'Supplier Payment allocation not found'; end if;
  if original_record.allocation_type <> 'allocation' then raise exception 'Only original Supplier Payment allocations can be reversed'; end if;
  if exists (
    select 1 from public.supplier_payment_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.reversal_of_id = p_allocation_id
  ) then
    raise exception 'Supplier Payment allocation has already been reversed';
  end if;

  insert into public.supplier_payment_allocations (
    id, workspace_id, supplier_payment_id, supplier_payable_id,
    allocation_type, amount_delta, reversal_of_id, reason,
    actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.supplier_payment_id, original_record.supplier_payable_id,
    'reversal', -original_record.amount_delta, original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_supplier_payment_allocation',
    'allocation', to_jsonb(reversal_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'payment_allocation', reversal_record.id,
    'reverse_supplier_payment_allocation', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier Payment allocation reversed', trim(p_reason), 'gold',
    'supplier_payment_allocation', reversal_record.id::text, p_command_id,
    jsonb_build_object('reversal_of_id', original_record.id, 'amount', reversal_record.amount_delta)
  );

  return command_result;
end;
$$;

create or replace function public.reverse_supplier_payment(
  p_workspace_id uuid,
  p_supplier_payment_id uuid,
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
  payment_record public.supplier_payments;
  allocation_total numeric;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier Payment reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Supplier Payment reversal reason is invalid';
  end if;

  select * into payment_record
  from public.supplier_payments payment
  where payment.workspace_id = p_workspace_id
    and payment.id = p_supplier_payment_id
  for update;
  if payment_record.id is null then raise exception 'Supplier Payment not found'; end if;
  if payment_record.status <> 'posted' then raise exception 'Supplier Payment has already been reversed'; end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into allocation_total
  from public.supplier_payment_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.supplier_payment_id = p_supplier_payment_id;
  if allocation_total <> 0 then raise exception 'Reverse Supplier Payment allocations before reversing the Payment'; end if;

  update public.supplier_payments
  set status = 'reversed',
      reversed_at = now(),
      reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id
    and id = p_supplier_payment_id
  returning * into payment_record;

  command_result := jsonb_build_object(
    'action', 'reverse_supplier_payment',
    'payment', to_jsonb(payment_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'supplier_payment', payment_record.id,
    'reverse_supplier_payment', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier Payment reversed', payment_record.reference, 'gold',
    'supplier_payment', payment_record.id::text, p_command_id,
    jsonb_build_object('reason', payment_record.reversal_reason, 'banking_side_effect', false)
  );

  return command_result;
end;
$$;

create or replace function public.allocate_supplier_credit(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_credit_payable_id uuid,
  p_invoice_payable_id uuid,
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
  credit_record public.supplier_payables;
  invoice_record public.supplier_payables;
  used_credit numeric;
  invoice_payment_total numeric;
  invoice_credit_total numeric;
  available_credit numeric;
  outstanding_invoice numeric;
  allocation_record public.supplier_credit_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier credit allocation access denied';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Supplier credit allocation amount must be greater than zero'; end if;
  if p_credit_payable_id = p_invoice_payable_id then raise exception 'Supplier credit and invoice must be different records'; end if;
  if exists (select 1 from public.supplier_credit_allocations allocation where allocation.id = p_allocation_id) then
    raise exception 'Supplier credit allocation identity conflict';
  end if;

  select * into credit_record
  from public.supplier_payables payable
  where payable.workspace_id = p_workspace_id
    and payable.id = p_credit_payable_id
  for update;
  select * into invoice_record
  from public.supplier_payables payable
  where payable.workspace_id = p_workspace_id
    and payable.id = p_invoice_payable_id
  for update;

  if credit_record.id is null then raise exception 'Supplier credit note payable not found'; end if;
  if invoice_record.id is null then raise exception 'Supplier invoice payable not found'; end if;
  if credit_record.status <> 'posted' or credit_record.document_type <> 'credit_note' then
    raise exception 'Supplier credit is unavailable for allocation';
  end if;
  if invoice_record.status <> 'posted' or invoice_record.document_type <> 'invoice' then
    raise exception 'Supplier credit can only be allocated to an active Supplier invoice';
  end if;
  if credit_record.supplier_id <> invoice_record.supplier_id then
    raise exception 'Supplier credit and invoice must belong to the same Supplier';
  end if;
  if credit_record.currency <> invoice_record.currency then
    raise exception 'Supplier credit and invoice currencies must match';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into used_credit
  from public.supplier_credit_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.credit_payable_id = p_credit_payable_id;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into invoice_payment_total
  from public.supplier_payment_allocations allocation
  join public.supplier_payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.supplier_payment_id
  where allocation.workspace_id = p_workspace_id
    and allocation.supplier_payable_id = p_invoice_payable_id
    and payment.status = 'posted';

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into invoice_credit_total
  from public.supplier_credit_allocations allocation
  join public.supplier_payables credit
    on credit.workspace_id = allocation.workspace_id
   and credit.id = allocation.credit_payable_id
  where allocation.workspace_id = p_workspace_id
    and allocation.invoice_payable_id = p_invoice_payable_id
    and credit.status = 'posted';

  available_credit := greatest(round(credit_record.amount - used_credit, 4), 0);
  outstanding_invoice := greatest(round(invoice_record.amount - invoice_payment_total - invoice_credit_total, 4), 0);

  if round(p_amount, 4) > available_credit then
    raise exception 'Supplier credit allocation exceeds the unallocated credit amount';
  end if;
  if round(p_amount, 4) > outstanding_invoice then
    raise exception 'Supplier credit allocation exceeds the Supplier invoice outstanding amount';
  end if;

  insert into public.supplier_credit_allocations (
    id, workspace_id, credit_payable_id, invoice_payable_id,
    allocation_type, amount_delta, actor_user_id, command_id, occurred_at
  ) values (
    p_allocation_id, p_workspace_id, p_credit_payable_id, p_invoice_payable_id,
    'allocation', round(p_amount, 4), p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into allocation_record;

  command_result := jsonb_build_object(
    'action', 'allocate_supplier_credit',
    'allocation', to_jsonb(allocation_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'credit_allocation', allocation_record.id,
    'allocate_supplier_credit', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier credit allocated',
    credit_record.document_number_snapshot || ' → ' || invoice_record.document_number_snapshot,
    'green', 'supplier_credit_allocation', allocation_record.id::text, p_command_id,
    jsonb_build_object(
      'credit_payable_id', credit_record.id,
      'invoice_payable_id', invoice_record.id,
      'amount', allocation_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_supplier_credit_allocation(
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
  original_record public.supplier_credit_allocations;
  reversal_record public.supplier_credit_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Supplier credit allocation reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Supplier credit allocation reversal reason is invalid';
  end if;

  select * into original_record
  from public.supplier_credit_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.id = p_allocation_id
  for update;
  if original_record.id is null then raise exception 'Supplier credit allocation not found'; end if;
  if original_record.allocation_type <> 'allocation' then raise exception 'Only original Supplier credit allocations can be reversed'; end if;
  if exists (
    select 1 from public.supplier_credit_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.reversal_of_id = p_allocation_id
  ) then
    raise exception 'Supplier credit allocation has already been reversed';
  end if;

  insert into public.supplier_credit_allocations (
    id, workspace_id, credit_payable_id, invoice_payable_id,
    allocation_type, amount_delta, reversal_of_id, reason,
    actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.credit_payable_id, original_record.invoice_payable_id,
    'reversal', -original_record.amount_delta, original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_supplier_credit_allocation',
    'allocation', to_jsonb(reversal_record)
  );

  insert into public.supplier_accounts_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'credit_allocation', reversal_record.id,
    'reverse_supplier_credit_allocation', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier credit allocation reversed', trim(p_reason), 'gold',
    'supplier_credit_allocation', reversal_record.id::text, p_command_id,
    jsonb_build_object('reversal_of_id', original_record.id, 'amount', reversal_record.amount_delta)
  );

  return command_result;
end;
$$;

revoke all on function public.record_supplier_payment(uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.allocate_supplier_payment(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_supplier_payment_allocation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_supplier_payment(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.allocate_supplier_credit(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_supplier_credit_allocation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.record_supplier_payment(uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, timestamptz, text, text) to service_role;
grant execute on function public.allocate_supplier_payment(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.reverse_supplier_payment_allocation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.reverse_supplier_payment(uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.allocate_supplier_credit(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.reverse_supplier_credit_allocation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) to service_role;

comment on function public.record_supplier_payment(uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, timestamptz, text, text) is
  'Records immutable money paid to a Supplier. Creates no Banking transaction.';
comment on function public.allocate_supplier_payment(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) is
  'Appends a same-Supplier, same-currency allocation from a Supplier Payment to a posted Supplier invoice.';
comment on function public.allocate_supplier_credit(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz) is
  'Appends a same-Supplier, same-currency allocation from a posted Supplier credit note to a posted Supplier invoice.';

commit;


begin;

drop policy if exists "Supplier documents Accounts read" on public.supplier_documents;
create policy "Supplier documents Accounts read"
on public.supplier_documents for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

drop policy if exists "Suppliers Accounts read" on public.suppliers;
create policy "Suppliers Accounts read"
on public.suppliers for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

comment on policy "Supplier documents Accounts read" on public.supplier_documents is
  'Accounts users may read approved Purchasing source documents for explicit payable posting.';
comment on policy "Suppliers Accounts read" on public.suppliers is
  'Accounts users may read Supplier identities for Payments and balance reporting.';

commit;


begin;

create or replace view public.supplier_account_balances
with (security_invoker = true)
as
with party_keys as (
  select payable.workspace_id, payable.supplier_id, payable.currency
  from public.supplier_payables payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
  union
  select payment.workspace_id, payment.supplier_id, payment.currency
  from public.supplier_payments payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
), payable_totals as (
  select payable.workspace_id,
         payable.supplier_id,
         payable.currency,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.amount else 0 end), 4) as posted_invoice_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_payment_amount else 0 end), 4) as allocated_payment_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_credit_amount else 0 end), 4) as allocated_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.outstanding_amount else 0 end), 4) as outstanding_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.amount else 0 end), 4) as supplier_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.unallocated_credit else 0 end), 4) as unallocated_credit
  from public.supplier_payable_balances payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
), payment_totals as (
  select payment.workspace_id,
         payment.supplier_id,
         payment.currency,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as payments_sent,
         round(sum(payment.unallocated_amount), 4) as unallocated_payment
  from public.supplier_payment_balances payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
)
select party.workspace_id,
       party.supplier_id,
       supplier.code::text as supplier_code,
       supplier.name as supplier_name,
       party.currency,
       coalesce(payable.posted_invoice_amount, 0)::numeric(14,4) as posted_invoice_amount,
       coalesce(payment.payments_sent, 0)::numeric(14,4) as payments_sent,
       coalesce(payable.allocated_payment_amount, 0)::numeric(14,4) as allocated_payment_amount,
       coalesce(payable.allocated_credit_amount, 0)::numeric(14,4) as allocated_credit_amount,
       coalesce(payable.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.unallocated_payment, 0)::numeric(14,4) as unallocated_payment,
       coalesce(payable.supplier_credit_amount, 0)::numeric(14,4) as supplier_credit_amount,
       coalesce(payable.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(
         coalesce(payable.outstanding_amount, 0)
         - coalesce(payment.unallocated_payment, 0)
         - coalesce(payable.unallocated_credit, 0),
         4
       )::numeric(14,4) as net_balance,
       case
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) < 0 then 'supplier_credit'
         else 'clear'
       end as balance_status
from party_keys party
join public.suppliers supplier
  on supplier.workspace_id = party.workspace_id
 and supplier.id = party.supplier_id
left join payable_totals payable
  on payable.workspace_id = party.workspace_id
 and payable.supplier_id = party.supplier_id
 and payable.currency = party.currency
left join payment_totals payment
  on payment.workspace_id = party.workspace_id
 and payment.supplier_id = party.supplier_id
 and payment.currency = party.currency;

comment on view public.supplier_account_balances is
  'Derived Supplier balance by canonical Supplier identity and currency. Historical snapshots cannot create duplicate balance rows.';

commit;


begin;

drop policy if exists "Supplier documents Accounts read" on public.supplier_documents;
drop policy if exists "Supplier documents permission read" on public.supplier_documents;
create policy "Supplier documents permission read"
on public.supplier_documents for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'purchasing', 'view')
  or private.has_workspace_permission(workspace_id, 'accounts', 'view')
);

drop policy if exists "Suppliers Accounts read" on public.suppliers;
drop policy if exists "Suppliers permission read" on public.suppliers;
create policy "Suppliers permission read"
on public.suppliers for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'suppliers', 'view')
  or private.has_workspace_permission(workspace_id, 'accounts', 'view')
);

comment on policy "Supplier documents permission read" on public.supplier_documents is
  'One combined RLS read boundary for Purchasing source-document users and Accounts Payable users.';
comment on policy "Suppliers permission read" on public.suppliers is
  'One combined RLS read boundary for Supplier-directory users and Accounts Payable users.';

commit;
