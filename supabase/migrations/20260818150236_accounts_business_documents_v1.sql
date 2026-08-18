begin;

-- BDB OS V1 Business Documents
-- Keeps the existing Invoice/Payment engine authoritative while adding legal identity,
-- sequential issue numbering, Credit Notes and Delivery Notes.

alter table public.workspace_settings
  add column if not exists business_address text,
  add column if not exists vat_number text,
  add column if not exists company_registration_number text,
  add column if not exists credit_note_prefix text not null default 'CN',
  add column if not exists delivery_note_prefix text not null default 'DN',
  add column if not exists payment_terms_days integer not null default 14,
  add column if not exists document_footer text;

alter table public.workspace_settings
  drop constraint if exists workspace_settings_business_address_length,
  drop constraint if exists workspace_settings_vat_number_length,
  drop constraint if exists workspace_settings_registration_length,
  drop constraint if exists workspace_settings_credit_note_prefix_check,
  drop constraint if exists workspace_settings_delivery_note_prefix_check,
  drop constraint if exists workspace_settings_payment_terms_days_check,
  drop constraint if exists workspace_settings_document_footer_length,
  add constraint workspace_settings_business_address_length check (business_address is null or char_length(business_address) <= 1000),
  add constraint workspace_settings_vat_number_length check (vat_number is null or char_length(vat_number) <= 64),
  add constraint workspace_settings_registration_length check (company_registration_number is null or char_length(company_registration_number) <= 64),
  add constraint workspace_settings_credit_note_prefix_check check (credit_note_prefix ~ '^[A-Z0-9-]{1,8}$'),
  add constraint workspace_settings_delivery_note_prefix_check check (delivery_note_prefix ~ '^[A-Z0-9-]{1,8}$'),
  add constraint workspace_settings_payment_terms_days_check check (payment_terms_days between 0 and 365),
  add constraint workspace_settings_document_footer_length check (document_footer is null or char_length(document_footer) <= 1000);

alter table public.customers
  add column if not exists vat_number text;
alter table public.customers
  drop constraint if exists customers_vat_number_length,
  add constraint customers_vat_number_length check (vat_number is null or char_length(vat_number) <= 64);

alter table public.invoices
  add column if not exists supplier_name_snapshot text,
  add column if not exists supplier_address_snapshot text,
  add column if not exists supplier_vat_number_snapshot text,
  add column if not exists supplier_registration_number_snapshot text,
  add column if not exists customer_address_snapshot text,
  add column if not exists customer_vat_number_snapshot text,
  add column if not exists supply_date date,
  add column if not exists legal_snapshot_at timestamptz,
  add column if not exists final_number_assigned_at timestamptz;

create table public.business_document_sequences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'credit_note', 'delivery_note')),
  series_year integer not null check (series_year between 2000 and 9999),
  prefix text not null check (prefix ~ '^[A-Z0-9-]{1,12}$'),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, document_type, series_year, prefix)
);

alter table public.business_document_sequences enable row level security;
revoke all on public.business_document_sequences from public, anon, authenticated;

create or replace function private.next_business_document_number(
  p_workspace_id uuid,
  p_document_type text,
  p_prefix text,
  p_issue_date date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_prefix text := upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9-]', '', 'g'));
  target_year integer := extract(year from coalesce(p_issue_date, current_date))::integer;
  next_value bigint;
begin
  if p_document_type not in ('invoice', 'credit_note', 'delivery_note') then
    raise exception 'Unsupported business document type';
  end if;
  if normalized_prefix = '' or char_length(normalized_prefix) > 12 then
    raise exception 'Business document prefix is invalid';
  end if;

  insert into public.business_document_sequences (
    workspace_id, document_type, series_year, prefix, last_value, updated_at
  ) values (
    p_workspace_id, p_document_type, target_year, normalized_prefix, 1, now()
  )
  on conflict (workspace_id, document_type, series_year, prefix) do update
  set last_value = public.business_document_sequences.last_value + 1,
      updated_at = now()
  returning last_value into next_value;

  return normalized_prefix || '-' || target_year::text || '-' || lpad(next_value::text, 6, '0');
end;
$$;

revoke all on function private.next_business_document_number(uuid,text,text,date) from public, anon, authenticated;
grant execute on function private.next_business_document_number(uuid,text,text,date) to service_role;

create or replace function private.assign_invoice_issue_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_record public.workspace_settings;
  workspace_record public.workspaces;
  customer_record public.customers;
  issue_date date := current_date;
begin
  if old.status = 'draft'::public.invoice_status
     and new.status in ('sent'::public.invoice_status, 'overdue'::public.invoice_status, 'paid'::public.invoice_status) then
    select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
    select * into workspace_record from public.workspaces where id = new.workspace_id;
    select * into customer_record from public.customers where workspace_id = new.workspace_id and id = new.customer_id;

    new.number := private.next_business_document_number(
      new.workspace_id,
      'invoice',
      coalesce(settings_record.invoice_prefix, 'INV'),
      issue_date
    );
    new.issued_at := issue_date;
    if new.due_at < issue_date then
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
$$;

drop trigger if exists invoices_assign_issue_identity on public.invoices;
create trigger invoices_assign_issue_identity
before update on public.invoices
for each row execute function private.assign_invoice_issue_identity();

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
    total_value := round(gross_value - discount_value, 4);
    vat_value := case when vat_rate_value = 0 then 0 else round(total_value * vat_rate_value / (100 + vat_rate_value), 4) end;
    net_value := round(total_value - vat_value, 4);

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

create table public.credit_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text not null,
  invoice_id uuid not null,
  customer_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  status text not null default 'draft' check (status in ('draft', 'issued')),
  issued_at date,
  supplier_name_snapshot text,
  supplier_address_snapshot text,
  supplier_vat_number_snapshot text,
  supplier_registration_number_snapshot text,
  customer_name_snapshot text not null,
  customer_address_snapshot text,
  customer_vat_number_snapshot text,
  gross_amount numeric(14,4) not null default 0 check (gross_amount >= 0),
  discount_amount numeric(14,4) not null default 0 check (discount_amount >= 0),
  net_amount numeric(14,4) not null default 0 check (net_amount >= 0),
  vat_amount numeric(14,4) not null default 0 check (vat_amount >= 0),
  total_amount numeric(14,4) not null default 0 check (total_amount >= 0),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  issued_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at_timestamp timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  constraint credit_notes_issue_shape check (
    (status = 'draft' and issued_by is null and issued_at_timestamp is null)
    or (status = 'issued' and issued_by is not null and issued_at is not null and issued_at_timestamp is not null)
  ),
  constraint credit_notes_totals_check check (
    discount_amount <= gross_amount and round(net_amount + vat_amount, 4) = round(total_amount, 4)
  )
);

create table public.credit_note_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credit_note_id uuid not null,
  source_invoice_line_id uuid,
  line_number integer not null check (line_number > 0),
  line_type text not null check (line_type in ('product', 'service', 'manual')),
  product_id uuid,
  service_id uuid,
  code_snapshot text not null check (char_length(trim(code_snapshot)) between 1 and 64),
  description_snapshot text not null check (char_length(trim(description_snapshot)) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  gross_amount numeric(14,4) not null check (gross_amount >= 0),
  discount_amount numeric(14,4) not null default 0 check (discount_amount >= 0),
  net_amount numeric(14,4) not null check (net_amount >= 0),
  vat_rate numeric(5,2) not null check (vat_rate between 0 and 100),
  vat_amount numeric(14,4) not null check (vat_amount >= 0),
  total_amount numeric(14,4) not null check (total_amount >= 0 and round(net_amount + vat_amount, 4) = round(total_amount, 4)),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, credit_note_id, line_number),
  foreign key (workspace_id, credit_note_id) references public.credit_notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_invoice_line_id) references public.invoice_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id) references public.services(workspace_id, id) on delete restrict
);

create index credit_notes_invoice_idx on public.credit_notes(workspace_id, invoice_id, created_at desc);
create index credit_notes_customer_idx on public.credit_notes(workspace_id, customer_id, created_at desc);
create index credit_note_lines_source_idx on public.credit_note_lines(workspace_id, source_invoice_line_id) where source_invoice_line_id is not null;

create table public.delivery_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text not null,
  source_invoice_id uuid,
  source_sale_id uuid,
  customer_id uuid not null,
  customer_name_snapshot text not null,
  delivery_address text,
  delivery_date date not null,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  notes text check (notes is null or char_length(notes) <= 2000),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  issued_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, source_invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_sale_id) references public.sales(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  constraint delivery_notes_source_shape check ((source_invoice_id is not null)::integer + (source_sale_id is not null)::integer = 1),
  constraint delivery_notes_issue_shape check (
    (status = 'draft' and issued_by is null and issued_at is null)
    or (status = 'issued' and issued_by is not null and issued_at is not null)
  )
);

create table public.delivery_note_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_note_id uuid not null,
  source_invoice_line_id uuid,
  source_sale_line_id uuid,
  line_number integer not null check (line_number > 0),
  line_type text not null check (line_type in ('product', 'service', 'manual')),
  product_id uuid,
  service_id uuid,
  code_snapshot text not null check (char_length(trim(code_snapshot)) between 1 and 64),
  description_snapshot text not null check (char_length(trim(description_snapshot)) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, delivery_note_id, line_number),
  foreign key (workspace_id, delivery_note_id) references public.delivery_notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_invoice_line_id) references public.invoice_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_sale_line_id) references public.sale_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id) references public.services(workspace_id, id) on delete restrict,
  constraint delivery_note_lines_source_shape check ((source_invoice_line_id is not null)::integer + (source_sale_line_id is not null)::integer = 1)
);

create index delivery_notes_customer_idx on public.delivery_notes(workspace_id, customer_id, delivery_date desc);
create index delivery_notes_invoice_idx on public.delivery_notes(workspace_id, source_invoice_id) where source_invoice_id is not null;
create index delivery_notes_sale_idx on public.delivery_notes(workspace_id, source_sale_id) where source_sale_id is not null;
create index delivery_note_lines_invoice_source_idx on public.delivery_note_lines(workspace_id, source_invoice_line_id) where source_invoice_line_id is not null;
create index delivery_note_lines_sale_source_idx on public.delivery_note_lines(workspace_id, source_sale_line_id) where source_sale_line_id is not null;

create or replace function private.enforce_issued_business_document_mutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then raise exception 'Issued business documents are immutable'; end if;
    return old;
  end if;
  if old.status = 'issued' then raise exception 'Issued business documents are immutable'; end if;
  return new;
end;
$$;

create or replace function private.enforce_business_document_line_mutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
begin
  if tg_table_name = 'credit_note_lines' then
    select status into parent_status from public.credit_notes
    where workspace_id = coalesce(new.workspace_id, old.workspace_id)
      and id = coalesce(new.credit_note_id, old.credit_note_id);
  else
    select status into parent_status from public.delivery_notes
    where workspace_id = coalesce(new.workspace_id, old.workspace_id)
      and id = coalesce(new.delivery_note_id, old.delivery_note_id);
  end if;
  if parent_status = 'issued' then raise exception 'Issued business document lines are immutable'; end if;
  return coalesce(new, old);
end;
$$;

create trigger credit_notes_immutability before update or delete on public.credit_notes
for each row execute function private.enforce_issued_business_document_mutability();
create trigger delivery_notes_immutability before update or delete on public.delivery_notes
for each row execute function private.enforce_issued_business_document_mutability();
create trigger credit_note_lines_immutability before update or delete on public.credit_note_lines
for each row execute function private.enforce_business_document_line_mutability();
create trigger delivery_note_lines_immutability before update or delete on public.delivery_note_lines
for each row execute function private.enforce_business_document_line_mutability();

drop trigger if exists credit_notes_touch_updated_at on public.credit_notes;
create trigger credit_notes_touch_updated_at before update on public.credit_notes for each row execute function private.touch_updated_at();
drop trigger if exists delivery_notes_touch_updated_at on public.delivery_notes;
create trigger delivery_notes_touch_updated_at before update on public.delivery_notes for each row execute function private.touch_updated_at();

alter table public.credit_notes enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;

create policy "Credit notes Accounts read" on public.credit_notes for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Credit note lines Accounts read" on public.credit_note_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Delivery notes Accounts read" on public.delivery_notes for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Delivery note lines Accounts read" on public.delivery_note_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

revoke all on public.credit_notes, public.credit_note_lines, public.delivery_notes, public.delivery_note_lines from public, anon, authenticated;
grant select on public.credit_notes, public.credit_note_lines, public.delivery_notes, public.delivery_note_lines to authenticated;

alter table public.accounts_command_receipts drop constraint if exists accounts_command_receipts_entity_type_check;
alter table public.accounts_command_receipts add constraint accounts_command_receipts_entity_type_check
check (entity_type in ('invoice','payment','allocation','credit_note','delivery_note'));
alter table public.accounts_command_receipts drop constraint if exists accounts_command_receipts_action_check;
alter table public.accounts_command_receipts add constraint accounts_command_receipts_action_check
check (action in (
  'create_manual_invoice','create_sale_invoice','update_invoice','issue_invoice','void_invoice',
  'record_payment','allocate_payment','reverse_allocation','reverse_payment',
  'create_credit_note','update_credit_note','issue_credit_note',
  'create_delivery_note','update_delivery_note','issue_delivery_note'
));

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
declare
  line_value jsonb;
  source_line public.invoice_lines;
  invoice_record public.invoices;
  line_id uuid;
  source_id uuid;
  requested_quantity numeric;
  requested_amount numeric;
  credited_quantity numeric;
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
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Credit Note must contain between 1 and 100 lines';
  end if;

  select * into invoice_record from public.invoices
  where workspace_id = p_workspace_id and id = p_invoice_id;
  if invoice_record.id is null then raise exception 'Credit Note Invoice not found'; end if;
  select count(*) into invoice_line_count from public.invoice_lines
  where workspace_id = p_workspace_id and invoice_id = p_invoice_id;

  delete from public.credit_note_lines
  where workspace_id = p_workspace_id and credit_note_id = p_credit_note_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin line_id := (line_value->>'id')::uuid; exception when others then raise exception 'Credit Note line identity is invalid'; end;

    if invoice_line_count > 0 then
      begin source_id := (line_value->>'sourceInvoiceLineId')::uuid; exception when others then raise exception 'Credit Note source line is invalid'; end;
      select * into source_line from public.invoice_lines
      where workspace_id = p_workspace_id and id = source_id and invoice_id = p_invoice_id;
      if source_line.id is null then raise exception 'Credit Note source line is unavailable'; end if;
      begin requested_quantity := (line_value->>'quantity')::numeric; exception when others then raise exception 'Credit Note quantity is invalid'; end;
      if requested_quantity <= 0 then raise exception 'Credit Note quantity must be greater than zero'; end if;

      select coalesce(sum(line.quantity), 0) into credited_quantity
      from public.credit_note_lines line
      join public.credit_notes note on note.workspace_id = line.workspace_id and note.id = line.credit_note_id
      where line.workspace_id = p_workspace_id
        and line.source_invoice_line_id = source_id
        and note.status = 'issued';
      if requested_quantity + credited_quantity > source_line.quantity then raise exception 'Credit Note quantity exceeds the uncredited Invoice quantity'; end if;

      factor := requested_quantity / source_line.quantity;
      gross_value := round(requested_quantity * source_line.unit_price, 4);
      discount_value := round(source_line.discount_amount * factor, 4);
      total_value := round(gross_value - discount_value, 4);
      vat_value := case when source_line.vat_rate = 0 then 0 else round(total_value * source_line.vat_rate / (100 + source_line.vat_rate), 4) end;
      net_value := round(total_value - vat_value, 4);

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
      begin requested_amount := (line_value->>'amount')::numeric; exception when others then raise exception 'Legacy Credit Note amount is invalid'; end;
      if requested_amount <= 0 then raise exception 'Legacy Credit Note amount must be greater than zero'; end if;
      select coalesce(sum(line.total_amount), 0) into prior_legacy_credit
      from public.credit_note_lines line
      join public.credit_notes note on note.workspace_id = line.workspace_id and note.id = line.credit_note_id
      where note.workspace_id = p_workspace_id
        and note.invoice_id = p_invoice_id
        and note.status = 'issued';
      if requested_amount + prior_legacy_credit > invoice_record.total_amount then raise exception 'Credit Note amount exceeds the uncredited Invoice balance'; end if;
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
$$;

create or replace function public.apply_credit_note_command(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_invoice_id uuid default null,
  p_reason text default null,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  result_payload jsonb;
  note_record public.credit_notes;
  invoice_record public.invoices;
  customer_record public.customers;
  settings_record public.workspace_settings;
  workspace_record public.workspaces;
  totals jsonb;
  previous_credit numeric;
  permission_action text;
begin
  if p_action not in ('create','update','issue') then raise exception 'Unsupported Credit Note action'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Credit Note idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  permission_action := case when p_action = 'create' then 'create' when p_action = 'update' then 'edit' else 'approve' end;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then raise exception 'Accounts Credit Note access denied'; end if;

  if p_action = 'create' then
    select * into invoice_record from public.invoices
    where workspace_id = p_workspace_id and id = p_invoice_id for update;
    if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status,'void'::public.invoice_status) then raise exception 'Only an issued Invoice can be credited'; end if;
    if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Credit Note reason is invalid'; end if;
    select * into customer_record from public.customers where workspace_id = p_workspace_id and id = invoice_record.customer_id;
    insert into public.credit_notes (
      id, workspace_id, number, invoice_id, customer_id, currency, reason, customer_name_snapshot,
      created_by, updated_by
    ) values (
      p_credit_note_id, p_workspace_id, 'DRAFT-CN-' || upper(right(replace(p_credit_note_id::text,'-',''),8)),
      invoice_record.id, invoice_record.customer_id, invoice_record.currency, trim(p_reason), invoice_record.customer_name_snapshot,
      p_actor_user_id, p_actor_user_id
    ) returning * into note_record;
    totals := private.write_credit_note_lines(p_workspace_id, note_record.id, invoice_record.id, p_lines);
    update public.credit_notes set
      gross_amount=(totals->>'gross')::numeric, discount_amount=(totals->>'discount')::numeric,
      net_amount=(totals->>'net')::numeric, vat_amount=(totals->>'vat')::numeric,
      total_amount=(totals->>'total')::numeric
    where workspace_id=p_workspace_id and id=note_record.id returning * into note_record;
  else
    select * into note_record from public.credit_notes
    where workspace_id=p_workspace_id and id=p_credit_note_id for update;
    if note_record.id is null then raise exception 'Credit Note not found'; end if;
    if note_record.status <> 'draft' then raise exception 'Issued Credit Notes are immutable'; end if;
    if p_expected_version is null or note_record.version <> p_expected_version then raise exception 'Credit Note changed on another device; refresh before saving'; end if;
    select * into invoice_record from public.invoices where workspace_id=p_workspace_id and id=note_record.invoice_id for update;

    if p_action='update' then
      if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Credit Note reason is invalid'; end if;
      totals := private.write_credit_note_lines(p_workspace_id, note_record.id, note_record.invoice_id, p_lines);
      update public.credit_notes set reason=trim(p_reason),
        gross_amount=(totals->>'gross')::numeric, discount_amount=(totals->>'discount')::numeric,
        net_amount=(totals->>'net')::numeric, vat_amount=(totals->>'vat')::numeric,
        total_amount=(totals->>'total')::numeric, updated_by=p_actor_user_id, version=version+1
      where workspace_id=p_workspace_id and id=note_record.id returning * into note_record;
    else
      select coalesce(sum(total_amount),0) into previous_credit from public.credit_notes
      where workspace_id=p_workspace_id and invoice_id=note_record.invoice_id and status='issued';
      if previous_credit + note_record.total_amount > invoice_record.total_amount then raise exception 'Credit Note exceeds the remaining Invoice value'; end if;
      select * into settings_record from public.workspace_settings where workspace_id=p_workspace_id;
      select * into workspace_record from public.workspaces where id=p_workspace_id;
      select * into customer_record from public.customers where workspace_id=p_workspace_id and id=note_record.customer_id;
      update public.credit_notes set
        number=private.next_business_document_number(p_workspace_id,'credit_note',coalesce(settings_record.credit_note_prefix,'CN'),current_date),
        status='issued', issued_at=current_date, issued_at_timestamp=now(), issued_by=p_actor_user_id,
        supplier_name_snapshot=coalesce(nullif(workspace_record.legal_name,''),workspace_record.name),
        supplier_address_snapshot=settings_record.business_address,
        supplier_vat_number_snapshot=settings_record.vat_number,
        supplier_registration_number_snapshot=settings_record.company_registration_number,
        customer_name_snapshot=customer_record.name,
        customer_address_snapshot=customer_record.address,
        customer_vat_number_snapshot=customer_record.vat_number,
        updated_by=p_actor_user_id, version=version+1
      where workspace_id=p_workspace_id and id=note_record.id returning * into note_record;
    end if;
  end if;

  result_payload := jsonb_build_object('action',p_action,'creditNote',to_jsonb(note_record));
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values(p_workspace_id,trim(p_idempotency_key),'credit_note',note_record.id,
    case p_action when 'create' then 'create_credit_note' when 'update' then 'update_credit_note' else 'issue_credit_note' end,
    result_payload);
  insert into public.activity_items(workspace_id,actor_user_id,action,detail,tone,entity_type,entity_id,command_id,metadata)
  values(p_workspace_id,p_actor_user_id,
    case p_action when 'create' then 'Credit Note draft created' when 'update' then 'Credit Note draft updated' else 'Credit Note issued' end,
    note_record.number || ' · Invoice ' || invoice_record.number,'gold','credit_note',note_record.id::text,p_command_id,
    jsonb_build_object('invoice_id',note_record.invoice_id,'customer_id',note_record.customer_id,'total_amount',note_record.total_amount,'idempotency_key',p_idempotency_key));
  return result_payload;
end;
$$;

create or replace function private.write_delivery_note_lines(
  p_workspace_id uuid,
  p_delivery_note_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_value jsonb;
  line_id uuid;
  source_id uuid;
  quantity_value numeric;
  delivered_quantity numeric;
  invoice_line public.invoice_lines;
  sale_line public.sale_lines;
  line_number_value integer := 0;
begin
  if p_source_type not in ('invoice','sale') then raise exception 'Delivery Note source type is invalid'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Delivery Note must contain between 1 and 100 lines';
  end if;
  delete from public.delivery_note_lines where workspace_id=p_workspace_id and delivery_note_id=p_delivery_note_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin line_id := (line_value->>'id')::uuid; source_id := (line_value->>'sourceLineId')::uuid; quantity_value := (line_value->>'quantity')::numeric;
    exception when others then raise exception 'Delivery Note line input is invalid'; end;
    if quantity_value <= 0 then raise exception 'Delivery Note quantity must be greater than zero'; end if;

    if p_source_type='invoice' then
      select * into invoice_line from public.invoice_lines
      where workspace_id=p_workspace_id and id=source_id and invoice_id=p_source_id;
      if invoice_line.id is null then raise exception 'Delivery Note Invoice line is unavailable'; end if;
      select coalesce(sum(line.quantity),0) into delivered_quantity
      from public.delivery_note_lines line join public.delivery_notes note on note.workspace_id=line.workspace_id and note.id=line.delivery_note_id
      where line.workspace_id=p_workspace_id and line.source_invoice_line_id=source_id and note.status='issued';
      if delivered_quantity + quantity_value > invoice_line.quantity then raise exception 'Delivery Note quantity exceeds the undelivered Invoice quantity'; end if;
      insert into public.delivery_note_lines(
        id,workspace_id,delivery_note_id,source_invoice_line_id,line_number,line_type,product_id,service_id,code_snapshot,description_snapshot,quantity
      ) values(
        line_id,p_workspace_id,p_delivery_note_id,source_id,line_number_value,invoice_line.line_type,invoice_line.product_id,invoice_line.service_id,
        invoice_line.code_snapshot,invoice_line.description_snapshot,quantity_value
      );
    else
      select * into sale_line from public.sale_lines
      where workspace_id=p_workspace_id and id=source_id and sale_id=p_source_id;
      if sale_line.id is null then raise exception 'Delivery Note Sale line is unavailable'; end if;
      select coalesce(sum(line.quantity),0) into delivered_quantity
      from public.delivery_note_lines line join public.delivery_notes note on note.workspace_id=line.workspace_id and note.id=line.delivery_note_id
      where line.workspace_id=p_workspace_id and line.source_sale_line_id=source_id and note.status='issued';
      if delivered_quantity + quantity_value > sale_line.quantity then raise exception 'Delivery Note quantity exceeds the undelivered Sale quantity'; end if;
      insert into public.delivery_note_lines(
        id,workspace_id,delivery_note_id,source_sale_line_id,line_number,line_type,product_id,service_id,code_snapshot,description_snapshot,quantity
      ) values(
        line_id,p_workspace_id,p_delivery_note_id,source_id,line_number_value,sale_line.line_type,sale_line.product_id,sale_line.service_id,
        sale_line.code_snapshot,sale_line.description_snapshot,quantity_value
      );
    end if;
  end loop;
  return line_number_value;
end;
$$;

create or replace function public.apply_delivery_note_command(
  p_workspace_id uuid,
  p_delivery_note_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_delivery_date date default null,
  p_delivery_address text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  result_payload jsonb;
  note_record public.delivery_notes;
  invoice_record public.invoices;
  sale_record public.sales;
  customer_record public.customers;
  settings_record public.workspace_settings;
  permission_action text;
  source_type_value text;
  source_id_value uuid;
  line_count integer;
begin
  if p_action not in ('create','update','issue') then raise exception 'Unsupported Delivery Note action'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Delivery Note idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts where workspace_id=p_workspace_id and idempotency_key=trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  permission_action := case when p_action='create' then 'create' when p_action='update' then 'edit' else 'approve' end;
  if not private.accounts_actor_can_write(p_workspace_id,p_actor_user_id,permission_action) then raise exception 'Accounts Delivery Note access denied'; end if;

  if p_action='create' then
    source_type_value := p_source_type;
    source_id_value := p_source_id;
    if source_type_value='invoice' then
      select * into invoice_record from public.invoices where workspace_id=p_workspace_id and id=source_id_value;
      if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status,'void'::public.invoice_status) then raise exception 'Only an issued Invoice can create a Delivery Note'; end if;
      select * into customer_record from public.customers where workspace_id=p_workspace_id and id=invoice_record.customer_id;
    elsif source_type_value='sale' then
      select * into sale_record from public.sales where workspace_id=p_workspace_id and id=source_id_value;
      if sale_record.id is null or sale_record.status <> 'completed' or sale_record.customer_id is null then raise exception 'Only a completed Customer Sale can create a Delivery Note'; end if;
      select * into customer_record from public.customers where workspace_id=p_workspace_id and id=sale_record.customer_id;
    else raise exception 'Delivery Note source type is invalid'; end if;
    insert into public.delivery_notes(
      id,workspace_id,number,source_invoice_id,source_sale_id,customer_id,customer_name_snapshot,delivery_address,delivery_date,notes,created_by,updated_by
    ) values(
      p_delivery_note_id,p_workspace_id,'DRAFT-DN-'||upper(right(replace(p_delivery_note_id::text,'-',''),8)),
      case when source_type_value='invoice' then source_id_value end,
      case when source_type_value='sale' then source_id_value end,
      customer_record.id,customer_record.name,coalesce(nullif(trim(p_delivery_address),''),customer_record.address),coalesce(p_delivery_date,current_date),
      nullif(trim(p_notes),''),p_actor_user_id,p_actor_user_id
    ) returning * into note_record;
    line_count := private.write_delivery_note_lines(p_workspace_id,note_record.id,source_type_value,source_id_value,p_lines);
  else
    select * into note_record from public.delivery_notes where workspace_id=p_workspace_id and id=p_delivery_note_id for update;
    if note_record.id is null then raise exception 'Delivery Note not found'; end if;
    if note_record.status <> 'draft' then raise exception 'Issued Delivery Notes are immutable'; end if;
    if p_expected_version is null or note_record.version <> p_expected_version then raise exception 'Delivery Note changed on another device; refresh before saving'; end if;
    source_type_value := case when note_record.source_invoice_id is not null then 'invoice' else 'sale' end;
    source_id_value := coalesce(note_record.source_invoice_id,note_record.source_sale_id);
    if p_action='update' then
      line_count := private.write_delivery_note_lines(p_workspace_id,note_record.id,source_type_value,source_id_value,p_lines);
      update public.delivery_notes set delivery_date=coalesce(p_delivery_date,delivery_date),
        delivery_address=case when p_delivery_address is null then delivery_address else nullif(trim(p_delivery_address),'') end,
        notes=case when p_notes is null then notes else nullif(trim(p_notes),'') end,
        updated_by=p_actor_user_id,version=version+1
      where workspace_id=p_workspace_id and id=note_record.id returning * into note_record;
    else
      if source_type_value='invoice' then
        if exists (
          select 1 from public.delivery_note_lines line
          join public.invoice_lines source on source.workspace_id=line.workspace_id and source.id=line.source_invoice_line_id
          where line.workspace_id=p_workspace_id and line.delivery_note_id=note_record.id
            and line.quantity + coalesce((select sum(prior.quantity) from public.delivery_note_lines prior join public.delivery_notes pn on pn.workspace_id=prior.workspace_id and pn.id=prior.delivery_note_id where prior.workspace_id=p_workspace_id and prior.source_invoice_line_id=line.source_invoice_line_id and pn.status='issued'),0) > source.quantity
        ) then raise exception 'Delivery Note quantity exceeds the undelivered Invoice quantity'; end if;
      else
        if exists (
          select 1 from public.delivery_note_lines line
          join public.sale_lines source on source.workspace_id=line.workspace_id and source.id=line.source_sale_line_id
          where line.workspace_id=p_workspace_id and line.delivery_note_id=note_record.id
            and line.quantity + coalesce((select sum(prior.quantity) from public.delivery_note_lines prior join public.delivery_notes pn on pn.workspace_id=prior.workspace_id and pn.id=prior.delivery_note_id where prior.workspace_id=p_workspace_id and prior.source_sale_line_id=line.source_sale_line_id and pn.status='issued'),0) > source.quantity
        ) then raise exception 'Delivery Note quantity exceeds the undelivered Sale quantity'; end if;
      end if;
      select count(*) into line_count from public.delivery_note_lines where workspace_id=p_workspace_id and delivery_note_id=note_record.id;
      if line_count < 1 then raise exception 'Delivery Note has no lines'; end if;
      select * into settings_record from public.workspace_settings where workspace_id=p_workspace_id;
      update public.delivery_notes set
        number=private.next_business_document_number(p_workspace_id,'delivery_note',coalesce(settings_record.delivery_note_prefix,'DN'),current_date),
        status='issued',issued_at=now(),issued_by=p_actor_user_id,updated_by=p_actor_user_id,version=version+1
      where workspace_id=p_workspace_id and id=note_record.id returning * into note_record;
    end if;
  end if;

  result_payload := jsonb_build_object('action',p_action,'deliveryNote',to_jsonb(note_record));
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values(p_workspace_id,trim(p_idempotency_key),'delivery_note',note_record.id,
    case p_action when 'create' then 'create_delivery_note' when 'update' then 'update_delivery_note' else 'issue_delivery_note' end,
    result_payload);
  insert into public.activity_items(workspace_id,actor_user_id,action,detail,tone,entity_type,entity_id,command_id,metadata)
  values(p_workspace_id,p_actor_user_id,
    case p_action when 'create' then 'Delivery Note draft created' when 'update' then 'Delivery Note draft updated' else 'Delivery Note issued' end,
    note_record.number || ' · ' || note_record.customer_name_snapshot,'blue','delivery_note',note_record.id::text,p_command_id,
    jsonb_build_object('customer_id',note_record.customer_id,'source_invoice_id',note_record.source_invoice_id,'source_sale_id',note_record.source_sale_id,'idempotency_key',p_idempotency_key));
  return result_payload;
end;
$$;

revoke all on function public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb) to service_role;
revoke all on function public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb) to service_role;

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id, allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta),0),4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment on payment.workspace_id=allocation.workspace_id and payment.id=allocation.payment_id
  where payment.status='posted'
  group by allocation.workspace_id, allocation.invoice_id
), credit_totals as (
  select workspace_id,invoice_id,round(coalesce(sum(total_amount),0),4) as credited_amount
  from public.credit_notes where status='issued' group by workspace_id,invoice_id
)
select
       invoice.id,
       invoice.workspace_id,
       invoice.number,
       invoice.customer_id,
       invoice.issued_at,
       invoice.due_at,
       invoice.description,
       invoice.amount,
       invoice.status,
       invoice.created_at,
       invoice.updated_at,
       invoice.source_sale_id,
       invoice.currency,
       invoice.customer_code_snapshot,
       invoice.customer_name_snapshot,
       invoice.gross_amount,
       invoice.discount_amount,
       invoice.net_amount,
       invoice.vat_amount,
       invoice.total_amount,
       invoice.notes,
       invoice.version,
       invoice.created_by,
       invoice.updated_by,
       invoice.issued_by,
       invoice.sent_at,
       invoice.voided_at,
       invoice.voided_by,
       invoice.void_reason,
       coalesce(allocation.allocated_amount,0)::numeric(14,4) as allocated_amount,
       case when invoice.status::text in ('draft','void') then 0
            else greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)
       end::numeric(14,4) as outstanding_amount,
       case when invoice.status::text='void' then 'void'
            when invoice.status::text='draft' then 'draft'
            when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
            when coalesce(allocation.allocated_amount,0)>0 then 'partially_paid'
            else 'unpaid' end as payment_status,
       case when invoice.status::text='void' then 'void'
            when invoice.status::text='draft' then 'draft'
            when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
            when invoice.due_at<current_date then 'overdue'
            else 'sent' end as display_status,
       invoice.supplier_name_snapshot,
       invoice.supplier_address_snapshot,
       invoice.supplier_vat_number_snapshot,
       invoice.supplier_registration_number_snapshot,
       invoice.customer_address_snapshot,
       invoice.customer_vat_number_snapshot,
       invoice.supply_date,
       invoice.legal_snapshot_at,
       invoice.final_number_assigned_at,
       coalesce(credit.credited_amount,0)::numeric(14,4) as credited_amount,
       greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0),4),0)::numeric(14,4) as adjusted_total_amount,
       case when invoice.status::text in ('draft','void') then 0
            else greatest(round(coalesce(allocation.allocated_amount,0)-greatest(invoice.total_amount-coalesce(credit.credited_amount,0),0),4),0)
       end::numeric(14,4) as overallocated_credit
from public.invoices invoice
left join allocation_totals allocation on allocation.workspace_id=invoice.workspace_id and allocation.invoice_id=invoice.id
left join credit_totals credit on credit.workspace_id=invoice.workspace_id and credit.invoice_id=invoice.id;

create or replace view public.customer_account_balances
with (security_invoker = true)
as
with invoice_totals as (
  select workspace_id,customer_id,
    round(sum(case when status::text not in ('draft','void') then adjusted_total_amount else 0 end),4) issued_amount,
    round(sum(case when status::text not in ('draft','void') then allocated_amount else 0 end),4) allocated_amount,
    round(sum(case when status::text not in ('draft','void') then outstanding_amount else 0 end),4) outstanding_amount,
    round(sum(case when status::text not in ('draft','void') then overallocated_credit else 0 end),4) overallocated_credit
  from public.invoice_account_balances group by workspace_id,customer_id
), payment_totals as (
  select workspace_id,customer_id,
    round(sum(case when status='posted' then amount else 0 end),4) received_amount,
    round(sum(unallocated_amount),4) unallocated_credit
  from public.payment_account_balances group by workspace_id,customer_id
)
select customer.workspace_id, customer.id customer_id, customer.code customer_code, customer.name customer_name, customer.company,
  coalesce(invoice.issued_amount,0)::numeric(14,4) issued_amount,
  coalesce(payment.received_amount,0)::numeric(14,4) received_amount,
  coalesce(invoice.allocated_amount,0)::numeric(14,4) allocated_amount,
  coalesce(invoice.outstanding_amount,0)::numeric(14,4) outstanding_amount,
  round(coalesce(payment.unallocated_credit,0)+coalesce(invoice.overallocated_credit,0),4)::numeric(14,4) unallocated_credit,
  round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.overallocated_credit,0),4)::numeric(14,4) net_balance,
  case when round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.overallocated_credit,0),4)>0 then 'amount_due'
       when round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.overallocated_credit,0),4)<0 then 'customer_credit'
       else 'clear' end balance_status
from public.customers customer
left join invoice_totals invoice on invoice.workspace_id=customer.workspace_id and invoice.customer_id=customer.id
left join payment_totals payment on payment.workspace_id=customer.workspace_id and payment.customer_id=customer.id;

create or replace view public.business_document_index
with (security_invoker = true)
as
select invoice.workspace_id,'invoice'::text document_type,invoice.id,invoice.number,invoice.customer_id,
       invoice.customer_name_snapshot customer_name,invoice.issued_at document_date,invoice.display_status status,
       invoice.currency,invoice.adjusted_total_amount total_amount,invoice.outstanding_amount balance_amount,
       invoice.id source_invoice_id,invoice.source_sale_id,null::text reason
from public.invoice_account_balances invoice
union all
select note.workspace_id,'credit_note',note.id,note.number,note.customer_id,note.customer_name_snapshot,note.issued_at,
       note.status,note.currency,note.total_amount,null::numeric,note.invoice_id,null::uuid,note.reason
from public.credit_notes note
union all
select note.workspace_id,'delivery_note',note.id,note.number,note.customer_id,note.customer_name_snapshot,note.delivery_date,
       note.status,null::text,null::numeric,null::numeric,note.source_invoice_id,note.source_sale_id,null::text
from public.delivery_notes note;

revoke all on public.business_document_index from public, anon, authenticated;
grant select on public.business_document_index to authenticated;

create or replace function public.update_workspace_configuration(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_business_name text,
  target_legal_name text,
  target_owner_name text,
  target_email text,
  target_phone text,
  target_currency text,
  target_invoice_prefix text,
  target_vat_rate numeric,
  target_timezone text,
  target_theme jsonb,
  target_document_identity jsonb,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  identity jsonb := coalesce(target_document_identity,'{}'::jsonb);
  business_address_value text := nullif(trim(coalesce(identity->>'businessAddress','')),'');
  vat_number_value text := nullif(trim(coalesce(identity->>'vatNumber','')),'');
  registration_value text := nullif(trim(coalesce(identity->>'companyRegistrationNumber','')),'');
  credit_prefix_value text := upper(coalesce(nullif(trim(identity->>'creditNotePrefix'),''),'CN'));
  delivery_prefix_value text := upper(coalesce(nullif(trim(identity->>'deliveryNotePrefix'),''),'DN'));
  terms_value integer := coalesce(nullif(identity->>'paymentTermsDays','')::integer,14);
  footer_value text := nullif(trim(coalesce(identity->>'documentFooter','')),'');
  result_payload jsonb;
begin
  if char_length(coalesce(business_address_value,''))>1000 or char_length(coalesce(vat_number_value,''))>64
     or char_length(coalesce(registration_value,''))>64 or char_length(coalesce(footer_value,''))>1000 then
    raise exception 'Business document identity field is too long';
  end if;
  if credit_prefix_value !~ '^[A-Z0-9-]{1,8}$' or delivery_prefix_value !~ '^[A-Z0-9-]{1,8}$' then
    raise exception 'Business document prefix is invalid';
  end if;
  if terms_value<0 or terms_value>365 then raise exception 'Payment terms are invalid'; end if;

  base_result := public.update_workspace_configuration(
    target_workspace_id,target_actor_user_id,target_idempotency_key,target_request_hash,
    target_business_name,target_legal_name,target_owner_name,target_email,target_phone,
    target_currency,target_invoice_prefix,target_vat_rate,target_timezone,target_theme,
    target_command_id,target_occurred_at
  );

  update public.workspace_settings set
    business_address=business_address_value,vat_number=vat_number_value,company_registration_number=registration_value,
    credit_note_prefix=credit_prefix_value,delivery_note_prefix=delivery_prefix_value,payment_terms_days=terms_value,
    document_footer=footer_value,updated_at=target_occurred_at
  where workspace_id=target_workspace_id;

  result_payload := base_result || jsonb_build_object('documentIdentity',jsonb_build_object(
    'businessAddress',business_address_value,'vatNumber',vat_number_value,'companyRegistrationNumber',registration_value,
    'creditNotePrefix',credit_prefix_value,'deliveryNotePrefix',delivery_prefix_value,
    'paymentTermsDays',terms_value,'documentFooter',footer_value
  ));
  update public.workspace_recovery_receipts set result=result_payload
  where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key and action='update_configuration';
  return result_payload;
end;
$$;

revoke all on function public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,jsonb,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,jsonb,uuid,timestamptz) to service_role;

create or replace function public.apply_customer_command(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_company text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_preferences jsonb default '{}'::jsonb,
  p_allow_duplicate boolean default false,
  p_vat_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  vat_value text := nullif(trim(coalesce(p_vat_number,'')),'');
  customer_row public.customers;
  result_payload jsonb;
begin
  if char_length(coalesce(vat_value,''))>64 then raise exception 'Customer VAT number is invalid'; end if;
  base_result := public.apply_customer_command(
    p_workspace_id,p_customer_id,p_action,p_idempotency_key,p_actor_user_id,p_command_id,p_expected_version,
    p_code,p_name,p_company,p_email,p_phone,p_address,p_notes,p_preferences,p_allow_duplicate
  );
  if p_action in ('create','update') then
    update public.customers set vat_number=vat_value where workspace_id=p_workspace_id and id=p_customer_id returning * into customer_row;
    result_payload := jsonb_set(base_result,'{customer}',to_jsonb(customer_row),true);
    update public.customer_command_receipts set result=result_payload
    where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
    return result_payload;
  end if;
  return base_result;
end;
$$;

revoke all on function public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text) to service_role;

comment on table public.credit_notes is 'First-class accounting Credit Notes linked to authoritative Invoices; issued records reduce receivables.';
comment on table public.delivery_notes is 'Operational fulfilment documents linked to authoritative Sales or Invoices; they have no accounting effect.';
comment on view public.business_document_index is 'One read model for Accounts business documents without duplicating Invoice, Credit Note or Delivery Note ownership.';
comment on table public.business_document_sequences is 'Workspace/year/type-scoped authoritative issue numbering. Draft IDs are not legal issue numbers.';

commit;
