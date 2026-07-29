begin;

alter table public.inventory_movements
  add column appointment_id uuid,
  add constraint inventory_movements_workspace_appointment_fkey
    foreign key (workspace_id, appointment_id)
    references public.bookings(workspace_id, id) on delete restrict,
  add constraint inventory_movements_appointment_shape check (
    appointment_id is null
    or (
      source_type = 'appointment_consumption'
      and source_id = appointment_id::text
      and movement_type in ('internal_consumption', 'reversal')
    )
  );

create index inventory_movements_workspace_appointment_time_idx
  on public.inventory_movements(workspace_id, appointment_id, occurred_at desc, id desc)
  where appointment_id is not null;

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_action_check,
  add constraint inventory_command_receipts_action_check check (
    action in (
      'create_location',
      'update_location',
      'archive_location',
      'restore_location',
      'post_movement',
      'reverse_movement',
      'transfer_stock',
      'post_supplier_document',
      'reverse_supplier_document',
      'post_appointment_consumption',
      'reverse_appointment_consumption'
    )
  );

create or replace function private.enforce_appointment_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  appointment_record public.bookings;
  product_record public.products;
  original_record public.inventory_movements;
begin
  if new.movement_type = 'appointment_consumption' then
    raise exception 'Appointment Product use must be recorded as internal consumption';
  end if;

  if new.reversal_of_id is not null then
    select * into original_record
    from public.inventory_movements movement
    where movement.workspace_id = new.workspace_id
      and movement.id = new.reversal_of_id;

    if original_record.appointment_id is not null then
      new.appointment_id := original_record.appointment_id;
      new.source_type := 'appointment_consumption';
      new.source_id := original_record.appointment_id::text;
    end if;
  end if;

  if new.source_type = 'appointment_consumption' and new.appointment_id is null then
    raise exception 'Appointment consumption requires a canonical Appointment link';
  end if;

  if new.appointment_id is null then
    return new;
  end if;

  if new.source_type is distinct from 'appointment_consumption'
     or new.source_id is distinct from new.appointment_id::text then
    raise exception 'Appointment consumption source link is invalid';
  end if;

  if new.movement_type = 'internal_consumption' then
    if new.reversal_of_id is not null or new.quantity_delta >= 0 then
      raise exception 'Appointment consumption must be an outbound internal-consumption movement';
    end if;

    select * into appointment_record
    from public.bookings appointment
    where appointment.workspace_id = new.workspace_id
      and appointment.id = new.appointment_id
      and appointment.status::text = 'completed'
      and appointment.service_id is not null;

    if appointment_record.id is null then
      raise exception 'Only completed Service Appointments can record Product consumption';
    end if;

    select * into product_record
    from public.products product
    where product.workspace_id = new.workspace_id
      and product.id = new.product_id
      and product.status = 'active';

    if product_record.id is null then
      raise exception 'Appointment consumption Product is unavailable';
    end if;
    if product_record.purpose <> 'supply' then
      raise exception 'Resale Products must leave Inventory through a completed Sale';
    end if;
  elsif new.movement_type = 'reversal' then
    if new.reversal_of_id is null or new.quantity_delta <= 0 then
      raise exception 'Appointment consumption reversal shape is invalid';
    end if;
    if original_record.id is null
       or original_record.appointment_id is distinct from new.appointment_id
       or original_record.movement_type <> 'internal_consumption'
       or original_record.source_type <> 'appointment_consumption' then
      raise exception 'Appointment consumption reversal source is invalid';
    end if;
  else
    raise exception 'Appointment-linked Inventory movements must be internal consumption or reversal';
  end if;

  return new;
end;
$$;

create trigger inventory_movements_enforce_appointment_consumption
before insert on public.inventory_movements
for each row execute function private.enforce_appointment_inventory_movement();

create or replace function public.post_appointment_product_consumption(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_appointment_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  appointment_record public.bookings;
  product_record public.products;
  location_record public.inventory_locations;
  movement_record public.inventory_movements;
  workspace_currency text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment consumption idempotency key is invalid';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000 then
    raise exception 'Appointment consumption quantity is invalid';
  end if;
  if p_note is not null and char_length(trim(p_note)) > 500 then
    raise exception 'Appointment consumption note is too long';
  end if;

  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'inventory',
    'create'
  ) then
    raise exception 'Appointment consumption access denied';
  end if;

  select * into appointment_record
  from public.bookings appointment
  where appointment.workspace_id = p_workspace_id
    and appointment.id = p_appointment_id
  for update;
  if appointment_record.id is null then raise exception 'Appointment not found'; end if;
  if appointment_record.status::text <> 'completed' or appointment_record.service_id is null then
    raise exception 'Only completed Service Appointments can record Product consumption';
  end if;

  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id
    and product.id = p_product_id
    and product.status = 'active';
  if product_record.id is null then raise exception 'Appointment consumption Product is unavailable'; end if;
  if product_record.purpose <> 'supply' then
    raise exception 'Resale Products must leave Inventory through a completed Sale';
  end if;

  select * into location_record
  from public.inventory_locations location
  where location.workspace_id = p_workspace_id
    and location.id = p_location_id
    and location.status = 'active';
  if location_record.id is null then raise exception 'Appointment consumption Inventory location is unavailable'; end if;

  select coalesce(settings.currency, 'GBP') into workspace_currency
  from public.workspace_settings settings
  where settings.workspace_id = p_workspace_id;
  workspace_currency := coalesce(workspace_currency, 'GBP');

  insert into public.inventory_movements (
    id,
    workspace_id,
    product_id,
    location_id,
    appointment_id,
    movement_type,
    quantity_delta,
    unit_cost,
    currency,
    source_type,
    source_id,
    idempotency_key,
    command_id,
    actor_user_id,
    note,
    metadata,
    occurred_at
  ) values (
    p_movement_id,
    p_workspace_id,
    p_product_id,
    p_location_id,
    p_appointment_id,
    'internal_consumption',
    -abs(p_quantity),
    product_record.unit_cost,
    upper(workspace_currency),
    'appointment_consumption',
    p_appointment_id::text,
    trim(p_idempotency_key),
    p_command_id,
    p_actor_user_id,
    nullif(trim(p_note), ''),
    jsonb_build_object(
      'appointment_id', appointment_record.id,
      'appointment_reference', appointment_record.reference,
      'customer_id', appointment_record.customer_id,
      'customer_name', appointment_record.customer_name_snapshot,
      'service_id', appointment_record.service_id,
      'service_code', appointment_record.service_code_snapshot,
      'service_name', appointment_record.title,
      'product_sku', product_record.sku::text,
      'product_name', product_record.name,
      'unit_label', product_record.unit_label,
      'location_code', location_record.code::text,
      'location_name', location_record.name
    ),
    coalesce(p_occurred_at, appointment_record.completed_at, now())
  ) returning * into movement_record;

  command_result := jsonb_build_object(
    'action', 'post_appointment_consumption',
    'movement', to_jsonb(movement_record),
    'appointment', jsonb_build_object(
      'id', appointment_record.id,
      'reference', appointment_record.reference
    )
  );

  insert into public.inventory_command_receipts (
    workspace_id,
    idempotency_key,
    action,
    entity_type,
    entity_id,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    'post_appointment_consumption',
    'inventory_movement',
    movement_record.id,
    command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Appointment Product consumption posted',
    appointment_record.reference || ' · ' || product_record.name || ' · ' || abs(p_quantity)::text || ' ' || product_record.unit_label,
    'gold',
    'appointment',
    appointment_record.id::text,
    p_command_id,
    jsonb_build_object(
      'appointment_id', appointment_record.id,
      'movement_id', movement_record.id,
      'product_id', product_record.id,
      'location_id', location_record.id,
      'quantity', abs(p_quantity),
      'unit_cost', product_record.unit_cost,
      'currency', upper(workspace_currency),
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_appointment_product_consumption(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_movement_id uuid,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  original_record public.inventory_movements;
  reversal_record public.inventory_movements;
  appointment_record public.bookings;
  product_record public.products;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment consumption reversal idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Appointment consumption reversal reason is required';
  end if;

  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'inventory',
    'edit'
  ) then
    raise exception 'Appointment consumption reversal access denied';
  end if;

  select * into original_record
  from public.inventory_movements movement
  where movement.workspace_id = p_workspace_id
    and movement.id = p_movement_id
  for update;
  if original_record.id is null then raise exception 'Appointment consumption movement not found'; end if;
  if original_record.appointment_id is null
     or original_record.movement_type <> 'internal_consumption'
     or original_record.source_type <> 'appointment_consumption' then
    raise exception 'Inventory movement is not Appointment Product consumption';
  end if;
  if exists (
    select 1
    from public.inventory_movements movement
    where movement.workspace_id = p_workspace_id
      and movement.reversal_of_id = original_record.id
  ) then
    raise exception 'Appointment Product consumption has already been reversed';
  end if;

  select * into appointment_record
  from public.bookings appointment
  where appointment.workspace_id = p_workspace_id
    and appointment.id = original_record.appointment_id;
  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id
    and product.id = original_record.product_id;

  insert into public.inventory_movements (
    id,
    workspace_id,
    product_id,
    location_id,
    appointment_id,
    movement_type,
    quantity_delta,
    unit_cost,
    currency,
    source_type,
    source_id,
    reversal_of_id,
    idempotency_key,
    command_id,
    actor_user_id,
    note,
    metadata,
    occurred_at
  ) values (
    p_reversal_id,
    p_workspace_id,
    original_record.product_id,
    original_record.location_id,
    original_record.appointment_id,
    'reversal',
    -original_record.quantity_delta,
    original_record.unit_cost,
    original_record.currency,
    'appointment_consumption',
    original_record.appointment_id::text,
    original_record.id,
    trim(p_idempotency_key),
    p_command_id,
    p_actor_user_id,
    trim(p_reason),
    coalesce(original_record.metadata, '{}'::jsonb) || jsonb_build_object(
      'reversal_reason', trim(p_reason),
      'original_movement_id', original_record.id
    ),
    coalesce(p_occurred_at, now())
  ) returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_appointment_consumption',
    'movement', to_jsonb(reversal_record),
    'originalMovementId', original_record.id
  );

  insert into public.inventory_command_receipts (
    workspace_id,
    idempotency_key,
    action,
    entity_type,
    entity_id,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    'reverse_appointment_consumption',
    'inventory_movement',
    reversal_record.id,
    command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Appointment Product consumption reversed',
    coalesce(appointment_record.reference, original_record.appointment_id::text) || ' · ' || coalesce(product_record.name, 'Product') || ' · ' || trim(p_reason),
    'blue',
    'appointment',
    original_record.appointment_id::text,
    p_command_id,
    jsonb_build_object(
      'appointment_id', original_record.appointment_id,
      'original_movement_id', original_record.id,
      'reversal_movement_id', reversal_record.id,
      'product_id', original_record.product_id,
      'location_id', original_record.location_id,
      'quantity', abs(original_record.quantity_delta),
      'reason', trim(p_reason),
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.enforce_appointment_inventory_movement() from public;
revoke all on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) to service_role;
grant execute on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) to service_role;

comment on column public.inventory_movements.appointment_id is
  'Canonical Appointment link for explicit internal Product consumption and its reversal.';
comment on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) is
  'Posts explicit supply-Product consumption for one completed Appointment without creating a Sale or implying resale.';
comment on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) is
  'Reverses one immutable Appointment Product consumption movement while preserving the Appointment link.';

commit;