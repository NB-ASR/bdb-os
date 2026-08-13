-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133410_vanita_release_catalogues_and_suppliers.sql.
-- Sources: 20260727152000_product_catalogue_foundation.sql through 20260727155000_product_supplier_relationship.sql.
begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'products',
  'Products',
  'Reusable product definitions for Inventory, Purchasing, Sales and invoice lines.',
  'catalogue',
  '/products',
  46,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

create table public.products (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku extensions.citext not null check (char_length(trim(sku::text)) between 1 and 64),
  name text not null check (char_length(trim(name)) between 2 and 160),
  barcode extensions.citext,
  brand text check (brand is null or char_length(brand) <= 120),
  category text check (category is null or char_length(category) <= 120),
  purpose text not null check (purpose in ('resale', 'supply')),
  unit_label text not null default 'unit' check (char_length(trim(unit_label)) between 1 and 24),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  selling_price numeric(14,4) check (selling_price is null or selling_price >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sku)
);

create unique index products_workspace_barcode_idx
  on public.products(workspace_id, barcode)
  where barcode is not null and trim(barcode::text) <> '';

create index products_workspace_status_name_idx
  on public.products(workspace_id, status, name);

create table public.product_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  product_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete cascade
);

create index product_command_receipts_product_idx
  on public.product_command_receipts(workspace_id, product_id, created_at desc);

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function private.touch_updated_at();

create or replace function private.product_actor_can_write(
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
  with membership as (
    select m.access_profile
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = target_workspace_id
      and m.user_id = target_actor_user_id
      and m.status = 'active'
      and w.status in ('trial', 'active')
      and p.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'products'
    limit 1
  )
  select private.has_feature(target_workspace_id, 'products')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        else false
      end
      when (select access_profile from membership) = 'manager'
        then target_action in ('create', 'edit')
      when (select access_profile from membership) = 'employee'
        then target_action in ('create', 'edit')
      else false
    end;
$$;

create or replace function public.apply_product_command(
  p_workspace_id uuid,
  p_product_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_sku text default null,
  p_name text default null,
  p_barcode text default null,
  p_brand text default null,
  p_category text default null,
  p_purpose text default null,
  p_unit_label text default 'unit',
  p_unit_cost numeric default 0,
  p_selling_price numeric default null,
  p_vat_rate numeric default 0,
  p_reorder_level numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_record public.products;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported product action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Product idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.product_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.product_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Product write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_sku is null or char_length(trim(p_sku)) not between 1 and 64 then
      raise exception 'Product SKU is invalid';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 2 and 160 then
      raise exception 'Product name is invalid';
    end if;
    if p_purpose not in ('resale', 'supply') then
      raise exception 'Product purpose is invalid';
    end if;
    if p_unit_label is null or char_length(trim(p_unit_label)) not between 1 and 24 then
      raise exception 'Product unit is invalid';
    end if;
    if p_unit_cost is null or p_unit_cost < 0 then
      raise exception 'Product cost is invalid';
    end if;
    if p_selling_price is not null and p_selling_price < 0 then
      raise exception 'Product selling price is invalid';
    end if;
    if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
      raise exception 'Product VAT rate is invalid';
    end if;
    if p_reorder_level is null or p_reorder_level < 0 then
      raise exception 'Product reorder level is invalid';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.products where id = p_product_id) then
      raise exception 'Product identity conflict';
    end if;

    insert into public.products (
      id, workspace_id, sku, name, barcode, brand, category, purpose,
      unit_label, unit_cost, selling_price, vat_rate, reorder_level,
      notes, created_by, updated_by
    ) values (
      p_product_id,
      p_workspace_id,
      trim(p_sku),
      trim(p_name),
      nullif(trim(p_barcode), ''),
      nullif(trim(p_brand), ''),
      nullif(trim(p_category), ''),
      p_purpose,
      trim(p_unit_label),
      p_unit_cost,
      p_selling_price,
      p_vat_rate,
      p_reorder_level,
      nullif(trim(p_notes), ''),
      p_actor_user_id,
      p_actor_user_id
    ) returning * into product_record;
    activity_action := 'Product created';
    activity_tone := 'blue';
  else
    select * into product_record
    from public.products
    where workspace_id = p_workspace_id and id = p_product_id
    for update;

    if product_record.id is null then
      raise exception 'Product not found';
    end if;
    if p_expected_version is null or product_record.version <> p_expected_version then
      raise exception 'Product changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      update public.products
      set sku = trim(p_sku),
          name = trim(p_name),
          barcode = nullif(trim(p_barcode), ''),
          brand = nullif(trim(p_brand), ''),
          category = nullif(trim(p_category), ''),
          purpose = p_purpose,
          unit_label = trim(p_unit_label),
          unit_cost = p_unit_cost,
          selling_price = p_selling_price,
          vat_rate = p_vat_rate,
          reorder_level = p_reorder_level,
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_product_id
      returning * into product_record;
      activity_action := 'Product updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.products
      set status = 'archived',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_product_id
      returning * into product_record;
      activity_action := 'Product archived';
      activity_tone := 'gold';
    else
      update public.products
      set status = 'active',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_product_id
      returning * into product_record;
      activity_action := 'Product restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object(
    'action', p_action,
    'product', to_jsonb(product_record)
  );

  insert into public.product_command_receipts (
    workspace_id, idempotency_key, product_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), product_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    activity_action,
    product_record.name || ' · ' || product_record.sku::text,
    activity_tone,
    'product',
    product_record.id::text,
    p_command_id,
    jsonb_build_object(
      'product_id', product_record.id,
      'sku', product_record.sku::text,
      'status', product_record.status,
      'version', product_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.product_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_product_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;

grant execute on function private.product_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_product_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) to service_role;

revoke all on table public.products, public.product_command_receipts from anon, authenticated;
grant select on table public.products to authenticated;

alter table public.products enable row level security;
alter table public.product_command_receipts enable row level security;

create policy "Products permission read"
on public.products for select to authenticated
using (private.has_workspace_permission(workspace_id, 'products', 'view'));

comment on table public.products is
  'Workspace-owned reusable product definitions. Stock quantity is derived by Inventory and is never stored here.';
comment on column public.products.version is
  'Optimistic concurrency version used to reject stale offline edits.';
comment on table public.product_command_receipts is
  'Stable command receipts preventing duplicate product mutations during offline retry.';

commit;


begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'suppliers',
  'Suppliers',
  'Reusable supplier identities and default purchasing terms for Products, Purchasing, Inventory and Accounts.',
  'operations',
  '/suppliers',
  48,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

create table public.suppliers (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null check (char_length(trim(code::text)) between 1 and 64),
  name text not null check (char_length(trim(name)) between 2 and 160),
  supplier_type text not null check (supplier_type in ('product', 'service', 'expense')),
  contact_name text check (contact_name is null or char_length(contact_name) <= 160),
  email extensions.citext check (email is null or char_length(email::text) <= 254),
  phone text check (phone is null or char_length(phone) <= 64),
  vat_registration_number text check (
    vat_registration_number is null or char_length(vat_registration_number) <= 80
  ),
  payment_terms_days integer not null default 0 check (payment_terms_days between 0 and 365),
  default_discount numeric(5,2) not null default 0 check (default_discount between 0 and 100),
  document_currency text not null default 'EUR' check (document_currency ~ '^[A-Z]{3}$'),
  categories text[] not null default '{}'::text[],
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 240),
  postcode text check (postcode is null or char_length(postcode) <= 32),
  country text check (country is null or char_length(country) <= 120),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

create index suppliers_workspace_status_name_idx
  on public.suppliers(workspace_id, status, name);

create index suppliers_workspace_type_name_idx
  on public.suppliers(workspace_id, supplier_type, name);

create table public.supplier_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  supplier_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, supplier_id)
    references public.suppliers(workspace_id, id) on delete cascade
);

create index supplier_command_receipts_supplier_idx
  on public.supplier_command_receipts(workspace_id, supplier_id, created_at desc);

drop trigger if exists suppliers_touch_updated_at on public.suppliers;
create trigger suppliers_touch_updated_at
before update on public.suppliers
for each row execute function private.touch_updated_at();

create or replace function private.supplier_actor_can_write(
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
  with membership as (
    select m.access_profile
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = target_workspace_id
      and m.user_id = target_actor_user_id
      and m.status = 'active'
      and w.status in ('trial', 'active')
      and p.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'suppliers'
    limit 1
  )
  select private.has_feature(target_workspace_id, 'suppliers')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        else false
      end
      when (select access_profile from membership) = 'manager'
        then target_action in ('create', 'edit')
      when (select access_profile from membership) = 'employee'
        then target_action in ('create', 'edit')
      else false
    end;
$$;

create or replace function public.apply_supplier_command(
  p_workspace_id uuid,
  p_supplier_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_supplier_type text default null,
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_vat_registration_number text default null,
  p_payment_terms_days integer default 0,
  p_default_discount numeric default 0,
  p_document_currency text default 'EUR',
  p_categories text[] default '{}'::text[],
  p_address_line1 text default null,
  p_postcode text default null,
  p_country text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_record public.suppliers;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
  normalized_categories text[];
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported supplier action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Supplier idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.supplier_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.supplier_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Supplier write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_code is null or char_length(trim(p_code)) not between 1 and 64 then
      raise exception 'Supplier code is invalid';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 2 and 160 then
      raise exception 'Supplier name is invalid';
    end if;
    if p_supplier_type not in ('product', 'service', 'expense') then
      raise exception 'Supplier type is invalid';
    end if;
    if p_contact_name is not null and char_length(trim(p_contact_name)) > 160 then
      raise exception 'Supplier contact is invalid';
    end if;
    if p_email is not null and char_length(trim(p_email)) > 254 then
      raise exception 'Supplier email is invalid';
    end if;
    if p_phone is not null and char_length(trim(p_phone)) > 64 then
      raise exception 'Supplier phone is invalid';
    end if;
    if p_vat_registration_number is not null and char_length(trim(p_vat_registration_number)) > 80 then
      raise exception 'Supplier registration number is invalid';
    end if;
    if p_payment_terms_days is null or p_payment_terms_days < 0 or p_payment_terms_days > 365 then
      raise exception 'Supplier payment terms are invalid';
    end if;
    if p_default_discount is null or p_default_discount < 0 or p_default_discount > 100 then
      raise exception 'Supplier default discount is invalid';
    end if;
    if p_document_currency is null or upper(trim(p_document_currency)) !~ '^[A-Z]{3}$' then
      raise exception 'Supplier document currency is invalid';
    end if;
    if cardinality(coalesce(p_categories, '{}'::text[])) > 20 then
      raise exception 'Supplier categories are invalid';
    end if;
    if exists (
      select 1
      from unnest(coalesce(p_categories, '{}'::text[])) category
      where char_length(trim(category)) > 80
    ) then
      raise exception 'Supplier category is too long';
    end if;

    select coalesce(array_agg(category order by category), '{}'::text[])
      into normalized_categories
    from (
      select distinct trim(category) as category
      from unnest(coalesce(p_categories, '{}'::text[])) category
      where trim(category) <> ''
    ) normalized;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.suppliers where id = p_supplier_id) then
      raise exception 'Supplier identity conflict';
    end if;

    insert into public.suppliers (
      id, workspace_id, code, name, supplier_type, contact_name, email, phone,
      vat_registration_number, payment_terms_days, default_discount,
      document_currency, categories, address_line1, postcode, country, notes,
      created_by, updated_by
    ) values (
      p_supplier_id,
      p_workspace_id,
      trim(p_code),
      trim(p_name),
      p_supplier_type,
      nullif(trim(p_contact_name), ''),
      nullif(lower(trim(p_email)), ''),
      nullif(trim(p_phone), ''),
      nullif(trim(p_vat_registration_number), ''),
      p_payment_terms_days,
      p_default_discount,
      upper(trim(p_document_currency)),
      normalized_categories,
      nullif(trim(p_address_line1), ''),
      nullif(trim(p_postcode), ''),
      nullif(trim(p_country), ''),
      nullif(trim(p_notes), ''),
      p_actor_user_id,
      p_actor_user_id
    ) returning * into supplier_record;
    activity_action := 'Supplier created';
    activity_tone := 'blue';
  else
    select * into supplier_record
    from public.suppliers
    where workspace_id = p_workspace_id and id = p_supplier_id
    for update;

    if supplier_record.id is null then
      raise exception 'Supplier not found';
    end if;
    if p_expected_version is null or supplier_record.version <> p_expected_version then
      raise exception 'Supplier changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      update public.suppliers
      set code = trim(p_code),
          name = trim(p_name),
          supplier_type = p_supplier_type,
          contact_name = nullif(trim(p_contact_name), ''),
          email = nullif(lower(trim(p_email)), ''),
          phone = nullif(trim(p_phone), ''),
          vat_registration_number = nullif(trim(p_vat_registration_number), ''),
          payment_terms_days = p_payment_terms_days,
          default_discount = p_default_discount,
          document_currency = upper(trim(p_document_currency)),
          categories = normalized_categories,
          address_line1 = nullif(trim(p_address_line1), ''),
          postcode = nullif(trim(p_postcode), ''),
          country = nullif(trim(p_country), ''),
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_supplier_id
      returning * into supplier_record;
      activity_action := 'Supplier updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.suppliers
      set status = 'archived',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_supplier_id
      returning * into supplier_record;
      activity_action := 'Supplier archived';
      activity_tone := 'gold';
    else
      update public.suppliers
      set status = 'active',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_supplier_id
      returning * into supplier_record;
      activity_action := 'Supplier restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object(
    'action', p_action,
    'supplier', to_jsonb(supplier_record)
  );

  insert into public.supplier_command_receipts (
    workspace_id, idempotency_key, supplier_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), supplier_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    activity_action,
    supplier_record.name || ' · ' || supplier_record.code::text,
    activity_tone,
    'supplier',
    supplier_record.id::text,
    p_command_id,
    jsonb_build_object(
      'supplier_id', supplier_record.id,
      'code', supplier_record.code::text,
      'status', supplier_record.status,
      'version', supplier_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.supplier_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, integer, numeric, text, text[], text, text, text, text) from public, anon, authenticated;

grant execute on function private.supplier_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, integer, numeric, text, text[], text, text, text, text) to service_role;

revoke all on table public.suppliers, public.supplier_command_receipts from anon, authenticated;
grant select on table public.suppliers to authenticated;

alter table public.suppliers enable row level security;
alter table public.supplier_command_receipts enable row level security;

create policy "Suppliers permission read"
on public.suppliers for select to authenticated
using (private.has_workspace_permission(workspace_id, 'suppliers', 'view'));

comment on table public.suppliers is
  'Workspace-owned supplier identities and default purchasing terms. Product-specific prices and payment execution are stored elsewhere.';
comment on column public.suppliers.version is
  'Optimistic concurrency version used to reject stale offline edits.';
comment on table public.supplier_command_receipts is
  'Service-role-only supplier command receipts used for idempotent offline retry.';
comment on function private.supplier_actor_can_write(uuid, uuid, text) is
  'Validates Supplier mutation permission through active workspace membership, feature entitlement and member permissions.';
comment on function public.apply_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, integer, numeric, text, text[], text, text, text, text) is
  'Trusted idempotent Supplier mutation boundary. Browser roles cannot execute this function.';

commit;


begin;

create table public.product_suppliers (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  supplier_id uuid not null,
  supplier_sku extensions.citext check (supplier_sku is null or char_length(trim(supplier_sku::text)) <= 64),
  supplier_cost numeric(14,4) check (supplier_cost is null or supplier_cost >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  is_preferred boolean not null default false,
  lead_time_days integer not null default 0 check (lead_time_days between 0 and 3650),
  minimum_order_quantity numeric(14,3) not null default 1 check (minimum_order_quantity > 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, product_id, supplier_id),
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_id)
    references public.suppliers(workspace_id, id) on delete restrict
);

create unique index product_suppliers_supplier_sku_idx
  on public.product_suppliers(workspace_id, supplier_id, supplier_sku)
  where supplier_sku is not null and trim(supplier_sku::text) <> '';

create unique index product_suppliers_preferred_product_idx
  on public.product_suppliers(workspace_id, product_id)
  where is_preferred and status = 'active';

create index product_suppliers_product_status_idx
  on public.product_suppliers(workspace_id, product_id, status, is_preferred desc);

create index product_suppliers_supplier_status_idx
  on public.product_suppliers(workspace_id, supplier_id, status);

create table public.product_supplier_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  relationship_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, relationship_id)
    references public.product_suppliers(workspace_id, id) on delete cascade
);

create index product_supplier_receipts_relationship_idx
  on public.product_supplier_command_receipts(workspace_id, relationship_id, created_at desc);

drop trigger if exists product_suppliers_touch_updated_at on public.product_suppliers;
create trigger product_suppliers_touch_updated_at
before update on public.product_suppliers
for each row execute function private.touch_updated_at();

create or replace function private.product_supplier_actor_can_write(
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
  with membership as (
    select m.access_profile
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = target_workspace_id
      and m.user_id = target_actor_user_id
      and m.status = 'active'
      and w.status in ('trial', 'active')
      and p.is_active
    limit 1
  ), product_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'products'
    limit 1
  ), supplier_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'suppliers'
    limit 1
  )
  select private.has_feature(target_workspace_id, 'products')
    and private.has_feature(target_workspace_id, 'suppliers')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from product_permission)
        then (select can_view from product_permission)
      when (select access_profile from membership) in ('manager', 'employee') then true
      else false
    end
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from supplier_permission) then case target_action
        when 'create' then (select can_create from supplier_permission)
        when 'edit' then (select can_edit from supplier_permission)
        else false
      end
      when (select access_profile from membership) in ('manager', 'employee')
        then target_action in ('create', 'edit')
      else false
    end;
$$;

create or replace function public.apply_product_supplier_command(
  p_workspace_id uuid,
  p_relationship_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_product_id uuid default null,
  p_supplier_id uuid default null,
  p_supplier_sku text default null,
  p_supplier_cost numeric default null,
  p_currency text default 'EUR',
  p_is_preferred boolean default false,
  p_lead_time_days integer default 0,
  p_minimum_order_quantity numeric default 1,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship_record public.product_suppliers;
  product_record public.products;
  supplier_record public.suppliers;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported Product Supplier action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Product Supplier idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.product_supplier_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.product_supplier_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Product Supplier write access denied';
  end if;

  if p_action in ('create', 'update', 'restore') then
    if p_product_id is null or p_supplier_id is null then
      raise exception 'Product Supplier identities are required';
    end if;

    select * into product_record
    from public.products
    where workspace_id = p_workspace_id and id = p_product_id;
    if product_record.id is null then
      raise exception 'Product not found';
    end if;
    if product_record.status <> 'active' then
      raise exception 'Archived products cannot receive active supplier relationships';
    end if;

    select * into supplier_record
    from public.suppliers
    where workspace_id = p_workspace_id and id = p_supplier_id;
    if supplier_record.id is null then
      raise exception 'Supplier not found';
    end if;
    if supplier_record.status <> 'active' then
      raise exception 'Archived suppliers cannot receive active product relationships';
    end if;
    if supplier_record.supplier_type <> 'product' then
      raise exception 'Only Product suppliers can be linked to Products';
    end if;

    if p_supplier_sku is not null and char_length(trim(p_supplier_sku)) > 64 then
      raise exception 'Supplier SKU is invalid';
    end if;
    if p_supplier_cost is not null and p_supplier_cost < 0 then
      raise exception 'Supplier cost is invalid';
    end if;
    if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then
      raise exception 'Supplier relationship currency is invalid';
    end if;
    if p_lead_time_days is null or p_lead_time_days < 0 or p_lead_time_days > 3650 then
      raise exception 'Lead time is invalid';
    end if;
    if p_minimum_order_quantity is null or p_minimum_order_quantity <= 0 then
      raise exception 'Minimum order quantity is invalid';
    end if;
    if p_notes is not null and char_length(p_notes) > 2000 then
      raise exception 'Supplier relationship notes are too long';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.product_suppliers where id = p_relationship_id) then
      raise exception 'Product Supplier identity conflict';
    end if;

    insert into public.product_suppliers (
      id, workspace_id, product_id, supplier_id, supplier_sku, supplier_cost,
      currency, is_preferred, lead_time_days, minimum_order_quantity, notes,
      created_by, updated_by
    ) values (
      p_relationship_id,
      p_workspace_id,
      p_product_id,
      p_supplier_id,
      nullif(trim(p_supplier_sku), ''),
      p_supplier_cost,
      upper(trim(p_currency)),
      p_is_preferred,
      p_lead_time_days,
      p_minimum_order_quantity,
      nullif(trim(p_notes), ''),
      p_actor_user_id,
      p_actor_user_id
    ) returning * into relationship_record;
    activity_action := 'Product supplier linked';
    activity_tone := 'blue';
  else
    select * into relationship_record
    from public.product_suppliers
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;

    if relationship_record.id is null then
      raise exception 'Product Supplier relationship not found';
    end if;
    if p_expected_version is null or relationship_record.version <> p_expected_version then
      raise exception 'Product Supplier relationship changed on another device; refresh before saving';
    end if;

    if p_action in ('update', 'restore') and (
      relationship_record.product_id <> p_product_id
      or relationship_record.supplier_id <> p_supplier_id
    ) then
      raise exception 'Product Supplier identities cannot be changed';
    end if;

    if p_action = 'update' then
      update public.product_suppliers
      set supplier_sku = nullif(trim(p_supplier_sku), ''),
          supplier_cost = p_supplier_cost,
          currency = upper(trim(p_currency)),
          is_preferred = p_is_preferred,
          lead_time_days = p_lead_time_days,
          minimum_order_quantity = p_minimum_order_quantity,
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_relationship_id
      returning * into relationship_record;
      activity_action := 'Product supplier updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.product_suppliers
      set status = 'archived',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_relationship_id
      returning * into relationship_record;
      activity_action := 'Product supplier archived';
      activity_tone := 'gold';
    else
      update public.product_suppliers
      set status = 'active',
          supplier_sku = nullif(trim(p_supplier_sku), ''),
          supplier_cost = p_supplier_cost,
          currency = upper(trim(p_currency)),
          is_preferred = p_is_preferred,
          lead_time_days = p_lead_time_days,
          minimum_order_quantity = p_minimum_order_quantity,
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_relationship_id
      returning * into relationship_record;
      activity_action := 'Product supplier restored';
      activity_tone := 'green';
    end if;
  end if;

  if product_record.id is null then
    select * into product_record
    from public.products
    where workspace_id = p_workspace_id and id = relationship_record.product_id;
  end if;
  if supplier_record.id is null then
    select * into supplier_record
    from public.suppliers
    where workspace_id = p_workspace_id and id = relationship_record.supplier_id;
  end if;

  command_result := jsonb_build_object(
    'action', p_action,
    'relationship', to_jsonb(relationship_record)
  );

  insert into public.product_supplier_command_receipts (
    workspace_id, idempotency_key, relationship_id, action, result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    relationship_record.id,
    p_action,
    command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    activity_action,
    product_record.name || ' ↔ ' || supplier_record.name,
    activity_tone,
    'product_supplier',
    relationship_record.id::text,
    p_command_id,
    jsonb_build_object(
      'relationship_id', relationship_record.id,
      'product_id', relationship_record.product_id,
      'supplier_id', relationship_record.supplier_id,
      'preferred', relationship_record.is_preferred,
      'status', relationship_record.status,
      'version', relationship_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.product_supplier_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) from public, anon, authenticated;

grant execute on function private.product_supplier_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) to service_role;

revoke all on table public.product_suppliers, public.product_supplier_command_receipts from anon, authenticated;
grant select on table public.product_suppliers to authenticated;
grant all on table public.product_suppliers, public.product_supplier_command_receipts to service_role;

alter table public.product_suppliers enable row level security;
alter table public.product_supplier_command_receipts enable row level security;

create policy "Product Supplier permission read"
on public.product_suppliers for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'products', 'view')
  and private.has_workspace_permission(workspace_id, 'suppliers', 'view')
);

comment on table public.product_suppliers is
  'Workspace-owned Product-to-Supplier relationships containing supplier-specific purchasing terms only.';
comment on column public.product_suppliers.supplier_cost is
  'Supplier-specific catalogue cost. Purchasing documents preserve their own actual historical line cost.';
comment on column public.product_suppliers.is_preferred is
  'At most one active preferred supplier may exist for each Product.';
comment on function private.product_supplier_actor_can_write(uuid, uuid, text) is
  'Validates Product/Supplier relationship mutation through active membership and the existing Products/Suppliers feature permission model.';
comment on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) is
  'Trusted idempotent command for Product Supplier create, update, archive and restore operations.';

commit;
