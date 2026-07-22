begin;

alter table public.operator_policies
  add constraint operator_internal_provider_requires_assist_check
  check (provider_mode <> 'internal' or autonomy_mode = 'assist');

create or replace function public.create_workspace_invoice(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_due_at date,
  p_description text,
  p_amount numeric,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  existing public.invoices%rowtype;
  prefix text;
  next_number bigint;
  invoice_number text;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'accounts', 'create') then
    raise exception 'Invoice creation access denied' using errcode = '42501';
  end if;

  if p_invoice_id is null
    or p_customer_id is null
    or p_due_at is null
    or p_due_at < current_date
    or char_length(btrim(coalesce(p_description, ''))) not between 2 and 1000
    or p_amount is null
    or p_amount <= 0
    or p_amount > 9999999999.99
    or p_status not in ('draft', 'sent') then
    raise exception 'Invalid invoice';
  end if;

  select * into existing from public.invoices where id = p_invoice_id;
  if existing.id is not null then
    if existing.workspace_id <> p_workspace_id then
      raise exception 'Invoice identifier is unavailable' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'number', existing.number,
      'issuedAt', existing.issued_at,
      'replayed', true
    );
  end if;

  if not exists (
    select 1 from public.customers customer
    where customer.id = p_customer_id
      and customer.workspace_id = p_workspace_id
  ) then
    raise exception 'Customer is unavailable';
  end if;

  -- The workspace row is a stable per-tenant mutex. Two devices can never
  -- allocate the same invoice suffix concurrently.
  perform 1 from public.workspaces workspace
  where workspace.id = p_workspace_id
  for update;

  select coalesce(nullif(regexp_replace(upper(settings.invoice_prefix), '[^A-Z0-9-]', '', 'g'), ''), 'INV')
    into prefix
    from public.workspace_settings settings
   where settings.workspace_id = p_workspace_id;
  prefix := coalesce(prefix, 'INV');

  select coalesce(max((substring(invoice.number from '([0-9]+)$'))::bigint), 1000) + 1
    into next_number
    from public.invoices invoice
   where invoice.workspace_id = p_workspace_id
     and invoice.number ~ '[0-9]+$';
  invoice_number := prefix || '-' || next_number;

  insert into public.invoices (
    id, workspace_id, number, customer_id, issued_at, due_at,
    description, amount, status
  ) values (
    p_invoice_id, p_workspace_id, invoice_number, p_customer_id, current_date,
    p_due_at, btrim(p_description), round(p_amount, 2), p_status::public.invoice_status
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, caller_id, 'invoice.created', invoice_number, 'gold',
    'invoice', p_invoice_id::text, p_invoice_id,
    jsonb_build_object('customer_id', p_customer_id, 'status', p_status)
  );

  return jsonb_build_object(
    'id', p_invoice_id,
    'number', invoice_number,
    'issuedAt', current_date,
    'replayed', false
  );
end;
$$;

create or replace function public.reconcile_bank_transaction(
  p_workspace_id uuid,
  p_transaction_id uuid,
  p_invoice_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  transaction_record public.bank_transactions%rowtype;
  invoice public.invoices%rowtype;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'banking', 'approve') then
    raise exception 'Reconciliation access denied' using errcode = '42501';
  end if;

  select * into transaction_record
    from public.bank_transactions
   where id = p_transaction_id
     and workspace_id = p_workspace_id
   for update;

  if transaction_record.id is null then raise exception 'Transaction is unavailable'; end if;
  if transaction_record.status = 'matched' then
    if transaction_record.matched_invoice_id is not distinct from p_invoice_id then
      return jsonb_build_object('id', transaction_record.id, 'status', 'matched', 'replayed', true);
    end if;
    raise exception 'Transaction was already reconciled differently';
  end if;

  if transaction_record.transaction_type = 'credit' then
    if p_invoice_id is null then raise exception 'Choose an invoice for this credit'; end if;
    select * into invoice
      from public.invoices
     where id = p_invoice_id
       and workspace_id = p_workspace_id
     for update;
    if invoice.id is null then raise exception 'Invoice is unavailable'; end if;
    if invoice.status = 'paid' then raise exception 'Invoice is already paid'; end if;
    if round(invoice.amount, 2) <> round(transaction_record.amount, 2) then
      raise exception 'The transaction amount must equal the invoice amount';
    end if;
  elsif p_invoice_id is not null then
    raise exception 'Expenses cannot be matched to a sales invoice';
  end if;

  update public.bank_transactions
     set status = 'matched',
         matched_invoice_id = p_invoice_id,
         updated_at = now()
   where id = transaction_record.id;

  if p_invoice_id is not null then
    update public.invoices
       set status = 'paid', updated_at = now()
     where id = p_invoice_id;
  end if;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    caller_id,
    'banking.transaction_reconciled',
    transaction_record.description || case when invoice.number is not null then ' → ' || invoice.number else '' end,
    'green',
    'bank_transaction',
    transaction_record.id::text,
    gen_random_uuid(),
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'amount', transaction_record.amount,
      'transaction_type', transaction_record.transaction_type
    )
  );

  return jsonb_build_object(
    'id', transaction_record.id,
    'status', 'matched',
    'invoiceId', p_invoice_id,
    'invoiceStatus', case when p_invoice_id is null then null else 'paid' end,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_workspace_invoice(uuid, uuid, uuid, date, text, numeric, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_bank_transaction(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_workspace_invoice(uuid, uuid, uuid, date, text, numeric, text)
  to authenticated;
grant execute on function public.reconcile_bank_transaction(uuid, uuid, uuid)
  to authenticated;

comment on function public.create_workspace_invoice(uuid, uuid, uuid, date, text, numeric, text) is
  'Authenticated atomic command with explicit accounts/create permission. Workspace locking prevents duplicate invoice numbers across devices.';
comment on function public.reconcile_bank_transaction(uuid, uuid, uuid) is
  'Authenticated atomic command with explicit banking/approve permission. Transaction and invoice states commit together or not at all.';

commit;
