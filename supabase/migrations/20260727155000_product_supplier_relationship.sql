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
  select not exists (
      select 1
      from public.platform_support_sessions support_session
      where support_session.admin_user_id = target_actor_user_id
        and support_session.workspace_id = target_workspace_id
        and support_session.ended_at is null
        and support_session.expires_at > now()
    )
    and private.has_feature(target_workspace_id, 'products')
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
comment on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) is
  'Trusted idempotent command for Product Supplier create, update, archive and restore operations.';

commit;
