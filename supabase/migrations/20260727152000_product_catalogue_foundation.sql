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
