begin;

alter table public.workspace_settings
  add column if not exists business_address text,
  add column if not exists vat_number text,
  add column if not exists credit_note_prefix text not null default 'CN',
  add column if not exists delivery_note_prefix text not null default 'DN',
  add column if not exists default_payment_terms_days integer not null default 14;

alter table public.workspace_settings
  drop constraint if exists workspace_settings_business_address_length,
  drop constraint if exists workspace_settings_vat_number_length,
  drop constraint if exists workspace_settings_credit_note_prefix_shape,
  drop constraint if exists workspace_settings_delivery_note_prefix_shape,
  drop constraint if exists workspace_settings_payment_terms_range,
  add constraint workspace_settings_business_address_length check (business_address is null or char_length(btrim(business_address)) between 1 and 500),
  add constraint workspace_settings_vat_number_length check (vat_number is null or char_length(btrim(vat_number)) between 2 and 40),
  add constraint workspace_settings_credit_note_prefix_shape check (credit_note_prefix ~ '^[A-Z0-9]{1,8}$'),
  add constraint workspace_settings_delivery_note_prefix_shape check (delivery_note_prefix ~ '^[A-Z0-9]{1,8}$'),
  add constraint workspace_settings_payment_terms_range check (default_payment_terms_days between 0 and 365);

alter table public.customers
  add column if not exists vat_number text;

alter table public.customers
  drop constraint if exists customers_vat_number_length,
  add constraint customers_vat_number_length check (vat_number is null or char_length(btrim(vat_number)) between 2 and 40);

alter table public.invoices
  add column if not exists supply_date date,
  add column if not exists vat_note text,
  add column if not exists customer_address_snapshot text,
  add column if not exists customer_vat_number_snapshot text,
  add column if not exists supplier_name_snapshot text,
  add column if not exists supplier_address_snapshot text,
  add column if not exists supplier_vat_number_snapshot text;

update public.invoices
set supply_date = coalesce(supply_date, issued_at)
where supply_date is null;

alter table public.invoices
  alter column supply_date set not null,
  drop constraint if exists invoices_vat_note_length,
  drop constraint if exists invoices_customer_address_snapshot_length,
  drop constraint if exists invoices_customer_vat_number_snapshot_length,
  drop constraint if exists invoices_supplier_name_snapshot_length,
  drop constraint if exists invoices_supplier_address_snapshot_length,
  drop constraint if exists invoices_supplier_vat_number_snapshot_length,
  add constraint invoices_vat_note_length check (vat_note is null or char_length(vat_note) <= 500),
  add constraint invoices_customer_address_snapshot_length check (customer_address_snapshot is null or char_length(customer_address_snapshot) <= 500),
  add constraint invoices_customer_vat_number_snapshot_length check (customer_vat_number_snapshot is null or char_length(customer_vat_number_snapshot) <= 40),
  add constraint invoices_supplier_name_snapshot_length check (supplier_name_snapshot is null or char_length(supplier_name_snapshot) <= 200),
  add constraint invoices_supplier_address_snapshot_length check (supplier_address_snapshot is null or char_length(supplier_address_snapshot) <= 500),
  add constraint invoices_supplier_vat_number_snapshot_length check (supplier_vat_number_snapshot is null or char_length(supplier_vat_number_snapshot) <= 40);

create table public.workspace_document_sequences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'credit_note', 'delivery_note')),
  series_year integer not null check (series_year between 2000 and 2200),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, document_type, series_year)
);

create table public.credit_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  number text not null,
  customer_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  issue_date date,
  customer_code_snapshot text not null,
  customer_name_snapshot text not null,
  customer_address_snapshot text,
  customer_vat_number_snapshot text,
  supplier_name_snapshot text,
  supplier_address_snapshot text,
  supplier_vat_number_snapshot text,
  gross_amount numeric(14,4) not null default 0 check (gross_amount >= 0),
  discount_amount numeric(14,4) not null default 0 check (discount_amount >= 0),
  net_amount numeric(14,4) not null default 0 check (net_amount >= 0),
  vat_amount numeric(14,4) not null default 0 check (vat_amount >= 0),
  total_amount numeric(14,4) not null default 0 check (total_amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  issued_by uuid references auth.users(id) on delete restrict,
  voided_by uuid references auth.users(id) on delete restrict,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  constraint credit_notes_status_shape check (
    (status = 'draft' and issue_date is null and issued_by is null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'issued' and issue_date is not null and issued_by is not null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'void' and issue_date is not null and issued_by is not null and voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create table public.credit_note_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credit_note_id uuid not null,
  source_invoice_line_id uuid not null,
  line_number integer not null check (line_number > 0),
  code_snapshot text not null,
  description_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  gross_amount numeric(14,4) not null check (gross_amount >= 0),
  discount_amount numeric(14,4) not null check (discount_amount >= 0 and discount_amount <= gross_amount),
  net_amount numeric(14,4) not null check (net_amount >= 0),
  vat_rate numeric(5,2) not null check (vat_rate between 0 and 100),
  vat_amount numeric(14,4) not null check (vat_amount >= 0),
  total_amount numeric(14,4) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, credit_note_id, line_number),
  foreign key (workspace_id, credit_note_id) references public.credit_notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_invoice_line_id) references public.invoice_lines(workspace_id, id) on delete restrict
);

create table public.delivery_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text not null,
  customer_id uuid not null,
  source_invoice_id uuid,
  source_sale_id uuid,
  delivery_date date not null default current_date,
  delivery_address text not null check (char_length(btrim(delivery_address)) between 1 and 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  customer_code_snapshot text not null,
  customer_name_snapshot text not null,
  supplier_name_snapshot text,
  supplier_address_snapshot text,
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_sale_id) references public.sales(workspace_id, id) on delete restrict,
  constraint delivery_notes_source_shape check ((source_invoice_id is not null)::integer + (source_sale_id is not null)::integer = 1),
  constraint delivery_notes_status_shape check (
    (status = 'draft' and issued_at is null and issued_by is null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'issued' and issued_at is not null and issued_by is not null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'void' and issued_at is not null and issued_by is not null and voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create table public.delivery_note_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_note_id uuid not null,
  source_invoice_line_id uuid,
  source_sale_line_id uuid,
  product_id uuid,
  line_number integer not null check (line_number > 0),
  code_snapshot text not null,
  description_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, delivery_note_id, line_number),
  foreign key (workspace_id, delivery_note_id) references public.delivery_notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_invoice_line_id) references public.invoice_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_sale_line_id) references public.sale_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete restrict,
  constraint delivery_note_lines_source_shape check ((source_invoice_line_id is not null)::integer + (source_sale_line_id is not null)::integer = 1)
);

alter table public.accounts_command_receipts
  drop constraint if exists accounts_command_receipts_entity_type_check,
  drop constraint if exists accounts_command_receipts_action_check,
  add constraint accounts_command_receipts_entity_type_check check (entity_type in ('invoice', 'payment', 'allocation', 'credit_note', 'delivery_note')),
  add constraint accounts_command_receipts_action_check check (action in (
    'create_manual_invoice', 'create_sale_invoice', 'update_invoice', 'issue_invoice', 'void_invoice',
    'update_invoice_metadata',
    'record_payment', 'allocate_payment', 'reverse_allocation', 'reverse_payment',
    'create_credit_note', 'update_credit_note', 'issue_credit_note', 'void_credit_note',
    'create_delivery_note', 'update_delivery_note', 'issue_delivery_note', 'void_delivery_note'
  ));

create or replace function private.next_business_document_number(
  p_workspace_id uuid,
  p_document_type text,
  p_issue_date date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix_value text;
  next_value bigint;
  year_value integer := extract(year from p_issue_date)::integer;
begin
  if p_document_type not in ('invoice', 'credit_note', 'delivery_note') then
    raise exception 'Unsupported business document type';
  end if;

  select case p_document_type
    when 'invoice' then settings.invoice_prefix
    when 'credit_note' then settings.credit_note_prefix
    else settings.delivery_note_prefix
  end
  into prefix_value
  from public.workspace_settings settings
  where settings.workspace_id = p_workspace_id;

  prefix_value := upper(regexp_replace(coalesce(prefix_value, case p_document_type when 'invoice' then 'INV' when 'credit_note' then 'CN' else 'DN' end), '[^A-Za-z0-9]', '', 'g'));

  insert into public.workspace_document_sequences(workspace_id, document_type, series_year, last_value)
  values (p_workspace_id, p_document_type, year_value, 1)
  on conflict (workspace_id, document_type, series_year)
  do update set last_value = public.workspace_document_sequences.last_value + 1, updated_at = now()
  returning last_value into next_value;

  return left(prefix_value, 8) || '-' || year_value::text || '-' || lpad(next_value::text, 6, '0');
end;
$$;

create or replace function private.prepare_invoice_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_record public.customers;
  workspace_record public.workspaces;
  settings_record public.workspace_settings;
begin
  if old.status = 'draft'::public.invoice_status and new.status <> 'draft'::public.invoice_status then
    select * into customer_record from public.customers where workspace_id = new.workspace_id and id = new.customer_id;
    select * into workspace_record from public.workspaces where id = new.workspace_id;
    select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;

    if customer_record.id is null then raise exception 'Invoice Customer is unavailable'; end if;
    if coalesce(btrim(customer_record.address), '') = '' then raise exception 'Customer address is required before issuing a Tax Invoice'; end if;
    if coalesce(btrim(settings_record.business_address), '') = '' then raise exception 'Business address is required before issuing a Tax Invoice'; end if;
    if coalesce(btrim(settings_record.vat_number), '') = '' then raise exception 'Business VAT number is required before issuing a Tax Invoice'; end if;

    new.number := private.next_business_document_number(new.workspace_id, 'invoice', new.issued_at);
    new.supply_date := coalesce(new.supply_date, new.issued_at);
    new.customer_address_snapshot := customer_record.address;
    new.customer_vat_number_snapshot := customer_record.vat_number;
    new.supplier_name_snapshot := coalesce(nullif(workspace_record.legal_name, ''), workspace_record.name);
    new.supplier_address_snapshot := settings_record.business_address;
    new.supplier_vat_number_snapshot := settings_record.vat_number;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prepare_issue on public.invoices;
create trigger invoices_prepare_issue
before update of status on public.invoices
for each row execute function private.prepare_invoice_issue();

create or replace function public.apply_invoice_document_metadata(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_supply_date date,
  p_vat_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  result_value jsonb;
  invoice_record public.invoices;
begin
  select receipt.result into previous_result
  from public.accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then raise exception 'Accounts Invoice access denied'; end if;
  select * into invoice_record from public.invoices where workspace_id = p_workspace_id and id = p_invoice_id for update;
  if invoice_record.id is null then raise exception 'Invoice not found'; end if;
  if invoice_record.status <> 'draft'::public.invoice_status then raise exception 'Issued Invoice is immutable'; end if;
  if invoice_record.version <> p_expected_version then raise exception 'Invoice changed on another device'; end if;

  update public.invoices
  set supply_date = p_supply_date,
      vat_note = nullif(btrim(p_vat_note), ''),
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_invoice_id;

  result_value := jsonb_build_object('id', p_invoice_id, 'version', p_expected_version + 1, 'status', 'draft');
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values (p_workspace_id,p_idempotency_key,'invoice',p_invoice_id,'update_invoice_metadata',result_value);
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_user_id,'invoice.document_metadata_updated','invoice',p_invoice_id,jsonb_build_object('command_id',p_command_id));
  return result_value;
end;
$$;

create or replace function private.rewrite_credit_note_lines(
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
  item jsonb;
  source_line public.invoice_lines;
  line_id uuid;
  quantity_value numeric;
  already_credited numeric;
  line_no integer := 0;
  ratio numeric;
  gross_value numeric;
  discount_value numeric;
  net_value numeric;
  vat_value numeric;
  total_value numeric;
  gross_total numeric := 0;
  discount_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  total_total numeric := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Credit Note must contain between 1 and 100 lines';
  end if;

  delete from public.credit_note_lines where workspace_id = p_workspace_id and credit_note_id = p_credit_note_id;

  for item in select value from jsonb_array_elements(p_lines)
  loop
    line_no := line_no + 1;
    begin
      line_id := (item->>'id')::uuid;
      quantity_value := (item->>'quantity')::numeric;
      select * into source_line
      from public.invoice_lines
      where workspace_id = p_workspace_id and invoice_id = p_invoice_id and id = (item->>'sourceInvoiceLineId')::uuid;
    exception when others then
      raise exception 'Credit Note line is invalid';
    end;

    if source_line.id is null or quantity_value is null or quantity_value <= 0 then raise exception 'Credit Note line is invalid'; end if;

    select coalesce(sum(line.quantity),0) into already_credited
    from public.credit_note_lines line
    join public.credit_notes note on note.workspace_id = line.workspace_id and note.id = line.credit_note_id
    where line.workspace_id = p_workspace_id
      and line.source_invoice_line_id = source_line.id
      and note.status = 'issued'
      and note.id <> p_credit_note_id;

    if quantity_value + already_credited > source_line.quantity then raise exception 'Credit quantity exceeds the original Invoice line'; end if;

    ratio := quantity_value / source_line.quantity;
    gross_value := round(source_line.gross_amount * ratio, 4);
    discount_value := round(source_line.discount_amount * ratio, 4);
    net_value := round(source_line.net_amount * ratio, 4);
    vat_value := round(source_line.vat_amount * ratio, 4);
    total_value := round(source_line.total_amount * ratio, 4);

    insert into public.credit_note_lines(
      id,workspace_id,credit_note_id,source_invoice_line_id,line_number,code_snapshot,description_snapshot,
      quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
    ) values (
      line_id,p_workspace_id,p_credit_note_id,source_line.id,line_no,source_line.code_snapshot,source_line.description_snapshot,
      quantity_value,source_line.unit_price,gross_value,discount_value,net_value,source_line.vat_rate,vat_value,total_value
    );

    gross_total := gross_total + gross_value;
    discount_total := discount_total + discount_value;
    net_total := net_total + net_value;
    vat_total := vat_total + vat_value;
    total_total := total_total + total_value;
  end loop;

  update public.credit_notes
  set gross_amount = round(gross_total,4), discount_amount = round(discount_total,4), net_amount = round(net_total,4),
      vat_amount = round(vat_total,4), total_amount = round(total_total,4), updated_at = now()
  where workspace_id = p_workspace_id and id = p_credit_note_id;

  return jsonb_build_object('lineCount',line_no,'total',round(total_total,4));
end;
$$;

create or replace function public.apply_credit_note_command(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_invoice_id uuid default null,
  p_expected_version integer default null,
  p_reason text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  result_value jsonb;
  invoice_record public.invoices;
  note_record public.credit_notes;
  customer_record public.customers;
  workspace_record public.workspaces;
  settings_record public.workspace_settings;
  permission_action text;
  line_value record;
  credited_qty numeric;
begin
  if p_action not in ('create','update','issue','void') then raise exception 'Unsupported Credit Note action'; end if;
  select receipt.result into previous_result from public.accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  permission_action := case when p_action='create' then 'create' when p_action='update' then 'edit' else 'approve' end;
  if not private.accounts_actor_can_write(p_workspace_id,p_actor_user_id,permission_action) then raise exception 'Accounts Credit Note access denied'; end if;

  if p_action = 'create' then
    select * into invoice_record from public.invoices where workspace_id=p_workspace_id and id=p_invoice_id for update;
    if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status,'void'::public.invoice_status) then raise exception 'An issued Invoice is required for a Credit Note'; end if;
    select * into customer_record from public.customers where workspace_id=p_workspace_id and id=invoice_record.customer_id;
    select * into workspace_record from public.workspaces where id=p_workspace_id;
    select * into settings_record from public.workspace_settings where workspace_id=p_workspace_id;
    if coalesce(btrim(customer_record.address),'')='' then raise exception 'Customer address is required before creating a Credit Note'; end if;
    if coalesce(btrim(settings_record.business_address),'')='' or coalesce(btrim(settings_record.vat_number),'')='' then raise exception 'Business address and VAT number are required before creating a Credit Note'; end if;

    insert into public.credit_notes(
      id,workspace_id,invoice_id,number,customer_id,currency,reason,notes,
      customer_code_snapshot,customer_name_snapshot,customer_address_snapshot,customer_vat_number_snapshot,
      supplier_name_snapshot,supplier_address_snapshot,supplier_vat_number_snapshot,created_by,updated_by
    ) values (
      p_credit_note_id,p_workspace_id,invoice_record.id,'DRAFT-'||upper(right(replace(p_credit_note_id::text,'-',''),10)),
      invoice_record.customer_id,invoice_record.currency,btrim(p_reason),nullif(btrim(p_notes),''),
      invoice_record.customer_code_snapshot,invoice_record.customer_name_snapshot,coalesce(invoice_record.customer_address_snapshot,customer_record.address),coalesce(invoice_record.customer_vat_number_snapshot,customer_record.vat_number),
      coalesce(invoice_record.supplier_name_snapshot,coalesce(nullif(workspace_record.legal_name,''),workspace_record.name)),
      coalesce(invoice_record.supplier_address_snapshot,settings_record.business_address),coalesce(invoice_record.supplier_vat_number_snapshot,settings_record.vat_number),
      p_actor_user_id,p_actor_user_id
    );
    perform private.rewrite_credit_note_lines(p_workspace_id,p_credit_note_id,invoice_record.id,p_lines);
  else
    select * into note_record from public.credit_notes where workspace_id=p_workspace_id and id=p_credit_note_id for update;
    if note_record.id is null then raise exception 'Credit Note not found'; end if;
    if p_expected_version is not null and note_record.version <> p_expected_version then raise exception 'Credit Note changed on another device'; end if;

    if p_action='update' then
      if note_record.status <> 'draft' then raise exception 'Issued Credit Note is immutable'; end if;
      update public.credit_notes set reason=btrim(p_reason),notes=nullif(btrim(p_notes),''),updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_credit_note_id;
      perform private.rewrite_credit_note_lines(p_workspace_id,p_credit_note_id,note_record.invoice_id,p_lines);
    elsif p_action='issue' then
      if note_record.status <> 'draft' then raise exception 'Only a draft Credit Note can be issued'; end if;
      for line_value in
        select line.source_invoice_line_id,line.quantity,source.quantity as source_quantity
        from public.credit_note_lines line
        join public.invoice_lines source on source.workspace_id=line.workspace_id and source.id=line.source_invoice_line_id
        where line.workspace_id=p_workspace_id and line.credit_note_id=p_credit_note_id
      loop
        select coalesce(sum(line.quantity),0) into credited_qty
        from public.credit_note_lines line
        join public.credit_notes note on note.workspace_id=line.workspace_id and note.id=line.credit_note_id
        where line.workspace_id=p_workspace_id and line.source_invoice_line_id=line_value.source_invoice_line_id and note.status='issued' and note.id<>p_credit_note_id;
        if credited_qty + line_value.quantity > line_value.source_quantity then raise exception 'Credit quantity exceeds the original Invoice line'; end if;
      end loop;
      update public.credit_notes
      set number=private.next_business_document_number(p_workspace_id,'credit_note',current_date),status='issued',issue_date=current_date,
          issued_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_credit_note_id;
    else
      if note_record.status <> 'issued' then raise exception 'Only an issued Credit Note can be voided'; end if;
      update public.credit_notes set status='void',voided_at=now(),voided_by=p_actor_user_id,void_reason=btrim(p_void_reason),updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_credit_note_id;
    end if;
  end if;

  select * into note_record from public.credit_notes where workspace_id=p_workspace_id and id=p_credit_note_id;
  result_value := jsonb_build_object('id',note_record.id,'number',note_record.number,'status',note_record.status,'version',note_record.version,'total',note_record.total_amount);
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values (p_workspace_id,p_idempotency_key,'credit_note',p_credit_note_id,
    case p_action when 'create' then 'create_credit_note' when 'update' then 'update_credit_note' when 'issue' then 'issue_credit_note' else 'void_credit_note' end,result_value);
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_user_id,'credit_note.'||p_action,'credit_note',p_credit_note_id,jsonb_build_object('invoice_id',note_record.invoice_id,'command_id',p_command_id));
  return result_value;
end;
$$;

create or replace function private.rewrite_delivery_note_lines(
  p_workspace_id uuid,
  p_delivery_note_id uuid,
  p_source_invoice_id uuid,
  p_source_sale_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  line_no integer := 0;
  quantity_value numeric;
  source_invoice_line public.invoice_lines;
  source_sale_line public.sale_lines;
  line_id uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then raise exception 'A Delivery Note must contain between 1 and 100 lines'; end if;
  delete from public.delivery_note_lines where workspace_id=p_workspace_id and delivery_note_id=p_delivery_note_id;
  for item in select value from jsonb_array_elements(p_lines)
  loop
    line_no := line_no + 1;
    begin line_id := (item->>'id')::uuid; quantity_value := (item->>'quantity')::numeric; exception when others then raise exception 'Delivery Note line is invalid'; end;
    if quantity_value is null or quantity_value <= 0 then raise exception 'Delivery Note quantity is invalid'; end if;
    if p_source_invoice_id is not null then
      select * into source_invoice_line from public.invoice_lines where workspace_id=p_workspace_id and invoice_id=p_source_invoice_id and id=(item->>'sourceLineId')::uuid;
      if source_invoice_line.id is null or quantity_value > source_invoice_line.quantity then raise exception 'Delivery quantity exceeds the source Invoice line'; end if;
      insert into public.delivery_note_lines(id,workspace_id,delivery_note_id,source_invoice_line_id,product_id,line_number,code_snapshot,description_snapshot,quantity)
      values (line_id,p_workspace_id,p_delivery_note_id,source_invoice_line.id,source_invoice_line.product_id,line_no,source_invoice_line.code_snapshot,source_invoice_line.description_snapshot,quantity_value);
    else
      select * into source_sale_line from public.sale_lines where workspace_id=p_workspace_id and sale_id=p_source_sale_id and id=(item->>'sourceLineId')::uuid;
      if source_sale_line.id is null or quantity_value > source_sale_line.quantity then raise exception 'Delivery quantity exceeds the source Sale line'; end if;
      insert into public.delivery_note_lines(id,workspace_id,delivery_note_id,source_sale_line_id,product_id,line_number,code_snapshot,description_snapshot,quantity)
      values (line_id,p_workspace_id,p_delivery_note_id,source_sale_line.id,source_sale_line.product_id,line_no,source_sale_line.code_snapshot,source_sale_line.description_snapshot,quantity_value);
    end if;
  end loop;
  return line_no;
end;
$$;

create or replace function public.apply_delivery_note_command(
  p_workspace_id uuid,
  p_delivery_note_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_source_invoice_id uuid default null,
  p_source_sale_id uuid default null,
  p_expected_version integer default null,
  p_delivery_date date default null,
  p_delivery_address text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  result_value jsonb;
  note_record public.delivery_notes;
  invoice_record public.invoices;
  sale_record public.sales;
  customer_record public.customers;
  workspace_record public.workspaces;
  settings_record public.workspace_settings;
  customer_id_value uuid;
  permission_action text;
begin
  if p_action not in ('create','update','issue','void') then raise exception 'Unsupported Delivery Note action'; end if;
  select receipt.result into previous_result from public.accounts_command_receipts receipt where receipt.workspace_id=p_workspace_id and receipt.idempotency_key=p_idempotency_key;
  if previous_result is not null then return previous_result; end if;
  permission_action := case when p_action='create' then 'create' when p_action='update' then 'edit' else 'approve' end;
  if not private.accounts_actor_can_write(p_workspace_id,p_actor_user_id,permission_action) then raise exception 'Delivery Note access denied'; end if;

  if p_action='create' then
    if (p_source_invoice_id is null) = (p_source_sale_id is null) then raise exception 'Choose exactly one Delivery Note source'; end if;
    if p_source_invoice_id is not null then
      select * into invoice_record from public.invoices where workspace_id=p_workspace_id and id=p_source_invoice_id;
      if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status,'void'::public.invoice_status) then raise exception 'An issued Invoice is required for this Delivery Note'; end if;
      customer_id_value := invoice_record.customer_id;
    else
      select * into sale_record from public.sales where workspace_id=p_workspace_id and id=p_source_sale_id;
      if sale_record.id is null or sale_record.status <> 'completed' or sale_record.customer_id is null then raise exception 'A completed Customer Sale is required for this Delivery Note'; end if;
      customer_id_value := sale_record.customer_id;
    end if;
    select * into customer_record from public.customers where workspace_id=p_workspace_id and id=customer_id_value;
    select * into workspace_record from public.workspaces where id=p_workspace_id;
    select * into settings_record from public.workspace_settings where workspace_id=p_workspace_id;
    insert into public.delivery_notes(
      id,workspace_id,number,customer_id,source_invoice_id,source_sale_id,delivery_date,delivery_address,notes,
      customer_code_snapshot,customer_name_snapshot,supplier_name_snapshot,supplier_address_snapshot,created_by,updated_by
    ) values (
      p_delivery_note_id,p_workspace_id,'DRAFT-'||upper(right(replace(p_delivery_note_id::text,'-',''),10)),customer_id_value,p_source_invoice_id,p_source_sale_id,
      coalesce(p_delivery_date,current_date),coalesce(nullif(btrim(p_delivery_address),''),customer_record.address),nullif(btrim(p_notes),''),
      customer_record.code,customer_record.name,coalesce(nullif(workspace_record.legal_name,''),workspace_record.name),settings_record.business_address,p_actor_user_id,p_actor_user_id
    );
    perform private.rewrite_delivery_note_lines(p_workspace_id,p_delivery_note_id,p_source_invoice_id,p_source_sale_id,p_lines);
  else
    select * into note_record from public.delivery_notes where workspace_id=p_workspace_id and id=p_delivery_note_id for update;
    if note_record.id is null then raise exception 'Delivery Note not found'; end if;
    if p_expected_version is not null and note_record.version <> p_expected_version then raise exception 'Delivery Note changed on another device'; end if;
    if p_action='update' then
      if note_record.status <> 'draft' then raise exception 'Issued Delivery Note is immutable'; end if;
      update public.delivery_notes set delivery_date=coalesce(p_delivery_date,delivery_date),delivery_address=coalesce(nullif(btrim(p_delivery_address),''),delivery_address),notes=nullif(btrim(p_notes),''),updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_delivery_note_id;
      perform private.rewrite_delivery_note_lines(p_workspace_id,p_delivery_note_id,note_record.source_invoice_id,note_record.source_sale_id,p_lines);
    elsif p_action='issue' then
      if note_record.status <> 'draft' then raise exception 'Only a draft Delivery Note can be issued'; end if;
      update public.delivery_notes set number=private.next_business_document_number(p_workspace_id,'delivery_note',delivery_date),status='issued',issued_at=now(),issued_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_delivery_note_id;
    else
      if note_record.status <> 'issued' then raise exception 'Only an issued Delivery Note can be voided'; end if;
      update public.delivery_notes set status='void',voided_at=now(),voided_by=p_actor_user_id,void_reason=btrim(p_void_reason),updated_by=p_actor_user_id,updated_at=now(),version=version+1
      where workspace_id=p_workspace_id and id=p_delivery_note_id;
    end if;
  end if;

  select * into note_record from public.delivery_notes where workspace_id=p_workspace_id and id=p_delivery_note_id;
  result_value := jsonb_build_object('id',note_record.id,'number',note_record.number,'status',note_record.status,'version',note_record.version);
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values (p_workspace_id,p_idempotency_key,'delivery_note',p_delivery_note_id,
    case p_action when 'create' then 'create_delivery_note' when 'update' then 'update_delivery_note' when 'issue' then 'issue_delivery_note' else 'void_delivery_note' end,result_value);
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_user_id,'delivery_note.'||p_action,'delivery_note',p_delivery_note_id,jsonb_build_object('source_invoice_id',note_record.source_invoice_id,'source_sale_id',note_record.source_sale_id,'command_id',p_command_id));
  return result_value;
end;
$$;

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id, allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta),0),4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment on payment.workspace_id=allocation.workspace_id and payment.id=allocation.payment_id
  where payment.status='posted'
  group by allocation.workspace_id,allocation.invoice_id
), credit_totals as (
  select note.workspace_id,note.invoice_id,round(coalesce(sum(note.total_amount),0),4) as credit_note_amount
  from public.credit_notes note
  where note.status='issued'
  group by note.workspace_id,note.invoice_id
)
select
  invoice.id,invoice.workspace_id,invoice.number,invoice.customer_id,invoice.issued_at,invoice.due_at,invoice.description,invoice.amount,invoice.status,invoice.created_at,invoice.updated_at,
  invoice.source_sale_id,invoice.currency,invoice.customer_code_snapshot,invoice.customer_name_snapshot,invoice.gross_amount,invoice.discount_amount,invoice.net_amount,invoice.vat_amount,invoice.total_amount,
  invoice.notes,invoice.version,invoice.created_by,invoice.updated_by,invoice.issued_by,invoice.sent_at,invoice.voided_at,invoice.voided_by,invoice.void_reason,
  coalesce(alloc.allocated_amount,0)::numeric(14,4) as allocated_amount,
  greatest(round(invoice.total_amount-coalesce(credit.credit_note_amount,0)-least(coalesce(alloc.allocated_amount,0),greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0)),4),0)::numeric(14,4) as outstanding_amount,
  case
    when invoice.status='void'::public.invoice_status then 'void'
    when invoice.status='draft'::public.invoice_status then 'draft'
    when greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0)=0 then 'paid'
    when least(coalesce(alloc.allocated_amount,0),greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0))=0 then 'unpaid'
    when least(coalesce(alloc.allocated_amount,0),greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0)) < greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0) then 'partially_paid'
    else 'paid'
  end as payment_status,
  case
    when invoice.status='void'::public.invoice_status then 'void'
    when invoice.status='draft'::public.invoice_status then 'draft'
    when greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0)=0 then 'paid'
    when greatest(round(invoice.total_amount-coalesce(credit.credit_note_amount,0)-least(coalesce(alloc.allocated_amount,0),greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0)),4),0)=0 then 'paid'
    when invoice.due_at < current_date then 'overdue'
    else 'sent'
  end as display_status,
  invoice.supply_date,invoice.vat_note,invoice.customer_address_snapshot,invoice.customer_vat_number_snapshot,invoice.supplier_name_snapshot,invoice.supplier_address_snapshot,invoice.supplier_vat_number_snapshot,
  coalesce(credit.credit_note_amount,0)::numeric(14,4) as credit_note_amount,
  greatest(round(invoice.total_amount-coalesce(credit.credit_note_amount,0),4),0)::numeric(14,4) as adjusted_total_amount,
  least(coalesce(alloc.allocated_amount,0),greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0))::numeric(14,4) as applied_allocated_amount,
  greatest(coalesce(alloc.allocated_amount,0)-greatest(invoice.total_amount-coalesce(credit.credit_note_amount,0),0),0)::numeric(14,4) as excess_allocated_amount
from public.invoices invoice
left join allocation_totals alloc on alloc.workspace_id=invoice.workspace_id and alloc.invoice_id=invoice.id
left join credit_totals credit on credit.workspace_id=invoice.workspace_id and credit.invoice_id=invoice.id;

create or replace view public.customer_account_balances
with (security_invoker = true)
as
with invoice_totals as (
  select workspace_id,customer_id,
    round(sum(case when status::text not in ('draft','void') then adjusted_total_amount else 0 end),4) as issued_amount,
    round(sum(case when status::text not in ('draft','void') then applied_allocated_amount else 0 end),4) as allocated_amount,
    round(sum(case when status::text not in ('draft','void') then outstanding_amount else 0 end),4) as outstanding_amount,
    round(sum(case when status::text not in ('draft','void') then excess_allocated_amount else 0 end),4) as excess_credit
  from public.invoice_account_balances group by workspace_id,customer_id
), payment_totals as (
  select workspace_id,customer_id,
    round(sum(case when status='posted' then amount else 0 end),4) as received_amount,
    round(sum(unallocated_amount),4) as unallocated_credit
  from public.payment_account_balances group by workspace_id,customer_id
)
select customer.workspace_id,customer.id as customer_id,customer.code as customer_code,customer.name as customer_name,customer.company,
  coalesce(invoice.issued_amount,0)::numeric(14,4) as issued_amount,
  coalesce(payment.received_amount,0)::numeric(14,4) as received_amount,
  coalesce(invoice.allocated_amount,0)::numeric(14,4) as allocated_amount,
  coalesce(invoice.outstanding_amount,0)::numeric(14,4) as outstanding_amount,
  (coalesce(payment.unallocated_credit,0)+coalesce(invoice.excess_credit,0))::numeric(14,4) as unallocated_credit,
  round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.excess_credit,0),4)::numeric(14,4) as net_balance,
  case
    when round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.excess_credit,0),4)>0 then 'amount_due'
    when round(coalesce(invoice.outstanding_amount,0)-coalesce(payment.unallocated_credit,0)-coalesce(invoice.excess_credit,0),4)<0 then 'customer_credit'
    else 'clear'
  end as balance_status
from public.customers customer
left join invoice_totals invoice on invoice.workspace_id=customer.workspace_id and invoice.customer_id=customer.id
left join payment_totals payment on payment.workspace_id=customer.workspace_id and payment.customer_id=customer.id;

create or replace view public.business_document_index
with (security_invoker = true)
as
select invoice.workspace_id,invoice.id,'invoice'::text as document_type,invoice.number,invoice.customer_id,invoice.customer_name_snapshot as customer_name,
       invoice.created_at,invoice.issued_at::timestamptz as issued_at,invoice.status::text as status,invoice.currency,invoice.total_amount,
       invoice.source_sale_id,null::uuid as source_invoice_id,invoice.outstanding_amount
from public.invoice_account_balances invoice
union all
select note.workspace_id,note.id,'credit_note',note.number,note.customer_id,note.customer_name_snapshot,note.created_at,note.issue_date::timestamptz,note.status,note.currency,note.total_amount,
       null::uuid,note.invoice_id,null::numeric(14,4)
from public.credit_notes note
union all
select note.workspace_id,note.id,'delivery_note',note.number,note.customer_id,note.customer_name_snapshot,note.created_at,note.issued_at,note.status,null::text,null::numeric(14,4),
       note.source_sale_id,note.source_invoice_id,null::numeric(14,4)
from public.delivery_notes note;

alter table public.workspace_document_sequences enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;

create policy "Credit Notes permission read" on public.credit_notes for select to authenticated using (private.has_workspace_permission(workspace_id,'accounts','view'));
create policy "Credit Note lines permission read" on public.credit_note_lines for select to authenticated using (private.has_workspace_permission(workspace_id,'accounts','view'));
create policy "Delivery Notes permission read" on public.delivery_notes for select to authenticated using (private.has_workspace_permission(workspace_id,'accounts','view') or private.has_workspace_permission(workspace_id,'sales','view'));
create policy "Delivery Note lines permission read" on public.delivery_note_lines for select to authenticated using (private.has_workspace_permission(workspace_id,'accounts','view') or private.has_workspace_permission(workspace_id,'sales','view'));

revoke all on public.workspace_document_sequences from public,anon,authenticated;
revoke all on public.credit_notes from public,anon,authenticated;
revoke all on public.credit_note_lines from public,anon,authenticated;
revoke all on public.delivery_notes from public,anon,authenticated;
revoke all on public.delivery_note_lines from public,anon,authenticated;
grant select on public.credit_notes,public.credit_note_lines,public.delivery_notes,public.delivery_note_lines to authenticated;
revoke all on public.business_document_index from public,anon;
grant select on public.business_document_index to authenticated;

revoke all on function public.apply_invoice_document_metadata(uuid,uuid,text,uuid,uuid,integer,date,text) from public,anon,authenticated;
grant execute on function public.apply_invoice_document_metadata(uuid,uuid,text,uuid,uuid,integer,date,text) to service_role;
revoke all on function public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text) to service_role;
revoke all on function public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text) to service_role;

create index credit_notes_invoice_idx on public.credit_notes(workspace_id,invoice_id,created_at desc);
create index credit_notes_customer_idx on public.credit_notes(workspace_id,customer_id,created_at desc);
create index credit_note_lines_source_idx on public.credit_note_lines(workspace_id,source_invoice_line_id);
create index delivery_notes_customer_idx on public.delivery_notes(workspace_id,customer_id,created_at desc);
create index delivery_notes_invoice_idx on public.delivery_notes(workspace_id,source_invoice_id) where source_invoice_id is not null;
create index delivery_notes_sale_idx on public.delivery_notes(workspace_id,source_sale_id) where source_sale_id is not null;

commit;
