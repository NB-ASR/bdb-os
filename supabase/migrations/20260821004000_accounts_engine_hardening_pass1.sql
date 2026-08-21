-- Accounts Engine Hardening V1 — Pass 1: Financial Integrity
--
-- This migration closes integrity gaps without changing issued financial history:
--   * Payment allocation respects issued Credit Notes.
--   * Quantity-backed Credit Notes reject duplicate source lines and absorb final rounding remainder.
--   * Delivery Note issue is serialized against its source and duplicate source rows are impossible.
--   * Invoice default due dates honor workspace payment terms.
--   * Workspace base currency freezes after financial activity begins.
--   * Legacy/browser financial RPC bypasses and private helper EXECUTE grants are retired.
--   * Server financial command idempotency keys are bound to a canonical request hash.

-- ---------------------------------------------------------------------------
-- Financial command request claims
-- ---------------------------------------------------------------------------

create table public.accounts_command_claims (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.accounts_command_claims enable row level security;
revoke all on table public.accounts_command_claims from public, anon, authenticated;

create or replace function public.claim_accounts_command(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_key text := trim(coalesce(p_idempotency_key, ''));
  normalized_hash text := lower(trim(coalesce(p_request_hash, '')));
  existing_hash text;
begin
  if char_length(normalized_key) not between 1 and 128 then
    raise exception 'Accounts idempotency key is invalid';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Accounts request hash is invalid';
  end if;
  if not exists (
    select 1 from public.workspaces workspace where workspace.id = p_workspace_id
  ) then
    raise exception 'Accounts workspace is unavailable';
  end if;

  insert into public.accounts_command_claims(workspace_id, idempotency_key, request_hash)
  values (p_workspace_id, normalized_key, normalized_hash)
  on conflict (workspace_id, idempotency_key) do nothing;

  select claim.request_hash
    into existing_hash
    from public.accounts_command_claims claim
   where claim.workspace_id = p_workspace_id
     and claim.idempotency_key = normalized_key;

  if existing_hash is distinct from normalized_hash then
    raise exception 'Idempotency key was reused with different Accounts input';
  end if;

  return jsonb_build_object(
    'workspaceId', p_workspace_id,
    'idempotencyKey', normalized_key,
    'requestHash', normalized_hash
  );
end;
$function$;

revoke all on function public.claim_accounts_command(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_accounts_command(uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- Payment allocation: Credits reduce what can still be allocated to an Invoice
-- ---------------------------------------------------------------------------

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
as $function$
declare
  payment_record public.payments;
  invoice_record public.invoices;
  payment_allocated numeric;
  invoice_allocated numeric;
  invoice_credited numeric;
  payment_available numeric;
  invoice_outstanding numeric;
  allocation_record public.payment_allocations;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment allocation amount is invalid';
  end if;

  select * into payment_record
  from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = p_payment_id
  for update;
  if payment_record.id is null or payment_record.status <> 'posted' then
    raise exception 'Payment is unavailable for allocation';
  end if;

  -- Invoice locking serializes allocation against Credit Note creation/issue.
  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null
     or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then
    raise exception 'Invoice is unavailable for allocation';
  end if;
  if invoice_record.customer_id <> payment_record.customer_id then
    raise exception 'Payment and Invoice must belong to the same Customer';
  end if;
  if invoice_record.currency <> payment_record.currency then
    raise exception 'Payment and Invoice currencies must match';
  end if;

  select coalesce(sum(allocation.amount_delta), 0)
    into payment_allocated
    from public.payment_allocations allocation
   where allocation.workspace_id = p_workspace_id
     and allocation.payment_id = p_payment_id;

  select coalesce(sum(allocation.amount_delta), 0)
    into invoice_allocated
    from public.payment_allocations allocation
    join public.payments payment
      on payment.workspace_id = allocation.workspace_id
     and payment.id = allocation.payment_id
   where allocation.workspace_id = p_workspace_id
     and allocation.invoice_id = p_invoice_id
     and payment.status = 'posted';

  select coalesce(sum(note.total_amount), 0)
    into invoice_credited
    from public.credit_notes note
   where note.workspace_id = p_workspace_id
     and note.invoice_id = p_invoice_id
     and note.status = 'issued';

  payment_available := greatest(round(payment_record.amount - payment_allocated, 4), 0);
  invoice_outstanding := greatest(round(invoice_record.total_amount - invoice_credited - invoice_allocated, 4), 0);

  if p_amount > payment_available then
    raise exception 'Payment allocation exceeds the unallocated Payment amount';
  end if;
  if p_amount > invoice_outstanding then
    raise exception 'Payment allocation exceeds the Invoice outstanding amount after Credit Notes';
  end if;

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
$function$;

create or replace function private.refresh_invoice_payment_status(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invoice_record public.invoices;
  allocated_value numeric;
  credited_value numeric;
  outstanding_value numeric;
begin
  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null
     or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then
    return;
  end if;

  select coalesce(sum(allocation.amount_delta), 0)
    into allocated_value
    from public.payment_allocations allocation
    join public.payments payment
      on payment.workspace_id = allocation.workspace_id
     and payment.id = allocation.payment_id
   where allocation.workspace_id = p_workspace_id
     and allocation.invoice_id = p_invoice_id
     and payment.status = 'posted';

  select coalesce(sum(note.total_amount), 0)
    into credited_value
    from public.credit_notes note
   where note.workspace_id = p_workspace_id
     and note.invoice_id = p_invoice_id
     and note.status = 'issued';

  outstanding_value := greatest(round(invoice_record.total_amount - credited_value - allocated_value, 4), 0);

  update public.invoices
  set status = case
        when outstanding_value = 0 then 'paid'::public.invoice_status
        when due_at < current_date then 'overdue'::public.invoice_status
        else 'sent'::public.invoice_status
      end,
      updated_by = p_actor_user_id
  where workspace_id = p_workspace_id and id = p_invoice_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Credit Note quantity integrity and exact final remainder
-- ---------------------------------------------------------------------------

create unique index credit_note_lines_one_source_per_note_idx
  on public.credit_note_lines(workspace_id, credit_note_id, source_invoice_line_id)
  where source_invoice_line_id is not null;

create or replace function private.write_credit_note_lines_by_quantity(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  line_value jsonb;
  source_line public.invoice_lines;
  invoice_record public.invoices;
  line_id uuid;
  source_id uuid;
  requested_quantity numeric;
  requested_amount numeric;
  credited_quantity numeric;
  credited_gross numeric;
  credited_discount numeric;
  credited_net numeric;
  credited_vat numeric;
  credited_total numeric;
  prior_legacy_credit numeric;
  line_number_value integer := 0;
  factor numeric;
  gross_value numeric;
  discount_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  gross_total numeric := 0;
  discount_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  credit_total numeric := 0;
  invoice_line_count integer;
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Credit Note must contain between 1 and 100 lines';
  end if;

  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null then
    raise exception 'Credit Note Invoice not found';
  end if;

  select count(*) into invoice_line_count
  from public.invoice_lines line
  where line.workspace_id = p_workspace_id and line.invoice_id = p_invoice_id;

  if invoice_line_count > 0 and exists (
    select 1
    from (
      select nullif(line->>'sourceInvoiceLineId', '') as source_id, count(*) as source_count
      from jsonb_array_elements(p_lines) line
      group by nullif(line->>'sourceInvoiceLineId', '')
    ) duplicate
    where duplicate.source_id is not null and duplicate.source_count > 1
  ) then
    raise exception 'A Credit Note can reference each original Invoice line only once';
  end if;

  delete from public.credit_note_lines
  where workspace_id = p_workspace_id and credit_note_id = p_credit_note_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin
      line_id := (line_value->>'id')::uuid;
    exception when others then
      raise exception 'Credit Note line identity is invalid';
    end;

    if invoice_line_count > 0 then
      begin
        source_id := (line_value->>'sourceInvoiceLineId')::uuid;
      exception when others then
        raise exception 'Credit Note source line is invalid';
      end;

      select * into source_line
      from public.invoice_lines line
      where line.workspace_id = p_workspace_id
        and line.id = source_id
        and line.invoice_id = p_invoice_id
      for update;
      if source_line.id is null then
        raise exception 'Credit Note source line is unavailable';
      end if;

      begin
        requested_quantity := (line_value->>'quantity')::numeric;
      exception when others then
        raise exception 'Credit Note quantity is invalid';
      end;
      if requested_quantity <= 0 then
        raise exception 'Credit Note quantity must be greater than zero';
      end if;

      select
        coalesce(sum(line.quantity), 0),
        coalesce(sum(line.gross_amount), 0),
        coalesce(sum(line.discount_amount), 0),
        coalesce(sum(line.net_amount), 0),
        coalesce(sum(line.vat_amount), 0),
        coalesce(sum(line.total_amount), 0)
      into
        credited_quantity,
        credited_gross,
        credited_discount,
        credited_net,
        credited_vat,
        credited_total
      from public.credit_note_lines line
      join public.credit_notes note
        on note.workspace_id = line.workspace_id
       and note.id = line.credit_note_id
      where line.workspace_id = p_workspace_id
        and line.source_invoice_line_id = source_id
        and note.status = 'issued';

      if requested_quantity + credited_quantity > source_line.quantity then
        raise exception 'Credit Note quantity exceeds the uncredited Invoice quantity';
      end if;

      if requested_quantity + credited_quantity = source_line.quantity then
        -- The final quantity slice receives the exact source remainder. This prevents
        -- repeated 4-decimal proportional rounding from leaving a phantom balance.
        gross_value := round(source_line.gross_amount - credited_gross, 4);
        discount_value := round(source_line.discount_amount - credited_discount, 4);
        net_value := round(source_line.net_amount - credited_net, 4);
        vat_value := round(source_line.vat_amount - credited_vat, 4);
        total_value := round(source_line.total_amount - credited_total, 4);
      else
        factor := requested_quantity / source_line.quantity;
        gross_value := round(source_line.gross_amount * factor, 4);
        discount_value := round(source_line.discount_amount * factor, 4);
        net_value := round(source_line.net_amount * factor, 4);
        vat_value := round(source_line.vat_amount * factor, 4);
        total_value := round(net_value + vat_value, 4);
      end if;

      if gross_value < 0 or discount_value < 0 or net_value < 0 or vat_value < 0 or total_value < 0 then
        raise exception 'Credit Note remainder is invalid';
      end if;

      insert into public.credit_note_lines (
        id, workspace_id, credit_note_id, source_invoice_line_id, line_number, line_type,
        product_id, service_id, code_snapshot, description_snapshot, quantity, unit_price,
        gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        line_id, p_workspace_id, p_credit_note_id, source_id, line_number_value, source_line.line_type,
        source_line.product_id, source_line.service_id, source_line.code_snapshot, source_line.description_snapshot,
        requested_quantity, source_line.unit_price, gross_value, discount_value, net_value,
        source_line.vat_rate, vat_value, total_value
      );
    else
      -- Historical zero-line Invoices remain readable/migratable, but current command
      -- wrappers do not expose this amount-first branch to users.
      begin
        requested_amount := (line_value->>'amount')::numeric;
      exception when others then
        raise exception 'Legacy Credit Note amount is invalid';
      end;
      if requested_amount <= 0 then
        raise exception 'Legacy Credit Note amount must be greater than zero';
      end if;

      select coalesce(sum(line.total_amount), 0)
        into prior_legacy_credit
        from public.credit_note_lines line
        join public.credit_notes note
          on note.workspace_id = line.workspace_id
         and note.id = line.credit_note_id
       where note.workspace_id = p_workspace_id
         and note.invoice_id = p_invoice_id
         and note.status = 'issued';

      if requested_amount + prior_legacy_credit > invoice_record.total_amount then
        raise exception 'Credit Note amount exceeds the uncredited Invoice balance';
      end if;

      gross_value := requested_amount;
      discount_value := 0;
      net_value := requested_amount;
      vat_value := 0;
      total_value := requested_amount;

      insert into public.credit_note_lines (
        id, workspace_id, credit_note_id, line_number, line_type, code_snapshot, description_snapshot,
        quantity, unit_price, gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        line_id, p_workspace_id, p_credit_note_id, line_number_value, 'manual', 'ADJUSTMENT',
        'Credit against Invoice ' || invoice_record.number, 1, requested_amount,
        gross_value, 0, net_value, 0, 0, total_value
      );
    end if;

    gross_total := gross_total + gross_value;
    discount_total := discount_total + discount_value;
    net_total := net_total + net_value;
    vat_total := vat_total + vat_value;
    credit_total := credit_total + total_value;
  end loop;

  return jsonb_build_object(
    'gross', round(gross_total, 4),
    'discount', round(discount_total, 4),
    'net', round(net_total, 4),
    'vat', round(vat_total, 4),
    'total', round(credit_total, 4),
    'lineCount', line_number_value
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Delivery Note source uniqueness + issue-time serialization
-- ---------------------------------------------------------------------------

create unique index delivery_note_lines_one_invoice_source_per_note_idx
  on public.delivery_note_lines(workspace_id, delivery_note_id, source_invoice_line_id)
  where source_invoice_line_id is not null;

create unique index delivery_note_lines_one_sale_source_per_note_idx
  on public.delivery_note_lines(workspace_id, delivery_note_id, source_sale_line_id)
  where source_sale_line_id is not null;

create or replace function private.enforce_delivery_note_issue_quantities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'draft' and new.status = 'issued' then
    if new.source_invoice_id is not null then
      -- The parent Invoice is the serialization mutex for every Delivery Note issue
      -- against that Invoice. A concurrent issuer waits, then re-reads prior issued qty.
      perform 1
      from public.invoices invoice
      where invoice.workspace_id = new.workspace_id
        and invoice.id = new.source_invoice_id
      for update;
      if not found then
        raise exception 'Delivery Note source Invoice is unavailable';
      end if;

      if exists (
        select 1
        from public.delivery_note_lines current_line
        left join public.invoice_lines source
          on source.workspace_id = current_line.workspace_id
         and source.id = current_line.source_invoice_line_id
         and source.invoice_id = new.source_invoice_id
        where current_line.workspace_id = new.workspace_id
          and current_line.delivery_note_id = new.id
          and (current_line.source_invoice_line_id is null or source.id is null)
      ) then
        raise exception 'Delivery Note Invoice line is unavailable';
      end if;

      if exists (
        select 1
        from (
          select current_line.source_invoice_line_id as source_line_id,
                 sum(current_line.quantity) as current_quantity
          from public.delivery_note_lines current_line
          where current_line.workspace_id = new.workspace_id
            and current_line.delivery_note_id = new.id
            and current_line.source_invoice_line_id is not null
          group by current_line.source_invoice_line_id
        ) current_lines
        join public.invoice_lines source
          on source.workspace_id = new.workspace_id
         and source.id = current_lines.source_line_id
         and source.invoice_id = new.source_invoice_id
        where current_lines.current_quantity + coalesce((
          select sum(prior_line.quantity)
          from public.delivery_note_lines prior_line
          join public.delivery_notes prior_note
            on prior_note.workspace_id = prior_line.workspace_id
           and prior_note.id = prior_line.delivery_note_id
          where prior_line.workspace_id = new.workspace_id
            and prior_line.source_invoice_line_id = current_lines.source_line_id
            and prior_note.status = 'issued'
            and prior_note.id <> new.id
        ), 0) > source.quantity
      ) then
        raise exception 'Delivery Note quantity exceeds the undelivered Invoice quantity';
      end if;
    elsif new.source_sale_id is not null then
      -- The parent Sale is the serialization mutex for every Delivery Note issue
      -- against that Sale.
      perform 1
      from public.sales sale
      where sale.workspace_id = new.workspace_id
        and sale.id = new.source_sale_id
      for update;
      if not found then
        raise exception 'Delivery Note source Sale is unavailable';
      end if;

      if exists (
        select 1
        from public.delivery_note_lines current_line
        left join public.sale_lines source
          on source.workspace_id = current_line.workspace_id
         and source.id = current_line.source_sale_line_id
         and source.sale_id = new.source_sale_id
        where current_line.workspace_id = new.workspace_id
          and current_line.delivery_note_id = new.id
          and (current_line.source_sale_line_id is null or source.id is null)
      ) then
        raise exception 'Delivery Note Sale line is unavailable';
      end if;

      if exists (
        select 1
        from (
          select current_line.source_sale_line_id as source_line_id,
                 sum(current_line.quantity) as current_quantity
          from public.delivery_note_lines current_line
          where current_line.workspace_id = new.workspace_id
            and current_line.delivery_note_id = new.id
            and current_line.source_sale_line_id is not null
          group by current_line.source_sale_line_id
        ) current_lines
        join public.sale_lines source
          on source.workspace_id = new.workspace_id
         and source.id = current_lines.source_line_id
         and source.sale_id = new.source_sale_id
        where current_lines.current_quantity + coalesce((
          select sum(prior_line.quantity)
          from public.delivery_note_lines prior_line
          join public.delivery_notes prior_note
            on prior_note.workspace_id = prior_line.workspace_id
           and prior_note.id = prior_line.delivery_note_id
          where prior_line.workspace_id = new.workspace_id
            and prior_line.source_sale_line_id = current_lines.source_line_id
            and prior_note.status = 'issued'
            and prior_note.id <> new.id
        ), 0) > source.quantity
      ) then
        raise exception 'Delivery Note quantity exceeds the undelivered Sale quantity';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists delivery_notes_issue_quantity_guard on public.delivery_notes;
create trigger delivery_notes_issue_quantity_guard
before update of status on public.delivery_notes
for each row execute function private.enforce_delivery_note_issue_quantities();

-- ---------------------------------------------------------------------------
-- Invoice Due Date is assigned at issue time from workspace Payment Terms
-- ---------------------------------------------------------------------------

create or replace function private.assign_invoice_issue_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings_record public.workspace_settings;
  workspace_record public.workspaces;
  customer_record public.customers;
  issue_date date := current_date;
begin
  if old.status = 'draft'::public.invoice_status
     and new.status in ('sent'::public.invoice_status, 'overdue'::public.invoice_status, 'paid'::public.invoice_status) then
    select * into settings_record
    from public.workspace_settings settings
    where settings.workspace_id = new.workspace_id;

    select * into workspace_record
    from public.workspaces workspace
    where workspace.id = new.workspace_id;

    select * into customer_record
    from public.customers customer
    where customer.workspace_id = new.workspace_id
      and customer.id = new.customer_id;

    new.number := private.next_business_document_number(
      new.workspace_id,
      'invoice',
      coalesce(settings_record.invoice_prefix, 'INV'),
      issue_date
    );
    new.issued_at := issue_date;

    -- Drafts deliberately carry no legal due date. At issue, assign the workspace
    -- terms if the due date is missing (or repair a date that predates issue).
    if new.due_at is null or new.due_at < issue_date then
      new.due_at := issue_date + coalesce(settings_record.payment_terms_days, 14);
    end if;

    new.supply_date := coalesce(new.supply_date, issue_date);
    new.supplier_name_snapshot := coalesce(nullif(workspace_record.legal_name, ''), workspace_record.name);
    new.supplier_address_snapshot := settings_record.business_address;
    new.supplier_vat_number_snapshot := settings_record.vat_number;
    new.supplier_registration_number_snapshot := settings_record.company_registration_number;
    new.customer_address_snapshot := customer_record.address;
    new.customer_vat_number_snapshot := customer_record.vat_number;
    new.legal_snapshot_at := now();
    new.final_number_assigned_at := now();
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Base currency becomes immutable once financial activity exists
-- ---------------------------------------------------------------------------

create or replace function private.prevent_workspace_currency_change_after_financial_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.currency is distinct from new.currency and (
       exists (select 1 from public.invoices invoice where invoice.workspace_id = old.workspace_id)
    or exists (select 1 from public.payments payment where payment.workspace_id = old.workspace_id)
    or exists (select 1 from public.sales sale where sale.workspace_id = old.workspace_id)
    or exists (select 1 from public.supplier_payables payable where payable.workspace_id = old.workspace_id)
    or exists (select 1 from public.supplier_payments payment where payment.workspace_id = old.workspace_id)
    or exists (select 1 from public.bank_transactions transaction where transaction.workspace_id = old.workspace_id)
  ) then
    raise exception 'Workspace currency cannot change after financial activity exists';
  end if;
  return new;
end;
$function$;

drop trigger if exists workspace_settings_currency_lock on public.workspace_settings;
create trigger workspace_settings_currency_lock
before update of currency on public.workspace_settings
for each row execute function private.prevent_workspace_currency_change_after_financial_activity();

-- ---------------------------------------------------------------------------
-- Internal Note retry safety
-- ---------------------------------------------------------------------------

create or replace function public.add_business_document_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_note text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  note_record public.business_document_notes;
  existing_note public.business_document_notes;
  document_number text;
begin
  if p_document_type not in ('invoice','credit_note','delivery_note') then
    raise exception 'Business document type is invalid';
  end if;
  if p_note is null or char_length(trim(p_note)) not between 1 and 2000 then
    raise exception 'Business document note is invalid';
  end if;
  if not private.accounts_actor_can_write(p_workspace_id,p_actor_user_id,'edit') then
    raise exception 'Accounts document note access denied';
  end if;

  select * into existing_note
  from public.business_document_notes note
  where note.id = p_note_id;
  if existing_note.id is not null then
    if existing_note.workspace_id <> p_workspace_id
       or existing_note.document_type <> p_document_type
       or existing_note.document_id <> p_document_id
       or existing_note.note <> trim(p_note) then
      raise exception 'Business document note identity conflict';
    end if;
    return jsonb_build_object('note', to_jsonb(existing_note));
  end if;

  if p_document_type='invoice' then
    select number into document_number from public.invoices where workspace_id=p_workspace_id and id=p_document_id;
  elsif p_document_type='credit_note' then
    select number into document_number from public.credit_notes where workspace_id=p_workspace_id and id=p_document_id;
  else
    select number into document_number from public.delivery_notes where workspace_id=p_workspace_id and id=p_document_id;
  end if;
  if document_number is null then raise exception 'Business document not found'; end if;

  insert into public.business_document_notes(id,workspace_id,document_type,document_id,note,created_by)
  values(p_note_id,p_workspace_id,p_document_type,p_document_id,trim(p_note),p_actor_user_id)
  returning * into note_record;

  insert into public.activity_items(workspace_id,actor_user_id,action,detail,tone,entity_type,entity_id,command_id,metadata)
  values(p_workspace_id,p_actor_user_id,'Document note added',document_number || ' · ' || left(trim(p_note),120),
    'neutral',p_document_type,p_document_id::text,p_command_id,
    jsonb_build_object('document_type',p_document_type,'document_number',document_number));

  return jsonb_build_object('note',to_jsonb(note_record));
end;
$function$;

revoke all on function public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Retire browser-executable legacy financial bypasses and private helpers
-- ---------------------------------------------------------------------------

revoke all on function public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text) from public, anon, authenticated;
revoke all on function public.reconcile_bank_transaction(uuid,uuid,uuid) from public, anon, authenticated;

revoke all on function private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.refresh_invoice_payment_status(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function private.write_delivery_note_lines(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function private.write_manual_invoice_lines(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function private.enforce_delivery_note_issue_quantities() from public, anon, authenticated;
revoke all on function private.assign_invoice_issue_identity() from public, anon, authenticated;
revoke all on function private.prevent_workspace_currency_change_after_financial_activity() from public, anon, authenticated;

grant execute on function private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamptz) to service_role;
grant execute on function private.refresh_invoice_payment_status(uuid,uuid,uuid) to service_role;
grant execute on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function private.write_delivery_note_lines(uuid,uuid,text,uuid,jsonb) to service_role;
grant execute on function private.write_manual_invoice_lines(uuid,uuid,jsonb) to service_role;

-- Legacy definitions are intentionally retained for migration/history readability;
-- they are no longer executable by browser roles.
