begin;

-- Accounts Invoice polish V1
-- New direct-Invoice unit prices are VAT-exclusive. VAT is added on top after discount.
-- Due dates remain available on historical records, but new BDB OS Invoice drafts no
-- longer invent payment terms when the user did not specify any.
-- Sale-derived Invoices preserve the authoritative Sale pricing snapshots unchanged.

alter table public.invoices
  alter column due_at drop not null;

create or replace function private.default_invoice_without_due_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'draft'::public.invoice_status then
    new.due_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.default_invoice_without_due_date() from public, anon, authenticated;

drop trigger if exists invoices_default_without_due_date on public.invoices;
create trigger invoices_default_without_due_date
before insert on public.invoices
for each row execute function private.default_invoice_without_due_date();

-- Drafts are editable/non-authoritative, so remove the old invented due date.
-- Issued historical records are untouched.
update public.invoices
set due_at = null
where status = 'draft'::public.invoice_status;

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

    line_type_value := coalesce(nullif(trim(line_value->>'lineType'), ''), 'manual');
    if line_type_value not in ('product', 'service', 'manual') then raise exception 'Invoice line type is invalid'; end if;
    product_id_value := null;
    service_id_value := null;
    product_record := null;
    service_record := null;

    if line_type_value = 'product' then
      begin product_id_value := (line_value->>'productId')::uuid; exception when others then raise exception 'Invoice Product identity is invalid'; end;
      select * into product_record
      from public.products product
      where product.workspace_id = p_workspace_id and product.id = product_id_value and product.status = 'active';
      if product_record.id is null then raise exception 'Invoice Product is unavailable'; end if;
      code_value := product_record.sku::text;
      description_value := coalesce(nullif(trim(line_value->>'description'), ''), product_record.name);
      if nullif(line_value->>'unitPrice', '') is null and product_record.selling_price is null then raise exception 'Invoice Product selling price is required'; end if;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, product_record.selling_price);
      vat_rate_value := coalesce(nullif(line_value->>'vatRate', '')::numeric, product_record.vat_rate, 0);
    elsif line_type_value = 'service' then
      begin service_id_value := (line_value->>'serviceId')::uuid; exception when others then raise exception 'Invoice Service identity is invalid'; end;
      select * into service_record
      from public.services service
      where service.workspace_id = p_workspace_id and service.id = service_id_value and service.status = 'active';
      if service_record.id is null then raise exception 'Invoice Service is unavailable'; end if;
      code_value := service_record.code::text;
      description_value := coalesce(nullif(trim(line_value->>'description'), ''), service_record.name);
      if nullif(line_value->>'unitPrice', '') is null and service_record.price is null then raise exception 'Invoice Service price is required'; end if;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, service_record.price);
      vat_rate_value := coalesce(nullif(line_value->>'vatRate', '')::numeric, service_record.vat_rate, 0);
    else
      description_value := trim(coalesce(line_value->>'description', ''));
      code_value := trim(coalesce(line_value->>'code', ''));
      if code_value = '' then code_value := 'LINE-' || lpad(line_number_value::text, 2, '0'); end if;
      begin unit_price_value := (line_value->>'unitPrice')::numeric; exception when others then raise exception 'Invoice line price is invalid'; end;
      begin vat_rate_value := coalesce(nullif(line_value->>'vatRate', '')::numeric, 0); exception when others then raise exception 'Invoice line VAT rate is invalid'; end;
    end if;

    if description_value = '' or char_length(description_value) > 240 then raise exception 'Invoice line description is invalid'; end if;
    if code_value = '' or char_length(code_value) > 64 then raise exception 'Invoice line code is invalid'; end if;
    begin
      quantity_value := (line_value->>'quantity')::numeric;
      discount_value := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
    exception when others then
      raise exception 'Invoice line amount is invalid';
    end;
    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then raise exception 'Invoice line quantity is invalid'; end if;
    if unit_price_value is null or unit_price_value < 0 then raise exception 'Invoice line price is invalid'; end if;
    if vat_rate_value < 0 or vat_rate_value > 100 then raise exception 'Invoice line VAT rate is invalid'; end if;

    gross_value := round(quantity_value * unit_price_value, 4);
    if discount_value < 0 or discount_value > gross_value then raise exception 'Invoice line discount is invalid'; end if;

    -- Unit price is exclusive of VAT. Discount reduces the taxable amount first,
    -- then VAT is calculated and added on top.
    net_value := round(gross_value - discount_value, 4);
    vat_value := case when vat_rate_value = 0 then 0 else round(net_value * vat_rate_value / 100, 4) end;
    total_value := round(net_value + vat_value, 4);

    insert into public.invoice_lines (
      id, workspace_id, invoice_id, line_number, line_type,
      product_id, service_id, code_snapshot, description_snapshot, quantity, unit_price,
      gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
    ) values (
      line_id, p_workspace_id, p_invoice_id, line_number_value, line_type_value,
      product_id_value, service_id_value, code_value, description_value, quantity_value, unit_price_value,
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

-- Correct only direct draft Invoices created under the former VAT-inclusive
-- interpretation. Sale-derived drafts retain the Sale's authoritative snapshot.
with recalculated as (
  select
    line.workspace_id,
    line.id,
    round(line.quantity * line.unit_price, 4) as gross_amount,
    line.discount_amount,
    round((line.quantity * line.unit_price) - line.discount_amount, 4) as net_amount,
    round(((line.quantity * line.unit_price) - line.discount_amount) * line.vat_rate / 100, 4) as vat_amount
  from public.invoice_lines line
  join public.invoices invoice
    on invoice.workspace_id = line.workspace_id
   and invoice.id = line.invoice_id
  where invoice.status = 'draft'::public.invoice_status
    and invoice.source_sale_id is null
), updated_lines as (
  update public.invoice_lines line
  set gross_amount = recalculated.gross_amount,
      net_amount = recalculated.net_amount,
      vat_amount = recalculated.vat_amount,
      total_amount = round(recalculated.net_amount + recalculated.vat_amount, 4)
  from recalculated
  where line.workspace_id = recalculated.workspace_id
    and line.id = recalculated.id
  returning line.workspace_id, line.invoice_id
), draft_totals as (
  select
    line.workspace_id,
    line.invoice_id,
    round(sum(line.gross_amount), 4) as gross_amount,
    round(sum(line.discount_amount), 4) as discount_amount,
    round(sum(line.net_amount), 4) as net_amount,
    round(sum(line.vat_amount), 4) as vat_amount,
    round(sum(line.total_amount), 4) as total_amount
  from public.invoice_lines line
  join (select distinct workspace_id, invoice_id from updated_lines) changed
    on changed.workspace_id = line.workspace_id
   and changed.invoice_id = line.invoice_id
  group by line.workspace_id, line.invoice_id
)
update public.invoices invoice
set gross_amount = totals.gross_amount,
    discount_amount = totals.discount_amount,
    net_amount = totals.net_amount,
    vat_amount = totals.vat_amount,
    total_amount = totals.total_amount,
    amount = round(totals.total_amount, 2),
    updated_at = now(),
    version = invoice.version + 1
from draft_totals totals
where invoice.workspace_id = totals.workspace_id
  and invoice.id = totals.invoice_id
  and invoice.status = 'draft'::public.invoice_status
  and invoice.source_sale_id is null;

commit;
