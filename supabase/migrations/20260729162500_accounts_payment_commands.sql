begin;

create or replace function private.insert_payment_allocation(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz
)
returns public.payment_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_record public.payments;
  invoice_record public.invoices;
  payment_allocated numeric;
  invoice_allocated numeric;
  payment_available numeric;
  invoice_outstanding numeric;
  allocation_record public.payment_allocations;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Payment allocation amount is invalid'; end if;

  select * into payment_record
  from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = p_payment_id
  for update;
  if payment_record.id is null or payment_record.status <> 'posted' then raise exception 'Payment is unavailable for allocation'; end if;

  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then raise exception 'Invoice is unavailable for allocation'; end if;
  if invoice_record.customer_id <> payment_record.customer_id then raise exception 'Payment and Invoice must belong to the same Customer'; end if;
  if invoice_record.currency <> payment_record.currency then raise exception 'Payment and Invoice currencies must match'; end if;

  select coalesce(sum(amount_delta), 0) into payment_allocated
  from public.payment_allocations where workspace_id = p_workspace_id and payment_id = p_payment_id;
  select coalesce(sum(amount_delta), 0) into invoice_allocated
  from public.payment_allocations allocation
  join public.payments payment on payment.workspace_id = allocation.workspace_id and payment.id = allocation.payment_id
  where allocation.workspace_id = p_workspace_id and allocation.invoice_id = p_invoice_id and payment.status = 'posted';

  payment_available := round(payment_record.amount - payment_allocated, 4);
  invoice_outstanding := round(invoice_record.total_amount - invoice_allocated, 4);
  if p_amount > payment_available then raise exception 'Payment allocation exceeds the unallocated Payment amount'; end if;
  if p_amount > invoice_outstanding then raise exception 'Payment allocation exceeds the Invoice outstanding amount'; end if;

  insert into public.payment_allocations (
    id, workspace_id, payment_id, invoice_id, allocation_type, amount_delta,
    actor_user_id, command_id, occurred_at
  ) values (
    p_allocation_id, p_workspace_id, p_payment_id, p_invoice_id, 'allocation', round(p_amount, 4),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into allocation_record;

  perform private.refresh_invoice_payment_status(p_workspace_id, p_invoice_id, p_actor_user_id);
  return allocation_record;
end;
$$;

create or replace function public.record_payment(
  p_workspace_id uuid,
  p_payment_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_received_at timestamptz,
  p_external_reference text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  payment_record public.payments;
  customer_record public.customers;
  allocation_value jsonb;
  allocation_id uuid;
  invoice_id uuid;
  allocation_amount numeric;
  allocation_count integer := 0;
  currency_value text;
  reference_value text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then raise exception 'Accounts Payment access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount is invalid'; end if;
  if p_payment_method not in ('cash', 'card', 'bank_transfer', 'cheque', 'other') then raise exception 'Payment method is invalid'; end if;
  if exists (select 1 from public.payments where id = p_payment_id) then raise exception 'Payment identity conflict'; end if;

  select * into customer_record from public.customers customer
  where customer.workspace_id = p_workspace_id and customer.id = p_customer_id and customer.status = 'active';
  if customer_record.id is null then raise exception 'Payment Customer is unavailable'; end if;
  select upper(settings.currency) into currency_value from public.workspace_settings settings where settings.workspace_id = p_workspace_id;
  currency_value := coalesce(currency_value, 'EUR');
  reference_value := 'PAY-' || to_char(coalesce(p_received_at, now()) at time zone 'UTC', 'YYYYMMDD') || '-' || upper(right(replace(p_payment_id::text, '-', ''), 8));

  insert into public.payments (
    id, workspace_id, reference, customer_id, customer_code_snapshot, customer_name_snapshot,
    currency, amount, payment_method, external_reference, notes, received_at, posted_by
  ) values (
    p_payment_id, p_workspace_id, reference_value, customer_record.id, customer_record.code, customer_record.name,
    currency_value, round(p_amount, 4), p_payment_method, nullif(trim(p_external_reference), ''),
    nullif(trim(p_notes), ''), coalesce(p_received_at, now()), p_actor_user_id
  ) returning * into payment_record;

  if p_allocations is not null then
    if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) > 100 then raise exception 'Payment allocations are invalid'; end if;
    for allocation_value in select value from jsonb_array_elements(p_allocations)
    loop
      begin
        allocation_id := (allocation_value->>'id')::uuid;
        invoice_id := (allocation_value->>'invoiceId')::uuid;
        allocation_amount := (allocation_value->>'amount')::numeric;
      exception when others then raise exception 'Payment allocation details are invalid'; end;
      perform private.insert_payment_allocation(
        p_workspace_id, allocation_id, p_payment_id, invoice_id, allocation_amount,
        p_actor_user_id, p_command_id, coalesce(p_received_at, now())
      );
      allocation_count := allocation_count + 1;
    end loop;
  end if;

  select * into payment_record from public.payments where workspace_id = p_workspace_id and id = p_payment_id;
  command_result := jsonb_build_object('action', 'record_payment', 'payment', to_jsonb(payment_record), 'allocationCount', allocation_count);
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'payment', p_payment_id, 'record_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment recorded',
    reference_value || ' · ' || currency_value || ' ' || round(p_amount, 4)::text,
    'green', 'payment', p_payment_id::text, p_command_id,
    jsonb_build_object('customer_id', p_customer_id, 'amount', round(p_amount,4), 'allocation_count', allocation_count, 'payment_method', p_payment_method, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.allocate_payment(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  allocation_record public.payment_allocations;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment allocation idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment allocation access denied'; end if;

  allocation_record := private.insert_payment_allocation(
    p_workspace_id, p_allocation_id, p_payment_id, p_invoice_id, p_amount,
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  );
  command_result := jsonb_build_object('action', 'allocate_payment', 'allocation', to_jsonb(allocation_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'allocation', p_allocation_id, 'allocate_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment allocated',
    allocation_record.amount_delta::text || ' allocated to Invoice ' || p_invoice_id::text,
    'green', 'payment_allocation', p_allocation_id::text, p_command_id,
    jsonb_build_object('payment_id', p_payment_id, 'invoice_id', p_invoice_id, 'amount', allocation_record.amount_delta, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.reverse_payment_allocation(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_allocation_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  original_record public.payment_allocations;
  reversal_record public.payment_allocations;
  payment_record public.payments;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Allocation reversal idempotency key is invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Allocation reversal reason is required'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment allocation reversal access denied'; end if;

  select * into original_record from public.payment_allocations allocation
  where allocation.workspace_id = p_workspace_id and allocation.id = p_allocation_id
  for update;
  if original_record.id is null or original_record.allocation_type <> 'allocation' then raise exception 'Payment allocation is unavailable for reversal'; end if;
  if exists (select 1 from public.payment_allocations where workspace_id = p_workspace_id and reversal_of_id = p_allocation_id) then raise exception 'Payment allocation has already been reversed'; end if;
  select * into payment_record from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = original_record.payment_id
  for update;
  if payment_record.status <> 'posted' then raise exception 'Payment is unavailable for allocation reversal'; end if;

  insert into public.payment_allocations (
    id, workspace_id, payment_id, invoice_id, allocation_type, amount_delta,
    reversal_of_id, reason, actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.payment_id, original_record.invoice_id,
    'reversal', -abs(original_record.amount_delta), original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into reversal_record;
  perform private.refresh_invoice_payment_status(p_workspace_id, original_record.invoice_id, p_actor_user_id);

  command_result := jsonb_build_object('action', 'reverse_allocation', 'allocation', to_jsonb(reversal_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'allocation', p_reversal_id, 'reverse_allocation', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment allocation reversed',
    abs(reversal_record.amount_delta)::text || ' released from Invoice ' || original_record.invoice_id::text,
    'neutral', 'payment_allocation', p_reversal_id::text, p_command_id,
    jsonb_build_object('payment_id', original_record.payment_id, 'invoice_id', original_record.invoice_id, 'original_allocation_id', original_record.id, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.reverse_payment(
  p_workspace_id uuid,
  p_payment_id uuid,
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
  command_result jsonb;
  payment_record public.payments;
  allocated_value numeric;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment reversal idempotency key is invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Payment reversal reason is required'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment reversal access denied'; end if;

  select * into payment_record from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = p_payment_id
  for update;
  if payment_record.id is null or payment_record.status <> 'posted' then raise exception 'Payment is unavailable for reversal'; end if;
  select coalesce(sum(amount_delta), 0) into allocated_value from public.payment_allocations
  where workspace_id = p_workspace_id and payment_id = p_payment_id;
  if allocated_value <> 0 then raise exception 'Reverse Payment allocations before reversing the Payment'; end if;

  update public.payments
  set status = 'reversed', reversed_at = now(), reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason), version = version + 1
  where workspace_id = p_workspace_id and id = p_payment_id
  returning * into payment_record;

  command_result := jsonb_build_object('action', 'reverse_payment', 'payment', to_jsonb(payment_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'payment', p_payment_id, 'reverse_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment reversed',
    payment_record.reference || ' · ' || payment_record.currency || ' ' || payment_record.amount::text,
    'neutral', 'payment', p_payment_id::text, p_command_id,
    jsonb_build_object('customer_id', payment_record.customer_id, 'amount', payment_record.amount, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

revoke all on function public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.allocate_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.reverse_payment(uuid,uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb) to service_role;
grant execute on function public.allocate_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone) to service_role;
grant execute on function public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone) to service_role;
grant execute on function public.reverse_payment(uuid,uuid,text,uuid,uuid,text) to service_role;

commit;
