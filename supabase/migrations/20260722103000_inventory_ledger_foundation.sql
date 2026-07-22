begin;

-- Inventory is a reusable BDB OS department. The module is exposed through the
-- feature catalogue, while plan and workspace entitlements remain commercial
-- configuration rather than hard-coded schema assumptions.
insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'inventory',
  'Inventory',
  'Products, consumables, stock locations and traceable stock movements.',
  'operations',
  '/inventory',
  85,
  true
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null check (code::text ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

create unique index inventory_locations_one_default_idx
  on public.inventory_locations(workspace_id)
  where is_default;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku extensions.citext not null check (char_length(trim(sku::text)) between 1 and 64),
  name text not null check (char_length(trim(name)) between 2 and 160),
  purpose text not null check (purpose in ('resale', 'consumable')),
  unit_label text not null default 'unit' check (char_length(trim(unit_label)) between 1 and 24),
  track_stock boolean not null default true,
  reorder_point numeric(14,3) not null default 0 check (reorder_point >= 0),
  target_quantity numeric(14,3) not null default 0 check (target_quantity >= reorder_point),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sku)
);

create index inventory_items_workspace_name_idx
  on public.inventory_items(workspace_id, active, name);

create table public.inventory_movements (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'opening_balance',
      'purchase_receipt',
      'sale',
      'appointment_consumption',
      'customer_return',
      'supplier_return',
      'transfer_out',
      'transfer_in',
      'manual_adjustment',
      'write_off',
      'reversal'
    )
  ),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  source_type text check (
    source_type is null
    or source_type ~ '^[a-z][a-z0-9_]{1,47}$'
  ),
  source_id text check (source_id is null or char_length(source_id) <= 160),
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
  foreign key (workspace_id, item_id)
    references public.inventory_items(workspace_id, id) on delete restrict,
  foreign key (workspace_id, location_id)
    references public.inventory_locations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id)
    references public.inventory_movements(workspace_id, id) on delete restrict,
  constraint inventory_movements_reversal_shape check (
    (movement_type = 'reversal' and reversal_of_id is not null)
    or (movement_type <> 'reversal' and reversal_of_id is null)
  ),
  constraint inventory_movements_transfer_shape check (
    (movement_type in ('transfer_out', 'transfer_in') and transfer_group_id is not null)
    or (movement_type not in ('transfer_out', 'transfer_in') and transfer_group_id is null)
  ),
  constraint inventory_movements_direction check (
    movement_type not in ('purchase_receipt', 'customer_return', 'transfer_in')
    or quantity_delta > 0
  ),
  constraint inventory_movements_outbound_direction check (
    movement_type not in ('sale', 'appointment_consumption', 'supplier_return', 'transfer_out', 'write_off')
    or quantity_delta < 0
  )
);

create index inventory_movements_workspace_item_time_idx
  on public.inventory_movements(workspace_id, item_id, occurred_at desc, id desc);
create index inventory_movements_workspace_location_time_idx
  on public.inventory_movements(workspace_id, location_id, occurred_at desc, id desc);
create index inventory_movements_workspace_source_idx
  on public.inventory_movements(workspace_id, source_type, source_id)
  where source_type is not null and source_id is not null;
create unique index inventory_movements_single_reversal_idx
  on public.inventory_movements(workspace_id, reversal_of_id)
  where reversal_of_id is not null;

create view public.inventory_stock_balances
with (security_invoker = true)
as
select
  item.workspace_id,
  item.id as item_id,
  location.id as location_id,
  coalesce(sum(movement.quantity_delta), 0::numeric)::numeric(14,3) as quantity
from public.inventory_items item
join public.inventory_locations location
  on location.workspace_id = item.workspace_id
left join public.inventory_movements movement
  on movement.workspace_id = item.workspace_id
 and movement.item_id = item.id
 and movement.location_id = location.id
where item.track_stock
group by item.workspace_id, item.id, location.id;

create or replace function private.inventory_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    join public.profiles profile on profile.id = membership.user_id
    where membership.workspace_id = target_workspace_id
      and membership.user_id = target_actor_user_id
      and membership.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
      and (
        membership.access_profile in ('owner', 'manager')
        or membership.role in ('owner', 'admin', 'manager', 'staff')
      )
  );
$$;

create or replace function private.prevent_inventory_movement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Posted inventory movements are immutable; create a reversal instead';
end;
$$;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function private.prevent_inventory_movement_change();

drop trigger if exists inventory_locations_touch_updated_at on public.inventory_locations;
create trigger inventory_locations_touch_updated_at
before update on public.inventory_locations
for each row execute function private.touch_updated_at();

drop trigger if exists inventory_items_touch_updated_at on public.inventory_items;
create trigger inventory_items_touch_updated_at
before update on public.inventory_items
for each row execute function private.touch_updated_at();

create or replace function public.create_inventory_location(
  p_workspace_id uuid,
  p_location_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns public.inventory_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_record public.inventory_locations;
  inserted boolean := false;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id) then
    raise exception 'Inventory write access denied';
  end if;

  if p_is_default then
    update public.inventory_locations
    set is_default = false
    where workspace_id = p_workspace_id and is_default;
  end if;

  insert into public.inventory_locations (
    id, workspace_id, code, name, is_default, created_by
  ) values (
    p_location_id, p_workspace_id, trim(p_code), trim(p_name), p_is_default, p_actor_user_id
  )
  on conflict (id) do nothing
  returning * into location_record;

  inserted := location_record.id is not null;
  if not inserted then
    select * into location_record
    from public.inventory_locations
    where id = p_location_id and workspace_id = p_workspace_id;
    if location_record.id is null then
      raise exception 'Inventory location identity conflict';
    end if;
  else
    insert into public.activity_items (
      workspace_id, actor_user_id, action, detail, tone,
      entity_type, entity_id, command_id, metadata
    ) values (
      p_workspace_id,
      p_actor_user_id,
      'Inventory location created',
      location_record.name || ' · ' || location_record.code::text,
      'blue',
      'inventory_location',
      location_record.id::text,
      p_command_id,
      jsonb_build_object('is_default', location_record.is_default)
    );
  end if;

  return location_record;
end;
$$;

create or replace function public.create_inventory_item(
  p_workspace_id uuid,
  p_item_id uuid,
  p_sku text,
  p_name text,
  p_purpose text,
  p_unit_label text,
  p_reorder_point numeric,
  p_target_quantity numeric,
  p_unit_cost numeric,
  p_unit_price numeric,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns public.inventory_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record public.inventory_items;
  inserted boolean := false;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id) then
    raise exception 'Inventory write access denied';
  end if;

  insert into public.inventory_items (
    id, workspace_id, sku, name, purpose, unit_label,
    reorder_point, target_quantity, unit_cost, unit_price, created_by
  ) values (
    p_item_id,
    p_workspace_id,
    trim(p_sku),
    trim(p_name),
    p_purpose,
    coalesce(nullif(trim(p_unit_label), ''), 'unit'),
    p_reorder_point,
    p_target_quantity,
    p_unit_cost,
    p_unit_price,
    p_actor_user_id
  )
  on conflict (id) do nothing
  returning * into item_record;

  inserted := item_record.id is not null;
  if not inserted then
    select * into item_record
    from public.inventory_items
    where id = p_item_id and workspace_id = p_workspace_id;
    if item_record.id is null then
      raise exception 'Inventory item identity conflict';
    end if;
  else
    insert into public.activity_items (
      workspace_id, actor_user_id, action, detail, tone,
      entity_type, entity_id, command_id, metadata
    ) values (
      p_workspace_id,
      p_actor_user_id,
      'Inventory item created',
      item_record.name || ' · ' || item_record.sku::text,
      'blue',
      'inventory_item',
      item_record.id::text,
      p_command_id,
      jsonb_build_object('purpose', item_record.purpose)
    );
  end if;

  return item_record;
end;
$$;

create or replace function public.post_inventory_movement(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_source_type text default null,
  p_source_id text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_reversal_of_id uuid default null
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_record public.inventory_movements;
  original_record public.inventory_movements;
  item_name text;
  effective_item_id uuid := p_item_id;
  effective_location_id uuid := p_location_id;
  effective_type text := p_movement_type;
  effective_delta numeric := p_quantity_delta;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id) then
    raise exception 'Inventory write access denied';
  end if;

  select * into movement_record
  from public.inventory_movements
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if movement_record.id is not null then
    return movement_record;
  end if;

  if p_reversal_of_id is not null then
    select * into original_record
    from public.inventory_movements
    where workspace_id = p_workspace_id and id = p_reversal_of_id;
    if original_record.id is null then
      raise exception 'Original inventory movement not found';
    end if;
    if exists (
      select 1 from public.inventory_movements
      where workspace_id = p_workspace_id and reversal_of_id = p_reversal_of_id
    ) then
      raise exception 'Inventory movement has already been reversed';
    end if;
    effective_item_id := original_record.item_id;
    effective_location_id := original_record.location_id;
    effective_type := 'reversal';
    effective_delta := -original_record.quantity_delta;
  end if;

  if effective_delta is null or effective_delta = 0 then
    raise exception 'Inventory movement quantity must be non-zero';
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.workspace_id = p_workspace_id
      and item.id = effective_item_id
      and (item.active or p_reversal_of_id is not null)
  ) then
    raise exception 'Inventory item is unavailable';
  end if;

  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id
      and location.id = effective_location_id
      and (location.active or p_reversal_of_id is not null)
  ) then
    raise exception 'Inventory location is unavailable';
  end if;

  insert into public.inventory_movements (
    id, workspace_id, item_id, location_id, movement_type,
    quantity_delta, source_type, source_id, reversal_of_id,
    idempotency_key, command_id, actor_user_id, note, metadata, occurred_at
  ) values (
    p_movement_id,
    p_workspace_id,
    effective_item_id,
    effective_location_id,
    effective_type,
    effective_delta,
    p_source_type,
    p_source_id,
    p_reversal_of_id,
    p_idempotency_key,
    p_command_id,
    p_actor_user_id,
    nullif(trim(p_note), ''),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  returning * into movement_record;

  select name into item_name
  from public.inventory_items
  where workspace_id = p_workspace_id and id = effective_item_id;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    case when effective_type = 'reversal'
      then 'Inventory movement reversed'
      else 'Inventory movement posted'
    end,
    item_name || ' · ' || replace(effective_type, '_', ' ') || ' · ' || effective_delta::text,
    case when effective_delta < 0 then 'gold' else 'green' end,
    'inventory_movement',
    movement_record.id::text,
    p_command_id,
    jsonb_build_object(
      'movement_type', effective_type,
      'quantity_delta', effective_delta,
      'location_id', effective_location_id,
      'idempotency_key', p_idempotency_key,
      'source_type', p_source_type,
      'source_id', p_source_id,
      'reversal_of_id', p_reversal_of_id
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return movement_record;
end;
$$;

create or replace function public.transfer_inventory_stock(
  p_workspace_id uuid,
  p_out_movement_id uuid,
  p_in_movement_id uuid,
  p_transfer_group_id uuid,
  p_item_id uuid,
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
  item_name text;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id) then
    raise exception 'Inventory write access denied';
  end if;
  if p_from_location_id = p_to_location_id then
    raise exception 'Transfer locations must be different';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Transfer quantity must be positive';
  end if;
  if char_length(p_idempotency_key) > 120 then
    raise exception 'Transfer idempotency key is too long';
  end if;

  select * into out_record
  from public.inventory_movements
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key || ':out';
  select * into in_record
  from public.inventory_movements
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key || ':in';
  if out_record.id is not null and in_record.id is not null then
    return jsonb_build_object('outMovement', to_jsonb(out_record), 'inMovement', to_jsonb(in_record));
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.workspace_id = p_workspace_id and item.id = p_item_id and item.active
  ) then
    raise exception 'Inventory item is unavailable';
  end if;
  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id
      and location.id in (p_from_location_id, p_to_location_id)
      and location.active
    group by location.workspace_id
    having count(*) = 2
  ) then
    raise exception 'Transfer location is unavailable';
  end if;

  insert into public.inventory_movements (
    id, workspace_id, item_id, location_id, movement_type,
    quantity_delta, transfer_group_id, idempotency_key, command_id,
    actor_user_id, note, metadata, occurred_at
  ) values (
    p_out_movement_id, p_workspace_id, p_item_id, p_from_location_id,
    'transfer_out', -p_quantity, p_transfer_group_id,
    p_idempotency_key || ':out', p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into out_record;

  insert into public.inventory_movements (
    id, workspace_id, item_id, location_id, movement_type,
    quantity_delta, transfer_group_id, idempotency_key, command_id,
    actor_user_id, note, metadata, occurred_at
  ) values (
    p_in_movement_id, p_workspace_id, p_item_id, p_to_location_id,
    'transfer_in', p_quantity, p_transfer_group_id,
    p_idempotency_key || ':in', p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into in_record;

  select name into item_name
  from public.inventory_items
  where workspace_id = p_workspace_id and id = p_item_id;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Inventory transferred',
    item_name || ' · ' || p_quantity::text || ' moved between locations',
    'blue',
    'inventory_transfer',
    p_transfer_group_id::text,
    p_command_id,
    jsonb_build_object(
      'item_id', p_item_id,
      'from_location_id', p_from_location_id,
      'to_location_id', p_to_location_id,
      'quantity', p_quantity,
      'out_movement_id', out_record.id,
      'in_movement_id', in_record.id,
      'idempotency_key', p_idempotency_key
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object('outMovement', to_jsonb(out_record), 'inMovement', to_jsonb(in_record));
end;
$$;

revoke all on function private.inventory_actor_can_write(uuid, uuid) from public;
revoke all on function private.prevent_inventory_movement_change() from public;
revoke all on function public.create_inventory_location(uuid, uuid, text, text, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_inventory_item(uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.transfer_inventory_stock(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, text, jsonb) from public, anon, authenticated;

grant execute on function private.inventory_actor_can_write(uuid, uuid) to service_role;
grant execute on function public.create_inventory_location(uuid, uuid, text, text, boolean, uuid, uuid) to service_role;
grant execute on function public.create_inventory_item(uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, uuid, uuid) to service_role;
grant execute on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.transfer_inventory_stock(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, text, jsonb) to service_role;

revoke all on table public.inventory_locations, public.inventory_items, public.inventory_movements from anon, authenticated;
grant select on table public.inventory_locations, public.inventory_items, public.inventory_movements to authenticated;
grant select on table public.inventory_stock_balances to authenticated;

alter table public.inventory_locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Inventory locations permission read"
on public.inventory_locations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

create policy "Inventory items permission read"
on public.inventory_items for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

create policy "Inventory movements permission read"
on public.inventory_movements for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

comment on table public.inventory_movements is
  'Append-only source of stock truth. Corrections are represented by reversing movements, never edits.';
comment on column public.inventory_movements.idempotency_key is
  'Client-stable retry key. Unique per workspace so offline retries cannot duplicate stock changes.';
comment on view public.inventory_stock_balances is
  'Rebuildable current stock by workspace, item and location, derived entirely from posted movements.';
comment on function public.transfer_inventory_stock(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, text, jsonb) is
  'Posts paired transfer-out and transfer-in movements atomically under one transfer group.';

commit;
