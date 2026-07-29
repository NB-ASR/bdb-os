begin;

create or replace function private.accounts_actor_can_write(
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
    'accounts',
    target_action
  );
$$;

create or replace function private.write_manual_invoice_lines(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_value jsonb;
  line_id uuid;
  line_number_value integer := 0;
  description_value text;
  code_value text;
  quantity_value numeric;
  unit_price_value numeric;
  discount_value numeric;
  vat_rate_value numeric;
  gross_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  gross_total numeric := 0;
  discount_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'An Invoice must contain between 1 and 100 lines';
  end if;

  delete from public.invoice_lines line
  where line.workspace_id = p_workspace_id and line.invoice_id = p_invoice_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin
      line_id := (line_value->>'id')::uuid;
    exception when others then
      raise exception 'Invoice line identity is invalid';
    end;
    description_value := trim(coalesce(line_value->>'description', ''));
    code_value := trim(coalesce(line_value->>'code', ''));
    if description_value = '' or char_length(description_value) > 240 then raise exception 'Invoice line description is invalid'; end if;
    if code_value = '' then code_value := 'LINE-' || lpad(line_number_value::text, 2, '0'); end if;
    if char_length(code_value) > 64 then raise exception 'Invoice line code is invalid'; end if;

    begin
      quantity_value := (line_value->>'quantity')::numeric;
      unit_price_value := (line_value->>'unitPrice')::numeric;
      discount_value := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
      vat_rate_value := coalesce(nullif(line_value->>'vatRate', '')::numeric, 0);
    exception when others then
      raise exception 'Invoice line amount is invalid';
    end;

    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then raise exception 'Invoice line quantity is invalid'; end if;
    if unit_price_value is null or unit_price_value < 0 then raise exception 'Invoice line price is invalid'; end if;
    if vat_rate_value < 0 or vat_rate_value > 100 then raise exception 'Invoice line VAT rate is invalid'; end if;

    gross_value := round(quantity_value * unit_price_value, 4);
    if discount_value < 0 or discount_value > gross_value then raise exception 'Invoice line discount is invalid'; end if;
    total_value := round(gross_value - discount_value, 4);
    vat_value := case when vat_rate_value = 0 then 0 else round(total_value * vat_rate_value / (100 + vat_rate_value), 4) end;
    net_value := round(total_value - vat_value, 4);

    insert into public.invoice_lines (
      id, workspace_id, invoice_id, line_number, line_type,
      code_snapshot, description_snapshot, quantity, unit_price,
      gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
    ) values (
      line_id, p_workspace_id, p_invoice_id, line_number_value, 'manual',
      code_value, description_value, quantity_value, unit_price_value,
      gross_value, discount_value, net_value, vat_rate_value, vat_value, total_value
    );

    gross_total := gross_total + gross_value;
    discount_total := discount_total + discount_value;
    net_total := net_total + net_value;
    vat_total := vat_total + vat_value;
    invoice_total := invoice_total + total_value;
  end loop;

  return jsonb_build_object(
    'gross', round(gross_total, 4),
    'discount', round(discount_total, 4),
    'net', round(net_total, 4),
    'vat', round(vat_total, 4),
    'total', round(invoice_total, 4),
    'lineCount', line_number_value
  );
end;
$$;

create or replace function private.refresh_invoice_payment_status(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_record public.invoices;
  allocated_value numeric;
  outstanding_value numeric;
begin
  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then return; end if;

  select coalesce(sum(allocation.amount_delta), 0) into allocated_value
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id = allocation.workspace_id and payment.id = allocation.payment_id
  where allocation.workspace_id = p_workspace_id
    and allocation.invoice_id = p_invoice_id
    and payment.status = 'posted';
  outstanding_value := greatest(round(invoice_record.total_amount - allocated_value, 4), 0);

  update public.invoices
  set status = case
        when outstanding_value = 0 then 'paid'::public.invoice_status
        when due_at < current_date then 'overdue'::public.invoice_status
        else 'sent'::public.invoice_status
      end,
      updated_by = p_actor_user_id
  where workspace_id = p_workspace_id and id = p_invoice_id;
end;
$$;

create or replace function public.apply_invoice_command(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_source_sale_id uuid default null,
  p_customer_id uuid default null,
  p_due_at date default null,
  p_description text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  invoice_record public.invoices;
  sale_record public.sales;
  customer_record public.customers;
  totals jsonb;
  prefix_value text;
  currency_value text;
  invoice_number text;
  permission_action text;
  activity_action text;
  line_count integer;
  allocated_value numeric;
begin
  if p_action not in ('create_manual', 'create_from_sale', 'update', 'issue', 'void') then raise exception 'Unsupported Invoice action'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Invoice idempotency key is invalid'; end if;

  select receipt.result into previous_result
  from public.accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  permission_action := case
    when p_action in ('create_manual', 'create_from_sale') then 'create'
    when p_action = 'update' then 'edit'
    else 'approve'
  end;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then raise exception 'Accounts Invoice access denied'; end if;

  if p_action in ('create_manual', 'create_from_sale') then
    if exists (select 1 from public.invoices where id = p_invoice_id) then raise exception 'Invoice identity conflict'; end if;
    select upper(regexp_replace(coalesce(settings.invoice_prefix, 'INV'), '[^A-Za-z0-9]', '', 'g')),
           upper(settings.currency)
      into prefix_value, currency_value
    from public.workspace_settings settings
    where settings.workspace_id = p_workspace_id;
    prefix_value := coalesce(nullif(prefix_value, ''), 'INV');
    currency_value := coalesce(currency_value, 'EUR');
    invoice_number := left(prefix_value, 12) || '-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(right(replace(p_invoice_id::text, '-', ''), 8));

    if p_action = 'create_from_sale' then
      select * into sale_record
      from public.sales sale
      where sale.workspace_id = p_workspace_id and sale.id = p_source_sale_id
      for update;
      if sale_record.id is null or sale_record.status <> 'completed' then raise exception 'Completed Sale is unavailable for invoicing'; end if;
      if sale_record.customer_id is null then raise exception 'A Sale must have a Customer before invoicing'; end if;
      if exists (
        select 1 from public.invoices invoice
        where invoice.workspace_id = p_workspace_id and invoice.source_sale_id = p_source_sale_id and invoice.status <> 'void'::public.invoice_status
      ) then raise exception 'This Sale already has an active Invoice'; end if;
      select * into customer_record from public.customers customer
      where customer.workspace_id = p_workspace_id and customer.id = sale_record.customer_id;
      currency_value := sale_record.currency;

      insert into public.invoices (
        id, workspace_id, number, customer_id, source_sale_id, issued_at, due_at,
        description, amount, status, currency, customer_code_snapshot, customer_name_snapshot,
        gross_amount, discount_amount, net_amount, vat_amount, total_amount,
        notes, version, created_by, updated_by
      ) values (
        p_invoice_id, p_workspace_id, invoice_number, sale_record.customer_id, sale_record.id, current_date,
        coalesce(p_due_at, current_date + 14), coalesce(nullif(trim(p_description), ''), 'Sale ' || sale_record.reference),
        sale_record.total_amount, 'draft', currency_value, customer_record.code, customer_record.name,
        sale_record.gross_amount, sale_record.discount_amount, sale_record.net_amount, sale_record.vat_amount, sale_record.total_amount,
        nullif(trim(p_notes), ''), 1, p_actor_user_id, p_actor_user_id
      ) returning * into invoice_record;

      insert into public.invoice_lines (
        id, workspace_id, invoice_id, line_number, line_type, source_sale_line_id,
        product_id, service_id, code_snapshot, description_snapshot, quantity, unit_price,
        gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      )
      select gen_random_uuid(), line.workspace_id, p_invoice_id, line.line_number, line.line_type, line.id,
             line.product_id, line.service_id, line.code_snapshot, line.description_snapshot, line.quantity, line.unit_price,
             line.gross_amount, line.discount_amount, line.net_amount, line.vat_rate, line.vat_amount, line.total_amount
      from public.sale_lines line
      where line.workspace_id = p_workspace_id and line.sale_id = sale_record.id
      order by line.line_number;
      activity_action := 'Sale Invoice draft created';
    else
      select * into customer_record from public.customers customer
      where customer.workspace_id = p_workspace_id and customer.id = p_customer_id and customer.status = 'active';
      if customer_record.id is null then raise exception 'Invoice Customer is unavailable'; end if;
      if p_description is null or char_length(trim(p_description)) not between 1 and 500 then raise exception 'Invoice description is invalid'; end if;

      insert into public.invoices (
        id, workspace_id, number, customer_id, issued_at, due_at, description, amount, status,
        currency, customer_code_snapshot, customer_name_snapshot, gross_amount, discount_amount,
        net_amount, vat_amount, total_amount, notes, version, created_by, updated_by
      ) values (
        p_invoice_id, p_workspace_id, invoice_number, customer_record.id, current_date,
        coalesce(p_due_at, current_date + 14), trim(p_description), 0, 'draft', currency_value,
        customer_record.code, customer_record.name, 0, 0, 0, 0, 0,
        nullif(trim(p_notes), ''), 1, p_actor_user_id, p_actor_user_id
      ) returning * into invoice_record;
      totals := private.write_manual_invoice_lines(p_workspace_id, p_invoice_id, p_lines);
      update public.invoices
      set gross_amount = (totals->>'gross')::numeric,
          discount_amount = (totals->>'discount')::numeric,
          net_amount = (totals->>'net')::numeric,
          vat_amount = (totals->>'vat')::numeric,
          total_amount = (totals->>'total')::numeric,
          amount = (totals->>'total')::numeric
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Manual Invoice draft created';
    end if;
  else
    select * into invoice_record
    from public.invoices invoice
    where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
    for update;
    if invoice_record.id is null then raise exception 'Invoice not found'; end if;
    if p_expected_version is null or invoice_record.version <> p_expected_version then raise exception 'Invoice changed on another device; refresh before saving'; end if;

    if p_action = 'update' then
      if invoice_record.status <> 'draft'::public.invoice_status then raise exception 'Only draft Invoices can be edited'; end if;
      if p_due_at is not null and p_due_at < invoice_record.issued_at then raise exception 'Invoice due date is invalid'; end if;
      if p_description is not null and char_length(trim(p_description)) not between 1 and 500 then raise exception 'Invoice description is invalid'; end if;
      if invoice_record.source_sale_id is not null and p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
        raise exception 'Sale-derived Invoice lines cannot be edited';
      end if;
      if invoice_record.source_sale_id is null and p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
        totals := private.write_manual_invoice_lines(p_workspace_id, p_invoice_id, p_lines);
      end if;
      update public.invoices
      set due_at = coalesce(p_due_at, due_at),
          description = coalesce(nullif(trim(p_description), ''), description),
          notes = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
          gross_amount = case when totals is null then gross_amount else (totals->>'gross')::numeric end,
          discount_amount = case when totals is null then discount_amount else (totals->>'discount')::numeric end,
          net_amount = case when totals is null then net_amount else (totals->>'net')::numeric end,
          vat_amount = case when totals is null then vat_amount else (totals->>'vat')::numeric end,
          total_amount = case when totals is null then total_amount else (totals->>'total')::numeric end,
          amount = case when totals is null then amount else (totals->>'total')::numeric end,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice draft updated';
    elsif p_action = 'issue' then
      if invoice_record.status <> 'draft'::public.invoice_status then raise exception 'Only draft Invoices can be issued'; end if;
      select count(*) into line_count from public.invoice_lines where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
      if line_count < 1 then raise exception 'Invoice has no lines'; end if;
      update public.invoices
      set status = 'sent', sent_at = now(), issued_by = p_actor_user_id,
          updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice issued';
    else
      if invoice_record.status in ('paid'::public.invoice_status, 'void'::public.invoice_status) then raise exception 'Invoice is unavailable for voiding'; end if;
      if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Invoice void reason is required'; end if;
      select coalesce(sum(amount_delta), 0) into allocated_value from public.payment_allocations
      where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
      if allocated_value <> 0 then raise exception 'Reverse Invoice Payment allocations before voiding'; end if;
      update public.invoices
      set status = 'void', voided_at = now(), voided_by = p_actor_user_id,
          void_reason = trim(p_reason), updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice voided';
    end if;
  end if;

  select count(*) into line_count from public.invoice_lines where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
  command_result := jsonb_build_object(
    'action', p_action,
    'invoice', to_jsonb(invoice_record),
    'lineCount', line_count
  );
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (
    p_workspace_id, trim(p_idempotency_key), 'invoice', p_invoice_id,
    case p_action when 'create_manual' then 'create_manual_invoice' when 'create_from_sale' then 'create_sale_invoice'
      when 'update' then 'update_invoice' when 'issue' then 'issue_invoice' else 'void_invoice' end,
    command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    invoice_record.number || ' · ' || invoice_record.currency || ' ' || invoice_record.total_amount::text,
    case when p_action = 'void' then 'neutral' when p_action = 'issue' then 'green' else 'gold' end,
    'invoice', p_invoice_id::text, p_command_id,
    jsonb_build_object('invoice_number', invoice_record.number, 'customer_id', invoice_record.customer_id, 'source_sale_id', invoice_record.source_sale_id, 'status', invoice_record.status, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

revoke all on function public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text) to service_role;

commit;
