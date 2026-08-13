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
