begin;

-- BDB OS V1 Accounts discipline:
-- 1. New direct Invoice lines must come from active Products or Services.
-- 2. Catalogue price and VAT are authoritative; the user may only apply a percentage discount.
-- 3. Credit Notes reverse real source quantities (including a full cancellation), never an arbitrary money amount.
-- 4. The business-document index keeps the original Invoice total separate from the running balance.

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
  line_type_value text;
  product_record public.products;
  service_record public.services;
  product_id_value uuid;
  service_id_value uuid;
  description_value text;
  code_value text;
  quantity_value numeric;
  unit_price_value numeric;
  discount_percent_value numeric;
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
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'An Invoice must contain between 1 and 100 lines';
  end if;

  delete from public.invoice_lines line
  where line.workspace_id = p_workspace_id
    and line.invoice_id = p_invoice_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin
      line_id := (line_value->>'id')::uuid;
    exception when others then
      raise exception 'Invoice line identity is invalid';
    end;

    line_type_value := nullif(trim(line_value->>'lineType'), '');
    if line_type_value not in ('product', 'service') then
      raise exception 'Invoice lines must use a catalogue Product or Service';
    end if;

    product_id_value := null;
    service_id_value := null;
    product_record := null;
    service_record := null;

    if line_type_value = 'product' then
      begin
        product_id_value := (line_value->>'productId')::uuid;
      exception when others then
        raise exception 'Invoice Product identity is invalid';
      end;
      select * into product_record
      from public.products product
      where product.workspace_id = p_workspace_id
        and product.id = product_id_value
        and product.status = 'active';
      if product_record.id is null then raise exception 'Invoice Product is unavailable'; end if;
      if product_record.selling_price is null then raise exception 'Invoice Product catalogue price is required'; end if;
      code_value := product_record.sku::text;
      description_value := product_record.name;
      unit_price_value := product_record.selling_price;
      vat_rate_value := coalesce(product_record.vat_rate, 0);
    else
      begin
        service_id_value := (line_value->>'serviceId')::uuid;
      exception when others then
        raise exception 'Invoice Service identity is invalid';
      end;
      select * into service_record
      from public.services service
      where service.workspace_id = p_workspace_id
        and service.id = service_id_value
        and service.status = 'active';
      if service_record.id is null then raise exception 'Invoice Service is unavailable'; end if;
      if service_record.price is null then raise exception 'Invoice Service catalogue price is required'; end if;
      code_value := service_record.code::text;
      description_value := service_record.name;
      unit_price_value := service_record.price;
      vat_rate_value := coalesce(service_record.vat_rate, 0);
    end if;

    begin
      quantity_value := (line_value->>'quantity')::numeric;
    exception when others then
      raise exception 'Invoice line quantity is invalid';
    end;
    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then
      raise exception 'Invoice line quantity is invalid';
    end if;
    if unit_price_value < 0 then raise exception 'Invoice catalogue price is invalid'; end if;
    if vat_rate_value < 0 or vat_rate_value > 100 then raise exception 'Invoice catalogue VAT rate is invalid'; end if;

    gross_value := round(quantity_value * unit_price_value, 4);

    -- New clients send Discount %. For an already-queued Product/Service command
    -- created before this release, retain the old absolute-discount payload as a
    -- compatibility fallback. Manual lines remain rejected.
    if nullif(line_value->>'discountPercent', '') is not null then
      begin
        discount_percent_value := (line_value->>'discountPercent')::numeric;
      exception when others then
        raise exception 'Invoice line discount percentage is invalid';
      end;
      if discount_percent_value < 0 or discount_percent_value > 100 then
        raise exception 'Invoice line discount percentage is invalid';
      end if;
      discount_value := round(gross_value * discount_percent_value / 100, 4);
    else
      begin
        discount_value := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
      exception when others then
        raise exception 'Invoice line discount is invalid';
      end;
      if discount_value < 0 or discount_value > gross_value then
        raise exception 'Invoice line discount is invalid';
      end if;
    end if;

    net_value := round(gross_value - discount_value, 4);
    vat_value := case
      when vat_rate_value = 0 then 0
      else round(net_value * vat_rate_value / 100, 4)
    end;
    total_value := round(net_value + vat_value, 4);

    insert into public.invoice_lines (
      id, workspace_id, invoice_id, line_number, line_type,
      product_id, service_id, code_snapshot, description_snapshot,
      quantity, unit_price, gross_amount, discount_amount,
      net_amount, vat_rate, vat_amount, total_amount
    ) values (
      line_id, p_workspace_id, p_invoice_id, line_number_value, line_type_value,
      product_id_value, service_id_value, code_value, description_value,
      quantity_value, unit_price_value, gross_value, discount_value,
      net_value, vat_rate_value, vat_value, total_value
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

revoke all on function private.write_manual_invoice_lines(uuid,uuid,jsonb)
from public, anon, authenticated;
grant execute on function private.write_manual_invoice_lines(uuid,uuid,jsonb)
to service_role;

create or replace function private.write_credit_note_lines(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1 then
    raise exception 'A Credit Note must contain at least one source quantity';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where nullif(line->>'amount', '') is not null
  ) then
    raise exception 'Credit Notes cannot deduct an arbitrary amount; fully cancel the Invoice or reverse a genuine Product or Service quantity';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where nullif(line->>'sourceInvoiceLineId', '') is null
       or nullif(line->>'quantity', '') is null
  ) then
    raise exception 'Credit Note lines must reference an original Invoice line and quantity';
  end if;

  return private.write_credit_note_lines_by_quantity(
    p_workspace_id,
    p_credit_note_id,
    p_invoice_id,
    p_lines
  );
end;
$$;

revoke all on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb)
from public, anon, authenticated;
grant execute on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb)
to service_role;

-- The former money-first helper remains only as historical migration code. Do
-- not expose a callable path that can create new arbitrary-amount credits.
revoke execute on function private.write_credit_note_amount_lines(uuid,uuid,uuid,numeric)
from service_role;

create or replace view public.business_document_index
with (security_invoker = true)
as
select
  invoice.workspace_id,
  'invoice'::text as document_type,
  invoice.id,
  invoice.number,
  invoice.customer_id,
  invoice.customer_name_snapshot as customer_name,
  invoice.issued_at as document_date,
  invoice.display_status as status,
  invoice.currency,
  invoice.total_amount as total_amount,
  invoice.outstanding_amount as balance_amount,
  invoice.id as source_invoice_id,
  invoice.source_sale_id,
  null::text as reason
from public.invoice_account_balances invoice
union all
select
  note.workspace_id,
  'credit_note'::text as document_type,
  note.id,
  note.number,
  note.customer_id,
  note.customer_name_snapshot as customer_name,
  note.issued_at as document_date,
  note.status,
  note.currency,
  note.total_amount,
  null::numeric as balance_amount,
  note.invoice_id as source_invoice_id,
  null::uuid as source_sale_id,
  note.reason
from public.credit_notes note
union all
select
  note.workspace_id,
  'delivery_note'::text as document_type,
  note.id,
  note.number,
  note.customer_id,
  note.customer_name_snapshot as customer_name,
  note.delivery_date as document_date,
  note.status,
  null::text as currency,
  null::numeric as total_amount,
  null::numeric as balance_amount,
  note.source_invoice_id,
  note.source_sale_id,
  null::text as reason
from public.delivery_notes note;

grant select on public.business_document_index to authenticated;

commit;
