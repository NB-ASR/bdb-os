begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'sales',
  'Sales',
  'Completed customer and walk-in transactions across Products and Services.',
  'revenue',
  '/sales',
  70,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

create table public.sales (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(reference) between 8 and 64),
  customer_id uuid,
  channel text not null default 'in_store' check (channel in ('in_store', 'manual', 'appointment')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount numeric(16,4) not null check (gross_amount >= 0),
  discount_amount numeric(16,4) not null default 0 check (discount_amount >= 0 and discount_amount <= gross_amount),
  net_amount numeric(16,4) not null check (net_amount >= 0),
  vat_amount numeric(16,4) not null check (vat_amount >= 0),
  total_amount numeric(16,4) not null check (total_amount >= 0),
  settlement_status text not null default 'not_recorded' check (settlement_status = 'not_recorded'),
  inventory_location_id uuid,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'completed' check (status in ('completed', 'reversed')),
  version integer not null default 1 check (version > 0),
  occurred_at timestamptz not null,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, inventory_location_id)
    references public.inventory_locations(workspace_id, id) on delete restrict,
  constraint sales_reversal_shape check (
    (status = 'completed' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  )
);

create index sales_workspace_time_idx
  on public.sales(workspace_id, occurred_at desc, id desc);
create index sales_workspace_customer_time_idx
  on public.sales(workspace_id, customer_id, occurred_at desc)
  where customer_id is not null;
create index sales_completed_by_idx
  on public.sales(completed_by, occurred_at desc);
create index sales_reversed_by_idx
  on public.sales(reversed_by, reversed_at desc)
  where reversed_by is not null;
create index sales_inventory_location_idx
  on public.sales(workspace_id, inventory_location_id)
  where inventory_location_id is not null;

create table public.sale_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_type text not null check (line_type in ('product', 'service')),
  product_id uuid,
  service_id uuid,
  code_snapshot text not null check (char_length(code_snapshot) between 1 and 64),
  description_snapshot text not null check (char_length(description_snapshot) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  unit_cost_snapshot numeric(14,4) check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  gross_amount numeric(16,4) not null check (gross_amount >= 0),
  discount_amount numeric(16,4) not null default 0 check (discount_amount >= 0 and discount_amount <= gross_amount),
  net_amount numeric(16,4) not null check (net_amount >= 0),
  vat_rate numeric(5,2) not null check (vat_rate between 0 and 100),
  vat_amount numeric(16,4) not null check (vat_amount >= 0),
  total_amount numeric(16,4) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sale_id, line_number),
  foreign key (workspace_id, sale_id)
    references public.sales(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id)
    references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete restrict,
  constraint sale_lines_identity_shape check (
    (line_type = 'product' and product_id is not null and service_id is null and unit_cost_snapshot is not null)
    or (line_type = 'service' and service_id is not null and product_id is null and unit_cost_snapshot is null)
  )
);

create index sale_lines_sale_idx
  on public.sale_lines(workspace_id, sale_id, line_number);
create index sale_lines_product_idx
  on public.sale_lines(workspace_id, product_id, created_at desc)
  where product_id is not null;
create index sale_lines_service_idx
  on public.sale_lines(workspace_id, service_id, created_at desc)
  where service_id is not null;

create table public.sale_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  sale_id uuid not null,
  action text not null check (action in ('complete_sale', 'reverse_sale')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, sale_id)
    references public.sales(workspace_id, id) on delete cascade
);

create index sale_command_receipts_sale_idx
  on public.sale_command_receipts(workspace_id, sale_id, created_at desc);

create unique index inventory_movements_single_sale_line_idx
  on public.inventory_movements(workspace_id, source_id)
  where source_type = 'sale_line' and movement_type <> 'reversal';

create or replace function private.prevent_sale_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Completed Sale lines are immutable; reverse the Sale instead';
end;
$$;

create trigger sale_lines_immutable
before update or delete on public.sale_lines
for each row execute function private.prevent_sale_line_change();

create or replace function private.prevent_sale_header_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Completed Sales cannot be deleted; reverse the Sale instead';
  end if;

  if old.status = 'completed'
     and new.status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.reference = old.reference
     and new.customer_id is not distinct from old.customer_id
     and new.channel = old.channel
     and new.currency = old.currency
     and new.gross_amount = old.gross_amount
     and new.discount_amount = old.discount_amount
     and new.net_amount = old.net_amount
     and new.vat_amount = old.vat_amount
     and new.total_amount = old.total_amount
     and new.settlement_status = old.settlement_status
     and new.inventory_location_id is not distinct from old.inventory_location_id
     and new.notes is not distinct from old.notes
     and new.occurred_at = old.occurred_at
     and new.completed_at = old.completed_at
     and new.completed_by = old.completed_by
     and new.version = old.version + 1
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null then
    return new;
  end if;

  raise exception 'Completed Sale headers are immutable; reverse the Sale instead';
end;
$$;

create trigger sales_immutable_except_reversal
before update or delete on public.sales
for each row execute function private.prevent_sale_header_change();

create or replace function private.sales_actor_can_write(
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
      and permission.feature_key = 'sales'
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
    and private.has_feature(target_workspace_id, 'sales')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'complete' then (select can_create from explicit_permission)
        when 'reverse' then (select can_approve from explicit_permission)
        else false
      end
      when (select access_profile from membership) = 'manager'
        then target_action in ('complete', 'reverse')
      when (select access_profile from membership) = 'employee'
        then target_action = 'complete'
      else false
    end;
$$;

create or replace function public.complete_sale(
  p_workspace_id uuid,
  p_sale_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_lines jsonb,
  p_currency text,
  p_channel text default 'in_store',
  p_customer_id uuid default null,
  p_inventory_location_id uuid default null,
  p_sale_discount numeric default 0,
  p_occurred_at timestamptz default now(),
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  sale_record public.sales;
  line_value jsonb;
  product_record public.products;
  service_record public.services;
  line_id uuid;
  item_id uuid;
  line_type_value text;
  quantity_value numeric;
  unit_price_value numeric;
  explicit_line_discount numeric;
  line_gross numeric;
  line_after_discount numeric;
  allocated_sale_discount numeric;
  line_discount_total numeric;
  line_total numeric;
  line_vat numeric;
  line_net numeric;
  line_vat_rate numeric;
  line_code text;
  line_description text;
  line_unit_cost numeric;
  gross_total numeric := 0;
  explicit_discount_total numeric := 0;
  base_after_line_discounts numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  total_value numeric := 0;
  remaining_sale_discount numeric;
  remaining_base numeric;
  line_count integer;
  line_index integer := 0;
  product_line_count integer := 0;
  inventory_movement_count integer := 0;
  sale_reference text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Sale idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.sale_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.sales_actor_can_write(p_workspace_id, p_actor_user_id, 'complete') then
    raise exception 'Sale completion access denied';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Sale lines must be an array'; end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 100 then raise exception 'A Sale must contain between 1 and 100 lines'; end if;
  if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then raise exception 'Sale currency is invalid'; end if;
  if p_channel not in ('in_store', 'manual', 'appointment') then raise exception 'Sale channel is invalid'; end if;
  if p_sale_discount is null or p_sale_discount < 0 then raise exception 'Sale discount is invalid'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Sale notes are too long'; end if;
  if exists (select 1 from public.sales where id = p_sale_id) then raise exception 'Sale identity conflict'; end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers customer
    where customer.workspace_id = p_workspace_id and customer.id = p_customer_id
  ) then raise exception 'Sale Customer is unavailable'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    group by line->>'id'
    having count(*) > 1
  ) then raise exception 'Sale line identities must be unique'; end if;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    begin
      line_id := (line_value->>'id')::uuid;
      item_id := (line_value->>'itemId')::uuid;
      line_type_value := line_value->>'lineType';
      quantity_value := (line_value->>'quantity')::numeric;
      explicit_line_discount := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
    exception when others then
      raise exception 'A Sale line contains invalid identifiers or numbers';
    end;

    if line_type_value not in ('product', 'service') then raise exception 'Sale line type is invalid'; end if;
    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then raise exception 'Sale line quantity is invalid'; end if;
    if explicit_line_discount < 0 then raise exception 'Sale line discount is invalid'; end if;

    if line_type_value = 'product' then
      if not private.has_feature(p_workspace_id, 'products') or not private.has_feature(p_workspace_id, 'inventory') then
        raise exception 'Product Sales require Products and Inventory';
      end if;
      select * into product_record
      from public.products product
      where product.workspace_id = p_workspace_id and product.id = item_id and product.status = 'active';
      if product_record.id is null then raise exception 'A Sale Product is unavailable'; end if;
      if product_record.purpose <> 'resale' then raise exception 'Business-supply Products cannot be sold'; end if;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, product_record.selling_price);
      if unit_price_value is null then raise exception 'A Sale Product has no selling price'; end if;
      line_vat_rate := product_record.vat_rate;
      product_line_count := product_line_count + 1;
    else
      if not private.has_feature(p_workspace_id, 'services') then raise exception 'Service Sales require Services'; end if;
      select * into service_record
      from public.services service
      where service.workspace_id = p_workspace_id and service.id = item_id and service.status = 'active';
      if service_record.id is null then raise exception 'A Sale Service is unavailable'; end if;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, service_record.price);
      if unit_price_value is null then raise exception 'A Sale Service has no price'; end if;
      line_vat_rate := service_record.vat_rate;
    end if;

    if unit_price_value < 0 then raise exception 'Sale line price is invalid'; end if;
    line_gross := round(quantity_value * unit_price_value, 4);
    if explicit_line_discount > line_gross then raise exception 'Sale line discount exceeds the line value'; end if;
    line_after_discount := line_gross - explicit_line_discount;
    gross_total := gross_total + line_gross;
    explicit_discount_total := explicit_discount_total + explicit_line_discount;
    base_after_line_discounts := base_after_line_discounts + line_after_discount;
  end loop;

  if p_sale_discount > base_after_line_discounts then raise exception 'Sale discount exceeds the remaining Sale value'; end if;
  if product_line_count > 0 then
    if p_inventory_location_id is null then raise exception 'Product Sales require an Inventory location'; end if;
    if not exists (
      select 1 from public.inventory_locations location
      where location.workspace_id = p_workspace_id
        and location.id = p_inventory_location_id
        and location.status = 'active'
    ) then raise exception 'Sale Inventory location is unavailable'; end if;
  end if;

  remaining_sale_discount := p_sale_discount;
  remaining_base := base_after_line_discounts;
  line_index := 0;
  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_index := line_index + 1;
    line_type_value := line_value->>'lineType';
    item_id := (line_value->>'itemId')::uuid;
    quantity_value := (line_value->>'quantity')::numeric;
    explicit_line_discount := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
    if line_type_value = 'product' then
      select * into product_record from public.products where workspace_id = p_workspace_id and id = item_id;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, product_record.selling_price);
      line_vat_rate := product_record.vat_rate;
    else
      select * into service_record from public.services where workspace_id = p_workspace_id and id = item_id;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, service_record.price);
      line_vat_rate := service_record.vat_rate;
    end if;
    line_gross := round(quantity_value * unit_price_value, 4);
    line_after_discount := line_gross - explicit_line_discount;
    allocated_sale_discount := case
      when line_index = line_count then remaining_sale_discount
      when remaining_base = 0 then 0
      else least(remaining_sale_discount, round(p_sale_discount * line_after_discount / base_after_line_discounts, 4))
    end;
    remaining_sale_discount := remaining_sale_discount - allocated_sale_discount;
    remaining_base := remaining_base - line_after_discount;
    line_total := line_after_discount - allocated_sale_discount;
    line_vat := case when line_vat_rate = 0 then 0 else round(line_total * line_vat_rate / (100 + line_vat_rate), 4) end;
    line_net := line_total - line_vat;
    net_total := net_total + line_net;
    vat_total := vat_total + line_vat;
  end loop;

  gross_total := round(gross_total, 4);
  total_value := round(gross_total - explicit_discount_total - p_sale_discount, 4);
  net_total := round(net_total, 4);
  vat_total := round(vat_total, 4);
  sale_reference := 'SALE-' || to_char(coalesce(p_occurred_at, now()) at time zone 'UTC', 'YYYYMMDD') || '-' || upper(substr(replace(p_sale_id::text, '-', ''), 1, 8));

  insert into public.sales (
    id, workspace_id, reference, customer_id, channel, currency,
    gross_amount, discount_amount, net_amount, vat_amount, total_amount,
    inventory_location_id, notes, occurred_at, completed_by
  ) values (
    p_sale_id, p_workspace_id, sale_reference, p_customer_id, p_channel, upper(trim(p_currency)),
    gross_total, round(explicit_discount_total + p_sale_discount, 4), net_total, vat_total, total_value,
    case when product_line_count > 0 then p_inventory_location_id else null end,
    nullif(trim(p_notes), ''), coalesce(p_occurred_at, now()), p_actor_user_id
  ) returning * into sale_record;

  remaining_sale_discount := p_sale_discount;
  remaining_base := base_after_line_discounts;
  line_index := 0;
  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_index := line_index + 1;
    line_id := (line_value->>'id')::uuid;
    item_id := (line_value->>'itemId')::uuid;
    line_type_value := line_value->>'lineType';
    quantity_value := (line_value->>'quantity')::numeric;
    explicit_line_discount := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);

    if line_type_value = 'product' then
      select * into product_record from public.products where workspace_id = p_workspace_id and id = item_id;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, product_record.selling_price);
      line_vat_rate := product_record.vat_rate;
      line_code := product_record.sku::text;
      line_description := product_record.name;
      line_unit_cost := product_record.unit_cost;
    else
      select * into service_record from public.services where workspace_id = p_workspace_id and id = item_id;
      unit_price_value := coalesce(nullif(line_value->>'unitPrice', '')::numeric, service_record.price);
      line_vat_rate := service_record.vat_rate;
      line_code := service_record.code::text;
      line_description := service_record.name;
      line_unit_cost := null;
    end if;

    line_gross := round(quantity_value * unit_price_value, 4);
    line_after_discount := line_gross - explicit_line_discount;
    allocated_sale_discount := case
      when line_index = line_count then remaining_sale_discount
      when remaining_base = 0 then 0
      else least(remaining_sale_discount, round(p_sale_discount * line_after_discount / base_after_line_discounts, 4))
    end;
    remaining_sale_discount := remaining_sale_discount - allocated_sale_discount;
    remaining_base := remaining_base - line_after_discount;
    line_discount_total := explicit_line_discount + allocated_sale_discount;
    line_total := line_after_discount - allocated_sale_discount;
    line_vat := case when line_vat_rate = 0 then 0 else round(line_total * line_vat_rate / (100 + line_vat_rate), 4) end;
    line_net := line_total - line_vat;

    insert into public.sale_lines (
      id, workspace_id, sale_id, line_number, line_type, product_id, service_id,
      code_snapshot, description_snapshot, quantity, unit_price, unit_cost_snapshot,
      gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
    ) values (
      line_id, p_workspace_id, p_sale_id, line_index, line_type_value,
      case when line_type_value = 'product' then item_id else null end,
      case when line_type_value = 'service' then item_id else null end,
      line_code, line_description, quantity_value, unit_price_value, line_unit_cost,
      line_gross, line_discount_total, line_net, line_vat_rate, line_vat, line_total
    );

    if line_type_value = 'product' then
      insert into public.inventory_movements (
        id, workspace_id, product_id, location_id, movement_type, quantity_delta,
        unit_cost, currency, source_type, source_id, idempotency_key, command_id,
        actor_user_id, note, metadata, occurred_at
      ) values (
        gen_random_uuid(), p_workspace_id, item_id, p_inventory_location_id, 'sale', -abs(quantity_value),
        product_record.unit_cost, upper(trim(p_currency)), 'sale_line', line_id::text,
        left(trim(p_idempotency_key), 70) || ':line:' || line_id::text,
        p_command_id, p_actor_user_id, sale_reference || ' · line ' || line_index::text,
        jsonb_build_object(
          'sale_id', p_sale_id,
          'sale_reference', sale_reference,
          'sale_line_id', line_id,
          'customer_id', p_customer_id,
          'unit_price', unit_price_value,
          'discount_amount', line_discount_total
        ),
        coalesce(p_occurred_at, now())
      );
      inventory_movement_count := inventory_movement_count + 1;
    end if;
  end loop;

  command_result := jsonb_build_object(
    'action', 'complete_sale',
    'sale', to_jsonb(sale_record),
    'lineCount', line_count,
    'inventoryMovementCount', inventory_movement_count
  );

  insert into public.sale_command_receipts (workspace_id, idempotency_key, sale_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), p_sale_id, 'complete_sale', command_result);

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Sale completed',
    sale_reference || ' · ' || line_count::text || ' line(s) · ' || upper(trim(p_currency)) || ' ' || total_value::text,
    'green', 'sale', p_sale_id::text, p_command_id,
    jsonb_build_object(
      'reference', sale_reference,
      'customer_id', p_customer_id,
      'line_count', line_count,
      'product_line_count', product_line_count,
      'inventory_movement_count', inventory_movement_count,
      'total_amount', total_value,
      'settlement_status', 'not_recorded',
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_sale(
  p_workspace_id uuid,
  p_sale_id uuid,
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
  previous_result jsonb;
  command_result jsonb;
  sale_record public.sales;
  original_movement public.inventory_movements;
  reversal_count integer := 0;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Sale reversal idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Sale reversal reason is required';
  end if;

  select receipt.result into previous_result
  from public.sale_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.sales_actor_can_write(p_workspace_id, p_actor_user_id, 'reverse') then
    raise exception 'Sale reversal access denied';
  end if;

  select * into sale_record
  from public.sales sale
  where sale.workspace_id = p_workspace_id and sale.id = p_sale_id
  for update;
  if sale_record.id is null then raise exception 'Sale not found'; end if;
  if sale_record.status <> 'completed' then raise exception 'Sale is not available for reversal'; end if;

  for original_movement in
    select movement.*
    from public.inventory_movements movement
    join public.sale_lines line
      on line.workspace_id = movement.workspace_id
     and line.id::text = movement.source_id
    where line.workspace_id = p_workspace_id
      and line.sale_id = p_sale_id
      and movement.source_type = 'sale_line'
      and movement.movement_type = 'sale'
    order by movement.occurred_at, movement.id
  loop
    if exists (
      select 1 from public.inventory_movements reversal
      where reversal.workspace_id = p_workspace_id and reversal.reversal_of_id = original_movement.id
    ) then raise exception 'A Sale Inventory movement has already been reversed'; end if;

    insert into public.inventory_movements (
      id, workspace_id, product_id, location_id, movement_type, quantity_delta,
      unit_cost, currency, source_type, source_id, reversal_of_id, idempotency_key,
      command_id, actor_user_id, note, metadata, occurred_at
    ) values (
      gen_random_uuid(), p_workspace_id, original_movement.product_id, original_movement.location_id,
      'reversal', -original_movement.quantity_delta, original_movement.unit_cost,
      original_movement.currency, 'sale_reversal', p_sale_id::text, original_movement.id,
      left(trim(p_idempotency_key), 70) || ':rev:' || original_movement.id::text,
      p_command_id, p_actor_user_id, trim(p_reason),
      jsonb_build_object(
        'sale_id', p_sale_id,
        'sale_reference', sale_record.reference,
        'original_movement_id', original_movement.id,
        'reason', trim(p_reason)
      ),
      now()
    );
    reversal_count := reversal_count + 1;
  end loop;

  update public.sales
  set status = 'reversed',
      version = version + 1,
      reversed_at = now(),
      reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason)
  where workspace_id = p_workspace_id and id = p_sale_id
  returning * into sale_record;

  command_result := jsonb_build_object(
    'action', 'reverse_sale',
    'sale', to_jsonb(sale_record),
    'inventoryReversalCount', reversal_count
  );

  insert into public.sale_command_receipts (workspace_id, idempotency_key, sale_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), p_sale_id, 'reverse_sale', command_result);

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Sale reversed',
    sale_record.reference || ' · ' || trim(p_reason),
    'gold', 'sale', p_sale_id::text, p_command_id,
    jsonb_build_object(
      'reference', sale_record.reference,
      'inventory_reversal_count', reversal_count,
      'reason', trim(p_reason),
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.prevent_sale_line_change() from public;
revoke all on function private.prevent_sale_header_change() from public;
revoke all on function private.sales_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.complete_sale(uuid, uuid, text, uuid, uuid, jsonb, text, text, uuid, uuid, numeric, timestamptz, text) from public, anon, authenticated;
revoke all on function public.reverse_sale(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

grant execute on function private.sales_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.complete_sale(uuid, uuid, text, uuid, uuid, jsonb, text, text, uuid, uuid, numeric, timestamptz, text) to service_role;
grant execute on function public.reverse_sale(uuid, uuid, text, uuid, uuid, text) to service_role;

revoke all on table public.sales, public.sale_lines, public.sale_command_receipts from anon, authenticated;
grant select on table public.sales, public.sale_lines to authenticated;

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_command_receipts enable row level security;

create policy "Sales permission read"
on public.sales for select to authenticated
using (private.has_workspace_permission(workspace_id, 'sales', 'view'));

create policy "Sale lines permission read"
on public.sale_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'sales', 'view'));

comment on table public.sales is
  'Immutable completed commercial transactions. Payment settlement and Accounts posting remain separate downstream records.';
comment on table public.sale_lines is
  'Immutable Product and Service snapshots for completed Sales. Product lines create matching Inventory movements.';
comment on column public.sales.settlement_status is
  'Version 1 boundary: Sales does not claim payment until the Payment ledger is connected.';
comment on function public.complete_sale(uuid, uuid, text, uuid, uuid, jsonb, text, text, uuid, uuid, numeric, timestamptz, text) is
  'Atomically completes one Sale, snapshots its lines and posts Product stock-out movements.';

commit;
