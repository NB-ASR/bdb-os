begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values ('inventory', 'Inventory', 'Stock locations, balances and immutable movement history.', 'operations', '/inventory', 85, true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

create table public.inventory_locations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null check (code::text ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$'),
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

create unique index inventory_locations_one_default_idx
  on public.inventory_locations(workspace_id)
  where is_default and status = 'active';

create table public.inventory_movements (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  location_id uuid not null,
  movement_type text not null check (movement_type in (
    'opening_balance', 'purchase_receipt', 'sale', 'appointment_consumption',
    'customer_return', 'supplier_return', 'transfer_out', 'transfer_in',
    'manual_adjustment', 'write_off', 'reversal'
  )),
  quantity_delta numeric(14,4) not null check (quantity_delta <> 0),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  source_type text check (source_type is null or source_type ~ '^[a-z][a-z0-9_]{1,47}$'),
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
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete restrict,
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
  constraint inventory_movements_inbound_direction check (
    movement_type not in ('purchase_receipt', 'customer_return', 'transfer_in') or quantity_delta > 0
  ),
  constraint inventory_movements_outbound_direction check (
    movement_type not in ('sale', 'appointment_consumption', 'supplier_return', 'transfer_out', 'write_off') or quantity_delta < 0
  )
);

create index inventory_movements_workspace_product_time_idx
  on public.inventory_movements(workspace_id, product_id, occurred_at desc, id desc);
create index inventory_movements_workspace_location_time_idx
  on public.inventory_movements(workspace_id, location_id, occurred_at desc, id desc);
create index inventory_movements_workspace_source_idx
  on public.inventory_movements(workspace_id, source_type, source_id)
  where source_type is not null and source_id is not null;
create unique index inventory_movements_single_reversal_idx
  on public.inventory_movements(workspace_id, reversal_of_id)
  where reversal_of_id is not null;
create unique index inventory_supplier_document_line_once_idx
  on public.inventory_movements(workspace_id, source_type, source_id)
  where source_type = 'supplier_document_line'
    and movement_type in ('purchase_receipt', 'supplier_return');

create view public.inventory_stock_balances
with (security_invoker = true)
as
select
  product.workspace_id,
  product.id as product_id,
  location.id as location_id,
  coalesce(sum(movement.quantity_delta), 0::numeric)::numeric(14,4) as quantity,
  coalesce(sum(movement.quantity_delta * coalesce(movement.unit_cost, product.unit_cost)), 0::numeric)::numeric(16,4) as movement_value
from public.products product
join public.inventory_locations location on location.workspace_id = product.workspace_id
left join public.inventory_movements movement
  on movement.workspace_id = product.workspace_id
 and movement.product_id = product.id
 and movement.location_id = location.id
where product.status = 'active'
group by product.workspace_id, product.id, location.id;

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
      and permission.feature_key = 'inventory'
    limit 1
  )
  select not exists (
      select 1 from public.platform_support_sessions support_session
      where support_session.admin_user_id = target_actor_user_id
        and support_session.workspace_id = target_workspace_id
        and support_session.ended_at is null
        and support_session.expires_at > now()
    )
    and private.has_feature(target_workspace_id, 'inventory')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        else false
      end
      when (select access_profile from membership) in ('manager', 'employee')
        then target_action in ('create', 'edit')
      else false
    end;
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

create trigger inventory_locations_touch_updated_at
before update on public.inventory_locations
for each row execute function private.touch_updated_at();

create or replace function public.apply_inventory_location_command(
  p_workspace_id uuid,
  p_location_id uuid,
  p_action text,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_expected_version integer,
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
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, case when p_action = 'create' then 'create' else 'edit' end) then
    raise exception 'Inventory write access denied';
  end if;
  if p_action = 'create' then
    if p_is_default then
      update public.inventory_locations set is_default = false, version = version + 1
      where workspace_id = p_workspace_id and is_default and status = 'active';
    end if;
    insert into public.inventory_locations (
      id, workspace_id, code, name, is_default, created_by, updated_by
    ) values (
      p_location_id, p_workspace_id, trim(p_code), trim(p_name), coalesce(p_is_default, false), p_actor_user_id, p_actor_user_id
    ) returning * into location_record;
  else
    select * into location_record from public.inventory_locations
    where workspace_id = p_workspace_id and id = p_location_id for update;
    if location_record.id is null then raise exception 'Inventory location not found'; end if;
    if p_expected_version is null or p_expected_version <> location_record.version then
      raise exception 'Inventory location changed on another device; refresh before saving';
    end if;
    if p_action = 'archive' and location_record.is_default then
      raise exception 'The default Inventory location cannot be archived';
    end if;
    if p_action = 'update' and p_is_default then
      update public.inventory_locations set is_default = false, version = version + 1
      where workspace_id = p_workspace_id and id <> p_location_id and is_default and status = 'active';
    end if;
    update public.inventory_locations
    set code = case when p_action = 'update' then trim(p_code) else code end,
        name = case when p_action = 'update' then trim(p_name) else name end,
        is_default = case when p_action = 'update' then coalesce(p_is_default, false) else is_default end,
        status = case p_action when 'archive' then 'archived' when 'restore' then 'active' else status end,
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id and id = p_location_id
    returning * into location_record;
  end if;
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Inventory location ' || p_action,
    location_record.name || ' · ' || location_record.code::text, 'blue',
    'inventory_location', location_record.id::text, p_command_id,
    jsonb_build_object('status', location_record.status, 'is_default', location_record.is_default)
  );
  return location_record;
end;
$$;

create or replace function public.post_inventory_movement(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_unit_cost numeric,
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
  product_name text;
  effective_product_id uuid := p_product_id;
  effective_location_id uuid := p_location_id;
  effective_type text := p_movement_type;
  effective_delta numeric := p_quantity_delta;
  effective_unit_cost numeric := p_unit_cost;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Inventory write access denied';
  end if;
  select * into movement_record from public.inventory_movements
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if movement_record.id is not null then return movement_record; end if;
  if p_reversal_of_id is not null then
    select * into original_record from public.inventory_movements
    where workspace_id = p_workspace_id and id = p_reversal_of_id;
    if original_record.id is null then raise exception 'Original inventory movement not found'; end if;
    if exists (select 1 from public.inventory_movements where workspace_id = p_workspace_id and reversal_of_id = p_reversal_of_id) then
      raise exception 'Inventory movement has already been reversed';
    end if;
    effective_product_id := original_record.product_id;
    effective_location_id := original_record.location_id;
    effective_type := 'reversal';
    effective_delta := -original_record.quantity_delta;
    effective_unit_cost := original_record.unit_cost;
  end if;
  if effective_delta is null or effective_delta = 0 then raise exception 'Inventory movement quantity must be non-zero'; end if;
  if not exists (
    select 1 from public.products product
    where product.workspace_id = p_workspace_id and product.id = effective_product_id
      and (product.status = 'active' or p_reversal_of_id is not null)
  ) then raise exception 'Inventory Product is unavailable'; end if;
  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id and location.id = effective_location_id
      and (location.status = 'active' or p_reversal_of_id is not null)
  ) then raise exception 'Inventory location is unavailable'; end if;
  insert into public.inventory_movements (
    id, workspace_id, product_id, location_id, movement_type, quantity_delta, unit_cost,
    source_type, source_id, reversal_of_id, idempotency_key, command_id, actor_user_id,
    note, metadata, occurred_at
  ) values (
    p_movement_id, p_workspace_id, effective_product_id, effective_location_id,
    effective_type, effective_delta, effective_unit_cost, p_source_type, p_source_id,
    p_reversal_of_id, p_idempotency_key, p_command_id, p_actor_user_id,
    nullif(trim(p_note), ''), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning * into movement_record;
  select name into product_name from public.products
  where workspace_id = p_workspace_id and id = effective_product_id;
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id,
    case when effective_type = 'reversal' then 'Inventory movement reversed' else 'Inventory movement posted' end,
    product_name || ' · ' || replace(effective_type, '_', ' ') || ' · ' || effective_delta::text,
    case when effective_delta < 0 then 'gold' else 'green' end,
    'inventory_movement', movement_record.id::text, p_command_id,
    jsonb_build_object('movement_type', effective_type, 'quantity_delta', effective_delta,
      'location_id', effective_location_id, 'source_type', p_source_type, 'source_id', p_source_id)
      || coalesce(p_metadata, '{}'::jsonb)
  );
  return movement_record;
end;
$$;

alter table public.supplier_documents
  drop constraint if exists supplier_documents_inventory_posting_status_check;
alter table public.supplier_documents
  add constraint supplier_documents_inventory_posting_status_check
  check (inventory_posting_status in ('not_available', 'ready', 'posted'));
alter table public.supplier_documents
  add column inventory_posted_at timestamptz,
  add column inventory_posted_by uuid references auth.users(id) on delete set null,
  add column inventory_location_id uuid;
alter table public.supplier_documents
  add constraint supplier_documents_inventory_location_fk
  foreign key (workspace_id, inventory_location_id)
  references public.inventory_locations(workspace_id, id);

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
  posted_count integer := 0;
  sign_multiplier numeric := 1;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Inventory write access denied';
  end if;
  select * into document_record from public.supplier_documents
  where workspace_id = p_workspace_id and id = p_document_id for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status <> 'approved' then raise exception 'Supplier document must be approved before Inventory posting'; end if;
  if document_record.document_type not in ('invoice', 'credit_note') then raise exception 'Only invoices and credit notes can post to Inventory'; end if;
  if document_record.inventory_posting_status = 'posted' then
    return jsonb_build_object('documentId', document_record.id, 'status', 'posted', 'movementCount',
      (select count(*) from public.inventory_movements m where m.workspace_id = p_workspace_id and m.source_type = 'supplier_document_line' and m.metadata->>'documentId' = p_document_id::text));
  end if;
  if not exists (
    select 1 from public.inventory_locations location
    where location.workspace_id = p_workspace_id and location.id = p_location_id and location.status = 'active'
  ) then raise exception 'Inventory location is unavailable'; end if;
  if exists (
    select 1 from public.supplier_document_lines line
    where line.workspace_id = p_workspace_id and line.document_id = p_document_id
      and line.line_kind = 'product' and line.matched_product_id is null
  ) then raise exception 'Every Product line must be matched before Inventory posting'; end if;
  sign_multiplier := case when document_record.document_type = 'credit_note' then -1 else 1 end;
  for line_record in
    select * from public.supplier_document_lines line
    where line.workspace_id = p_workspace_id and line.document_id = p_document_id and line.line_kind = 'product'
    order by line.line_number
  loop
    select * into movement_record from public.post_inventory_movement(
      p_workspace_id,
      gen_random_uuid(),
      line_record.matched_product_id,
      p_location_id,
      case when sign_multiplier > 0 then 'purchase_receipt' else 'supplier_return' end,
      sign_multiplier * line_record.quantity,
      line_record.unit_cost,
      p_idempotency_key || ':line:' || line_record.id::text,
      p_command_id,
      p_actor_user_id,
      coalesce(document_record.document_date::timestamptz, now()),
      'supplier_document_line',
      line_record.id::text,
      coalesce(document_record.document_number, document_record.file_name),
      jsonb_build_object('documentId', p_document_id, 'lineNumber', line_record.line_number,
        'documentType', document_record.document_type, 'supplierId', document_record.supplier_id),
      null
    );
    posted_count := posted_count + 1;
  end loop;
  if posted_count = 0 then raise exception 'Supplier document contains no Product lines to post'; end if;
  update public.supplier_documents
  set inventory_posting_status = 'posted', inventory_posted_at = now(),
      inventory_posted_by = p_actor_user_id, inventory_location_id = p_location_id,
      updated_by = p_actor_user_id, version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id;
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier document posted to Inventory',
    coalesce(document_record.document_number, document_record.file_name), 'green',
    'supplier_document', p_document_id::text, p_command_id,
    jsonb_build_object('locationId', p_location_id, 'movementCount', posted_count,
      'documentType', document_record.document_type, 'idempotencyKey', p_idempotency_key)
  );
  return jsonb_build_object('documentId', p_document_id, 'status', 'posted', 'movementCount', posted_count, 'locationId', p_location_id);
end;
$$;

revoke all on function private.inventory_actor_can_write(uuid, uuid, text) from public;
revoke all on function private.prevent_inventory_movement_change() from public;
revoke all on function public.apply_inventory_location_command(uuid, uuid, text, text, text, boolean, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, numeric, text, uuid, uuid, timestamptz, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.post_supplier_document_to_inventory(uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function private.inventory_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_inventory_location_command(uuid, uuid, text, text, text, boolean, integer, uuid, uuid) to service_role;
grant execute on function public.post_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, numeric, text, uuid, uuid, timestamptz, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.post_supplier_document_to_inventory(uuid, uuid, uuid, text, uuid, uuid) to service_role;

revoke all on table public.inventory_locations, public.inventory_movements from anon, authenticated;
grant select on table public.inventory_locations, public.inventory_movements to authenticated;
grant select on table public.inventory_stock_balances to authenticated;

alter table public.inventory_locations enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Inventory locations permission read"
on public.inventory_locations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

create policy "Inventory movements permission read"
on public.inventory_movements for select to authenticated
using (private.has_workspace_permission(workspace_id, 'inventory', 'view'));

comment on table public.inventory_movements is
  'Append-only Product stock ledger. Corrections are represented by reversing movements, never edits.';
comment on view public.inventory_stock_balances is
  'Rebuildable Product stock by workspace and location, derived entirely from posted movements.';

commit;
