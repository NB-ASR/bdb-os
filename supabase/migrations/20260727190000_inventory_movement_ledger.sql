begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'inventory',
  'Inventory',
  'Product stock locations, immutable movements and controlled downstream posting.',
  'operations',
  '/inventory',
  85,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

create table public.inventory_locations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null check (char_length(trim(code::text)) between 1 and 32),
  name text not null check (char_length(trim(name)) between 2 and 120),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

create unique index inventory_locations_one_active_default_idx
  on public.inventory_locations(workspace_id)
  where is_default and status = 'active';

create index inventory_locations_workspace_status_name_idx
  on public.inventory_locations(workspace_id, status, name);

create table public.inventory_movements (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  location_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'opening_balance',
      'purchase_receipt',
      'sale',
      'appointment_consumption',
      'internal_consumption',
      'customer_return',
      'supplier_return',
      'transfer_out',
      'transfer_in',
      'manual_adjustment',
      'stocktake_correction',
      'write_off',
      'reversal'
    )
  ),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  source_type text check (source_type is null or source_type ~ '^[a-z][a-z0-9_]{1,47}$'),
  source_id text check (source_id is null or char_length(source_id) <= 160),
  supplier_document_id uuid,
  supplier_document_line_id uuid,
  transfer_group_id uuid,
  reversal_of_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  command_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  note text check (note is null or char_length(note) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, location_id)
    references public.inventory_locations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id)
    references public.inventory_movements(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_document_id)
    references public.supplier_documents(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supplier_document_line_id)
    references public.supplier_document_lines(workspace_id, id) on delete restrict,
  constraint inventory_movements_reversal_shape check (
    (movement_type = 'reversal' and reversal_of_id is not null)
    or (movement_type <> 'reversal' and reversal_of_id is null)
  ),
  constraint inventory_movements_transfer_shape check (
    (movement_type in ('transfer_out', 'transfer_in') and transfer_group_id is not null)
    or (movement_type not in ('transfer_out', 'transfer_in') and transfer_group_id is null)
  ),
  constraint inventory_movements_inbound_direction check (
    movement_type not in ('opening_balance', 'purchase_receipt', 'customer_return', 'transfer_in')
    or quantity_delta > 0
  ),
  constraint inventory_movements_outbound_direction check (
    movement_type not in ('sale', 'appointment_consumption', 'internal_consumption', 'supplier_return', 'transfer_out', 'write_off')
    or quantity_delta < 0
  ),
  constraint inventory_movements_supplier_document_shape check (
    (supplier_document_line_id is null and supplier_document_id is null)
    or (supplier_document_line_id is not null and supplier_document_id is not null)
  )
);

create index inventory_movements_workspace_product_time_idx
  on public.inventory_movements(workspace_id, product_id, occurred_at desc, id desc);
create index inventory_movements_workspace_location_time_idx
  on public.inventory_movements(workspace_id, location_id, occurred_at desc, id desc);
create index inventory_movements_workspace_source_idx
  on public.inventory_movements(workspace_id, source_type, source_id)
  where source_type is not null and source_id is not null;
create index inventory_movements_supplier_document_idx
  on public.inventory_movements(workspace_id, supplier_document_id, supplier_document_line_id)
  where supplier_document_id is not null;
create unique index inventory_movements_single_reversal_idx
  on public.inventory_movements(workspace_id, reversal_of_id)
  where reversal_of_id is not null;
create unique index inventory_movements_single_document_line_post_idx
  on public.inventory_movements(workspace_id, supplier_document_line_id)
  where supplier_document_line_id is not null and movement_type <> 'reversal';

create table public.inventory_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  action text not null check (
    action in (
      'create_location',
      'update_location',
      'archive_location',
      'restore_location',
      'post_movement',
      'reverse_movement',
      'transfer_stock',
      'post_supplier_document',
      'reverse_supplier_document'
    )
  ),
  entity_type text not null check (char_length(entity_type) between 2 and 64),
  entity_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index inventory_command_receipts_entity_idx
  on public.inventory_command_receipts(workspace_id, entity_type, entity_id, created_at desc);

create view public.inventory_stock_balances
with (security_invoker = true)
as
select
  movement.workspace_id,
  movement.product_id,
  movement.location_id,
  sum(movement.quantity_delta)::numeric(14,3) as quantity
from public.inventory_movements movement
group by movement.workspace_id, movement.product_id, movement.location_id;

create view public.inventory_product_totals
with (security_invoker = true)
as
select
  product.workspace_id,
  product.id as product_id,
  coalesce(sum(movement.quantity_delta), 0::numeric)::numeric(14,3) as quantity,
  product.reorder_level,
  product.unit_cost,
  product.selling_price,
  (coalesce(sum(movement.quantity_delta), 0::numeric) * product.unit_cost)::numeric(16,4) as catalogue_cost_value,
  case
    when product.purpose = 'resale' and product.selling_price is not null
      then (coalesce(sum(movement.quantity_delta), 0::numeric) * product.selling_price)::numeric(16,4)
    else 0::numeric
  end as potential_resale_value
from public.products product
left join public.inventory_movements movement
  on movement.workspace_id = product.workspace_id
 and movement.product_id = product.id
group by product.workspace_id, product.id, product.reorder_level, product.unit_cost, product.selling_price, product.purpose;

create or replace function private.inventory_actor_can_write(
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
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'inventory'
    limit 1
  )
  select private.has_feature(target_workspace_id, 'inventory')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        when 'approve' then (select can_approve from explicit_permission)
        else false
      end
      when (select access_profile from membership) = 'manager'
        then target_action in ('create', 'edit', 'approve')
      else false
    end;
$$;

create or replace function private.inventory_actor_can_view_feature(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with membership as (
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  ), explicit_permission as (
    select permission.can_view
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = target_feature_key
    limit 1
  )
  select private.has_feature(target_workspace_id, target_feature_key)
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission)
        then (select can_view from explicit_permission)
      when (select access_profile from membership) in ('manager', 'employee') then true
      else false
    end;
$$;

create or replace function private.prevent_inventory_movement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Posted Inventory movements are immutable; create a reversal instead';
end;
$$;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function private.prevent_inventory_movement_change();

drop trigger if exists inventory_locations_touch_updated_at on public.inventory_locations;
create trigger inventory_locations_touch_updated_at
before update on public.inventory_locations
for each row execute function private.touch_updated_at();

create or replace function public.apply_inventory_location_command(
  p_workspace_id uuid,
  p_location_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_record public.inventory_locations;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported Inventory location action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Inventory idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Inventory write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_code is null or char_length(trim(p_code)) not between 1 and 32 then
      raise exception 'Inventory location code is invalid';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 2 and 120 then
      raise exception 'Inventory location name is invalid';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.inventory_locations where id = p_location_id) then
      raise exception 'Inventory location identity conflict';
    end if;
    if p_is_default then
      update public.inventory_locations
      set is_default = false, updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and is_default and status = 'active';
    end if;
    insert into public.inventory_locations (
      id, workspace_id, code, name, is_default, created_by, updated_by
    ) values (
      p_location_id, p_workspace_id, trim(p_code), trim(p_name), p_is_default,
      p_actor_user_id, p_actor_user_id
    ) returning * into location_record;
    activity_action := 'Inventory location created';
    activity_tone := 'blue';
  else
    select * into location_record
    from public.inventory_locations
    where workspace_id = p_workspace_id and id = p_location_id
    for update;
    if location_record.id is null then raise exception 'Inventory location not found'; end if;
    if p_expected_version is null or location_record.version <> p_expected_version then
      raise exception 'Inventory location changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      if p_is_default then
        update public.inventory_locations
        set is_default = false, updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id <> p_location_id and is_default and status = 'active';
      end if;
      update public.inventory_locations
      set code = trim(p_code),
          name = trim(p_name),
          is_default = p_is_default,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_location_id
      returning * into location_record;
      activity_action := 'Inventory location updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      if exists (
        select 1 from public.inventory_stock_balances balance
        where balance.workspace_id = p_workspace_id
          and balance.location_id = p_location_id
          and balance.quantity <> 0
      ) then
        raise exception 'Inventory location cannot be archived while stock remains';
      end if;
      update public.inventory_locations
      set status = 'archived', is_default = false,
          updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_location_id
      returning * into location_record;
      activity_action := 'Inventory location archived';
      activity_tone := 'gold';
    else
      if p_is_default then
        update public.inventory_locations
        set is_default = false, updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id <> p_location_id and is_default and status = 'active';
      end if;
      update public.inventory_locations
      set status = 'active', is_default = p_is_default,
          updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_location_id
      returning * into location_record;
      activity_action := 'Inventory location restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object('action', p_action, 'location', to_jsonb(location_record));
  insert into public.inventory_command_receipts (
    workspace_id, idempotency_key, action, entity_type, entity_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), p_action || '_location',
    'inventory_location', location_record.id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    location_record.name || ' · ' || location_record.code::text,
    activity_tone, 'inventory_location', location_record.id::text, p_command_id,
    jsonb_build_object(
      'status', location_record.status,
      'is_default', location_record.is_default,
      'version', location_record.version,
      'idempotency_key', p_idempotency_key
    )
  );
  return command_result;
end;
$$;

create or replace function public.post_inventory_movement(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_unit_cost numeric default null,
  p_currency text default null,
  p_source_type text default null,
  p_source_id text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_reversal_of_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_record public.inventory_movements;
  original_record public.inventory_movements;
  product_record public.products;
  previous_result jsonb;
  command_result jsonb;
  effective_product_id uuid := p_product_id;
  effective_location_id uuid := p_location_id;
  effective_type text := p_movement_type;
  effective_delta numeric := p_quantity_delta;
  effective_unit_cost numeric := p_unit_cost;
  effective_currency text := p_currency;
  action_name text := 'post_movement';
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Inventory idempotency key is invalid';
  end if;
  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Inventory write access denied';
  end if;

  if p_reversal_of_id is not null then
    action_name := 'reverse_movement';
    select * into original_record
    from public.inventory_movements
    where workspace_id = p_workspace_id and id = p_reversal_of_id
    for update;
    if original_record.id is null then raise exception 'Original Inventory movement not found'; end if;
    if original_record.movement_type = 'reversal' then raise exception 'A reversal cannot be reversed again'; end if;
    if original_record.transfer_group_id is not null then raise exception 'Transfer movements must be corrected as a complete transfer'; end if;
    if original_record.supplier_document_id is not null then
      raise exception 'Purchasing movements must be reversed from the supplier document';
    end if;
    if exists (
      select 1 from public.inventory_movements movement
      where movement.workspace_id = p_workspace_id and movement.reversal_of_id = p_reversal_of_id
    ) then
      raise exception 'Inventory movement has already been reversed';
    end if;
    effective_product_id := original_record.product_id;
    effective_location_id := original_record.location_id;
    effective_type := 'reversal';
    effective_delta := -original_record.quantity_delta;
    effective_unit_cost := original_record.unit_cost;
    effective_currency := original_record.currency;
  end if;

  if effective_type not in (
    'opening_balance', 'purchase_receipt', 'sale', 'appointment_consumption',
    'internal_consumption', 'customer_return', 'supplier_return', 'manual_adjustment',
    'stocktake_correction', 'write_off', 'reversal'
  ) then raise exception 'Inventory movement type is invalid'; end if;
  if effective_delta is null or effective_delta = 0 then raise exception 'Inventory movement quantity must be non-zero'; end if;
  if effective_unit_cost is not null and effective_unit_cost < 0 then raise exception 'Inventory movement cost is invalid'; end if;
  if effective_currency is not null and upper(trim(effective_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Inventory movement currency is invalid';
  end if;
  if effective_type in ('purchase_receipt', 'supplier_return') and p_reversal_of_id is null then
    raise exception 'Purchasing stock changes must be posted from an approved supplier document';
  end if;

  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id
    and product.id = effective_product_id
    and (product.status = 'active' or p_reversal_of_id is not null);
  if product_record.id is null then raise exception 'Inventory Product is unavailable'; end if;
  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id
      and location.id = effective_location_id
      and (location.status = 'active' or p_reversal_of_id is not null)
  ) then raise exception 'Inventory location is unavailable'; end if;

  insert into public.inventory_movements (
    id, workspace_id, product_id, location_id, movement_type, quantity_delta,
    unit_cost, currency, source_type, source_id, reversal_of_id,
    idempotency_key, command_id, actor_user_id, note, metadata, occurred_at
  ) values (
    p_movement_id, p_workspace_id, effective_product_id, effective_location_id,
    effective_type, effective_delta, effective_unit_cost,
    case when effective_currency is null then null else upper(trim(effective_currency)) end,
    case when p_reversal_of_id is null then nullif(trim(p_source_type), '') else 'inventory_reversal' end,
    case when p_reversal_of_id is null then nullif(trim(p_source_id), '') else p_reversal_of_id::text end,
    p_reversal_of_id, trim(p_idempotency_key), p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into movement_record;

  command_result := jsonb_build_object('action', action_name, 'movement', to_jsonb(movement_record));
  insert into public.inventory_command_receipts (
    workspace_id, idempotency_key, action, entity_type, entity_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), action_name,
    'inventory_movement', movement_record.id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id,
    case when effective_type = 'reversal' then 'Inventory movement reversed' else 'Inventory movement posted' end,
    product_record.name || ' · ' || replace(effective_type, '_', ' ') || ' · ' || effective_delta::text,
    case when effective_delta < 0 then 'gold' else 'green' end,
    'inventory_movement', movement_record.id::text, p_command_id,
    jsonb_build_object(
      'product_id', effective_product_id,
      'location_id', effective_location_id,
      'movement_type', effective_type,
      'quantity_delta', effective_delta,
      'reversal_of_id', p_reversal_of_id,
      'idempotency_key', p_idempotency_key
    ) || coalesce(p_metadata, '{}'::jsonb)
  );
  return command_result;
end;
$$;

create or replace function public.transfer_inventory_stock(
  p_workspace_id uuid,
  p_out_movement_id uuid,
  p_in_movement_id uuid,
  p_transfer_group_id uuid,
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  out_record public.inventory_movements;
  in_record public.inventory_movements;
  product_record public.products;
  previous_result jsonb;
  command_result jsonb;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 80 then
    raise exception 'Inventory transfer idempotency key is invalid';
  end if;
  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Inventory write access denied';
  end if;
  if p_from_location_id = p_to_location_id then raise exception 'Transfer locations must be different'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Transfer quantity must be positive'; end if;

  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id and product.id = p_product_id and product.status = 'active';
  if product_record.id is null then raise exception 'Inventory Product is unavailable'; end if;
  if not exists (
    select 1
    from public.inventory_locations location
    where location.workspace_id = p_workspace_id
      and location.id in (p_from_location_id, p_to_location_id)
      and location.status = 'active'
    group by location.workspace_id
    having count(*) = 2
  ) then raise exception 'Inventory transfer location is unavailable'; end if;

  insert into public.inventory_movements (
    id, workspace_id, product_id, location_id, movement_type, quantity_delta,
    transfer_group_id, idempotency_key, command_id, actor_user_id, note, metadata, occurred_at
  ) values (
    p_out_movement_id, p_workspace_id, p_product_id, p_from_location_id,
    'transfer_out', -abs(p_quantity), p_transfer_group_id,
    trim(p_idempotency_key) || ':out', p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into out_record;

  insert into public.inventory_movements (
    id, workspace_id, product_id, location_id, movement_type, quantity_delta,
    transfer_group_id, idempotency_key, command_id, actor_user_id, note, metadata, occurred_at
  ) values (
    p_in_movement_id, p_workspace_id, p_product_id, p_to_location_id,
    'transfer_in', abs(p_quantity), p_transfer_group_id,
    trim(p_idempotency_key) || ':in', p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into in_record;

  command_result := jsonb_build_object(
    'action', 'transfer_stock',
    'transferGroupId', p_transfer_group_id,
    'outMovement', to_jsonb(out_record),
    'inMovement', to_jsonb(in_record)
  );
  insert into public.inventory_command_receipts (
    workspace_id, idempotency_key, action, entity_type, entity_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'transfer_stock',
    'inventory_transfer', p_transfer_group_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Inventory transferred',
    product_record.name || ' · ' || abs(p_quantity)::text || ' moved between locations',
    'blue', 'inventory_transfer', p_transfer_group_id::text, p_command_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'from_location_id', p_from_location_id,
      'to_location_id', p_to_location_id,
      'quantity', abs(p_quantity),
      'out_movement_id', out_record.id,
      'in_movement_id', in_record.id,
      'idempotency_key', p_idempotency_key
    ) || coalesce(p_metadata, '{}'::jsonb)
  );
  return command_result;
end;
$$;

alter table public.supplier_documents
  drop constraint if exists supplier_documents_inventory_posting_status_check;

alter table public.supplier_documents
  alter column inventory_posting_status set default 'not_available',
  add constraint supplier_documents_inventory_posting_status_check
    check (inventory_posting_status in ('not_available', 'ready', 'posted', 'reversed')),
  add column inventory_location_id uuid,
  add column inventory_posted_at timestamptz,
  add column inventory_posted_by uuid references auth.users(id) on delete set null,
  add column inventory_reversed_at timestamptz,
  add column inventory_reversed_by uuid references auth.users(id) on delete set null,
  add foreign key (workspace_id, inventory_location_id)
    references public.inventory_locations(workspace_id, id) on delete restrict;

create index supplier_documents_inventory_posting_idx
  on public.supplier_documents(workspace_id, inventory_posting_status, approved_at desc);

create or replace function private.prepare_supplier_document_inventory_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.inventory_posting_status = 'not_available' then
    new.inventory_posting_status := 'ready';
  end if;
  return new;
end;
$$;

create trigger supplier_documents_prepare_inventory_status
before update on public.supplier_documents
for each row execute function private.prepare_supplier_document_inventory_status();

update public.supplier_documents
set inventory_posting_status = 'ready'
where status = 'approved' and inventory_posting_status = 'not_available';

create or replace function public.post_supplier_document_to_inventory(
  p_workspace_id uuid,
  p_document_id uuid,
  p_location_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  line_record public.supplier_document_lines;
  movement_record public.inventory_movements;
  previous_result jsonb;
  command_result jsonb;
  movements_result jsonb := '[]'::jsonb;
  movement_type_value text;
  quantity_delta_value numeric;
  movement_count integer := 0;
  total_quantity numeric := 0;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 80 then
    raise exception 'Inventory posting idempotency key is invalid';
  end if;
  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Inventory posting access denied';
  end if;
  if not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'purchasing')
     or not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'documents')
     or not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'products') then
    raise exception 'Inventory posting source access denied';
  end if;

  select * into document_record
  from public.supplier_documents document
  where document.workspace_id = p_workspace_id and document.id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status <> 'approved' then raise exception 'Supplier document must be approved before Inventory posting'; end if;
  if document_record.document_type not in ('invoice', 'credit_note') then raise exception 'Supplier document type cannot be posted to Inventory'; end if;
  if document_record.inventory_posting_status <> 'ready' then
    raise exception 'Supplier document is not ready for Inventory posting';
  end if;
  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id and location.id = p_location_id and location.status = 'active'
  ) then raise exception 'Inventory posting location is unavailable'; end if;
  if not exists (
    select 1 from public.supplier_document_lines line
    where line.workspace_id = p_workspace_id and line.document_id = p_document_id and line.line_kind = 'product'
  ) then raise exception 'Supplier document contains no Product lines to post'; end if;
  if exists (
    select 1 from public.supplier_document_lines line
    where line.workspace_id = p_workspace_id and line.document_id = p_document_id
      and line.line_kind = 'product' and line.matched_product_id is null
  ) then raise exception 'Every Product line must be matched before Inventory posting'; end if;

  movement_type_value := case when document_record.document_type = 'invoice' then 'purchase_receipt' else 'supplier_return' end;

  for line_record in
    select *
    from public.supplier_document_lines line
    where line.workspace_id = p_workspace_id
      and line.document_id = p_document_id
      and line.line_kind = 'product'
    order by line.line_number
  loop
    if not exists (
      select 1 from public.products product
      where product.workspace_id = p_workspace_id
        and product.id = line_record.matched_product_id
        and product.status = 'active'
    ) then raise exception 'A matched Product is archived or unavailable'; end if;

    quantity_delta_value := case
      when document_record.document_type = 'invoice' then abs(line_record.quantity)
      else -abs(line_record.quantity)
    end;

    insert into public.inventory_movements (
      id, workspace_id, product_id, location_id, movement_type, quantity_delta,
      unit_cost, currency, source_type, source_id, supplier_document_id,
      supplier_document_line_id, idempotency_key, command_id, actor_user_id,
      note, metadata, occurred_at
    ) values (
      gen_random_uuid(), p_workspace_id, line_record.matched_product_id, p_location_id,
      movement_type_value, quantity_delta_value, line_record.unit_cost,
      document_record.currency, 'supplier_document', p_document_id::text,
      p_document_id, line_record.id,
      left(trim(p_idempotency_key), 70) || ':line:' || line_record.id::text,
      p_command_id, p_actor_user_id,
      document_record.document_number || ' · line ' || line_record.line_number::text,
      jsonb_build_object(
        'supplier_id', document_record.supplier_id,
        'document_type', document_record.document_type,
        'document_number', document_record.document_number,
        'document_line_number', line_record.line_number,
        'printed_description', line_record.printed_description,
        'product_supplier_id', line_record.matched_product_supplier_id
      ),
      coalesce(document_record.document_date::timestamptz, now())
    ) returning * into movement_record;

    movements_result := movements_result || jsonb_build_array(to_jsonb(movement_record));
    movement_count := movement_count + 1;
    total_quantity := total_quantity + abs(quantity_delta_value);
  end loop;

  update public.supplier_documents
  set inventory_posting_status = 'posted',
      inventory_location_id = p_location_id,
      inventory_posted_at = now(),
      inventory_posted_by = p_actor_user_id,
      inventory_reversed_at = null,
      inventory_reversed_by = null,
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  command_result := jsonb_build_object(
    'action', 'post_supplier_document',
    'document', to_jsonb(document_record),
    'movements', movements_result,
    'movementCount', movement_count,
    'totalQuantity', total_quantity
  );
  insert into public.inventory_command_receipts (
    workspace_id, idempotency_key, action, entity_type, entity_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'post_supplier_document',
    'supplier_document', p_document_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier document posted to Inventory',
    coalesce(document_record.document_number, document_record.file_name) || ' · ' || movement_count::text || ' Product line(s)',
    case when document_record.document_type = 'credit_note' then 'gold' else 'green' end,
    'supplier_document', p_document_id::text, p_command_id,
    jsonb_build_object(
      'inventory_location_id', p_location_id,
      'movement_count', movement_count,
      'total_quantity', total_quantity,
      'document_type', document_record.document_type,
      'idempotency_key', p_idempotency_key
    )
  );
  return command_result;
end;
$$;

create or replace function public.reverse_supplier_document_inventory(
  p_workspace_id uuid,
  p_document_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  original_record public.inventory_movements;
  reversal_record public.inventory_movements;
  previous_result jsonb;
  command_result jsonb;
  reversals_result jsonb := '[]'::jsonb;
  reversal_count integer := 0;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 80 then
    raise exception 'Inventory reversal idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Inventory reversal reason is required';
  end if;
  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Inventory posting access denied';
  end if;
  if not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'purchasing')
     or not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'documents')
     or not private.inventory_actor_can_view_feature(p_workspace_id, p_actor_user_id, 'products') then
    raise exception 'Inventory posting source access denied';
  end if;

  select * into document_record
  from public.supplier_documents document
  where document.workspace_id = p_workspace_id and document.id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.inventory_posting_status <> 'posted' then
    raise exception 'Supplier document has no active Inventory posting to reverse';
  end if;

  for original_record in
    select movement.*
    from public.inventory_movements movement
    where movement.workspace_id = p_workspace_id
      and movement.supplier_document_id = p_document_id
      and movement.movement_type <> 'reversal'
    order by movement.occurred_at, movement.id
  loop
    if exists (
      select 1 from public.inventory_movements reversal
      where reversal.workspace_id = p_workspace_id and reversal.reversal_of_id = original_record.id
    ) then raise exception 'A supplier document Inventory movement has already been reversed'; end if;

    insert into public.inventory_movements (
      id, workspace_id, product_id, location_id, movement_type, quantity_delta,
      unit_cost, currency, source_type, source_id, supplier_document_id,
      supplier_document_line_id, reversal_of_id, idempotency_key, command_id,
      actor_user_id, note, metadata, occurred_at
    ) values (
      gen_random_uuid(), p_workspace_id, original_record.product_id, original_record.location_id,
      'reversal', -original_record.quantity_delta, original_record.unit_cost,
      original_record.currency, 'supplier_document_reversal', p_document_id::text,
      p_document_id, original_record.supplier_document_line_id, original_record.id,
      left(trim(p_idempotency_key), 70) || ':rev:' || original_record.id::text,
      p_command_id, p_actor_user_id, trim(p_reason),
      jsonb_build_object('original_movement_id', original_record.id, 'reason', trim(p_reason)),
      now()
    ) returning * into reversal_record;

    reversals_result := reversals_result || jsonb_build_array(to_jsonb(reversal_record));
    reversal_count := reversal_count + 1;
  end loop;

  if reversal_count = 0 then raise exception 'Supplier document Inventory posting contains no movements'; end if;

  update public.supplier_documents
  set inventory_posting_status = 'reversed',
      inventory_reversed_at = now(),
      inventory_reversed_by = p_actor_user_id,
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  command_result := jsonb_build_object(
    'action', 'reverse_supplier_document',
    'document', to_jsonb(document_record),
    'reversals', reversals_result,
    'reversalCount', reversal_count
  );
  insert into public.inventory_command_receipts (
    workspace_id, idempotency_key, action, entity_type, entity_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'reverse_supplier_document',
    'supplier_document', p_document_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier document Inventory posting reversed',
    coalesce(document_record.document_number, document_record.file_name) || ' · ' || reversal_count::text || ' movement(s)',
    'gold', 'supplier_document', p_document_id::text, p_command_id,
    jsonb_build_object(
      'reversal_count', reversal_count,
      'reason', trim(p_reason),
      'idempotency_key', p_idempotency_key
    )
  );
  return command_result;
end;
$$;

revoke all on function private.inventory_actor_can_write(uuid, uuid, text) from public;
revoke all on function private.inventory_actor_can_view_feature(uuid, uuid, text) from public;
revoke all on function private.prevent_inventory_movement_change() from public;
revoke all on function private.prepare_supplier_document_inventory_status() from public;
revoke all on function public.apply_inventory_location_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.transfer_inventory_stock(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.post_supplier_document_to_inventory(uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reverse_supplier_document_inventory(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

grant execute on function private.inventory_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function private.inventory_actor_can_view_feature(uuid, uuid, text) to service_role;
grant execute on function public.apply_inventory_location_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, boolean) to service_role;
grant execute on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.transfer_inventory_stock(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, text, jsonb) to service_role;
grant execute on function public.post_supplier_document_to_inventory(uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.reverse_supplier_document_inventory(uuid, uuid, text, uuid, uuid, text) to service_role;

revoke all on table public.inventory_locations, public.inventory_movements, public.inventory_command_receipts from anon, authenticated;
grant select on table public.inventory_locations, public.inventory_movements to authenticated;
grant select on table public.inventory_stock_balances, public.inventory_product_totals to authenticated;
grant all on table public.inventory_locations, public.inventory_movements, public.inventory_command_receipts to service_role;
grant select on table public.inventory_stock_balances, public.inventory_product_totals to service_role;

alter table public.inventory_locations enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_command_receipts enable row level security;

create policy "Inventory locations permission read"
on public.inventory_locations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

create policy "Inventory movements permission read"
on public.inventory_movements for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

comment on table public.inventory_locations is
  'Workspace-owned physical or operational stock locations. Locations may be archived but movement history is retained.';
comment on table public.inventory_movements is
  'Append-only Product stock ledger. Current quantity is derived from signed movements; posted rows are never edited or deleted.';
comment on view public.inventory_stock_balances is
  'Rebuildable Product stock quantity by workspace and location, derived entirely from immutable movements.';
comment on view public.inventory_product_totals is
  'Workspace Product totals and catalogue-price valuation derived from immutable Inventory movements.';
comment on function public.post_supplier_document_to_inventory(uuid, uuid, uuid, text, uuid, uuid) is
  'Atomically posts every reviewed Product line from one approved supplier invoice or credit note into the Inventory ledger.';

commit;
