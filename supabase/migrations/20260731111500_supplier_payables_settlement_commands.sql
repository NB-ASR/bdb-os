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
