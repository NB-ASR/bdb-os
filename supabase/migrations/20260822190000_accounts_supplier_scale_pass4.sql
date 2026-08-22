-- Accounts Engine Hardening V1 — Pass 4: Scale + Torture Testing
--
-- This migration adds the read-path support needed to keep Supplier Payables bounded
-- at scale and hardens future Supplier Payment references against UUID-prefix collisions.
-- It does not rewrite financial history or change posting/allocation rules.

-- Keep variable settlement/posting state out of the ordered key path. The registers
-- filter workspace/document type and then page by time + id; INCLUDE keeps state
-- available without breaking the index's ability to satisfy that ordering.
create index if not exists supplier_documents_accounts_cursor_idx
  on public.supplier_documents (
    workspace_id,
    status,
    approved_at desc,
    id desc
  ) include (accounts_posting_status);

create index if not exists supplier_payables_register_cursor_idx
  on public.supplier_payables (
    workspace_id,
    document_type,
    posted_at desc,
    id desc
  ) include (status);

create index if not exists supplier_payments_register_cursor_idx
  on public.supplier_payments (
    workspace_id,
    paid_at desc,
    id desc
  );

create index if not exists supplier_payment_allocations_workspace_time_idx
  on public.supplier_payment_allocations (
    workspace_id,
    occurred_at desc,
    id desc
  );

create index if not exists supplier_credit_allocations_workspace_time_idx
  on public.supplier_credit_allocations (
    workspace_id,
    occurred_at desc,
    id desc
  );

create index if not exists suppliers_active_search_idx
  on public.suppliers (
    workspace_id,
    status,
    name,
    id
  );

create or replace function public.get_supplier_accounts_summary(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  default_currency text;
  ready_document_count bigint;
  outstanding_amount numeric;
  unallocated_credit_amount numeric;
  supplier_account_count bigint;
begin
  select coalesce(settings.currency, 'EUR')
    into default_currency
  from public.workspace_settings settings
  where settings.workspace_id = p_workspace_id;

  default_currency := coalesce(default_currency, 'EUR');

  select count(*)
    into ready_document_count
  from public.supplier_documents document
  where document.workspace_id = p_workspace_id
    and document.status = 'approved'
    and document.accounts_posting_status in ('ready', 'reversed');

  select
    coalesce(sum(balance.outstanding_amount), 0),
    coalesce(sum(balance.unallocated_credit + balance.unallocated_payment), 0),
    count(*)
  into
    outstanding_amount,
    unallocated_credit_amount,
    supplier_account_count
  from public.supplier_account_balances balance
  where balance.workspace_id = p_workspace_id
    and balance.currency = default_currency;

  return jsonb_build_object(
    'currency', default_currency,
    'readyDocumentCount', coalesce(ready_document_count, 0),
    'outstandingAmount', round(coalesce(outstanding_amount, 0), 4),
    'unallocatedCreditAmount', round(coalesce(unallocated_credit_amount, 0), 4),
    'supplierAccountCount', coalesce(supplier_account_count, 0)
  );
end;
$function$;

revoke all on function public.get_supplier_accounts_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_supplier_accounts_summary(uuid) to service_role;

-- The historical 12-hex UUID prefix can collide for distinct Supplier Payment UUIDs.
-- Keep historical references untouched; future references encode the full UUID payload.
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
as $function$
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

  payment_reference := 'SPAY-' || upper(replace(p_supplier_payment_id::text, '-', ''));

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
$function$;

revoke all on function public.record_supplier_payment(uuid,uuid,text,uuid,uuid,uuid,text,numeric,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.record_supplier_payment(uuid,uuid,text,uuid,uuid,uuid,text,numeric,text,timestamptz,text,text) to service_role;
