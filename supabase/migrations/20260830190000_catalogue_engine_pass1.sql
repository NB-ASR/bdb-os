begin;

-- Catalogue Engine V1 Pass 1: preserve replay safety, but reject accidental
-- reuse of an idempotency key for a different entity or action. The original
-- Catalogue command functions returned the prior receipt solely by key, which
-- could make a different command appear successful if a key were reused.

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
  previous_product_id uuid;
  previous_action text;
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

  select receipt.product_id, receipt.action, receipt.result
  into previous_product_id, previous_action, previous_result
  from public.product_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    if previous_product_id <> p_product_id or previous_action <> p_action then
      raise exception 'Product idempotency key was already used for another command';
    end if;
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

create or replace function public.apply_service_command(
  p_workspace_id uuid,
  p_service_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_category text default null,
  p_duration_minutes integer default null,
  p_preparation_buffer_minutes integer default 0,
  p_recovery_buffer_minutes integer default 0,
  p_price numeric default null,
  p_vat_rate numeric default 0,
  p_booking_mode text default 'customer',
  p_description text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_record public.services;
  previous_service_id uuid;
  previous_action text;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported Service action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Service idempotency key is invalid';
  end if;

  select receipt.service_id, receipt.action, receipt.result
  into previous_service_id, previous_action, previous_result
  from public.service_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    if previous_service_id <> p_service_id or previous_action <> p_action then
      raise exception 'Service idempotency key was already used for another command';
    end if;
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.service_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Service write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_code is null or char_length(trim(p_code)) not between 1 and 64 then
      raise exception 'Service code is invalid';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 2 and 160 then
      raise exception 'Service name is invalid';
    end if;
    if p_category is not null and char_length(p_category) > 120 then
      raise exception 'Service category is invalid';
    end if;
    if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 1440 then
      raise exception 'Service duration is invalid';
    end if;
    if p_preparation_buffer_minutes is null or p_preparation_buffer_minutes < 0 or p_preparation_buffer_minutes > 240 then
      raise exception 'Service preparation buffer is invalid';
    end if;
    if p_recovery_buffer_minutes is null or p_recovery_buffer_minutes < 0 or p_recovery_buffer_minutes > 240 then
      raise exception 'Service recovery buffer is invalid';
    end if;
    if p_price is not null and p_price < 0 then
      raise exception 'Service price is invalid';
    end if;
    if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
      raise exception 'Service VAT rate is invalid';
    end if;
    if p_booking_mode not in ('customer', 'staff') then
      raise exception 'Service booking mode is invalid';
    end if;
    if p_description is not null and char_length(p_description) > 2000 then
      raise exception 'Service description is too long';
    end if;
    if p_notes is not null and char_length(p_notes) > 2000 then
      raise exception 'Service notes are too long';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.services where id = p_service_id) then
      raise exception 'Service identity conflict';
    end if;
    insert into public.services (
      id, workspace_id, code, name, category, duration_minutes,
      preparation_buffer_minutes, recovery_buffer_minutes, price, vat_rate,
      booking_mode, description, notes, created_by, updated_by
    ) values (
      p_service_id, p_workspace_id, trim(p_code), trim(p_name),
      nullif(trim(p_category), ''), p_duration_minutes,
      p_preparation_buffer_minutes, p_recovery_buffer_minutes, p_price, p_vat_rate,
      p_booking_mode, nullif(trim(p_description), ''), nullif(trim(p_notes), ''),
      p_actor_user_id, p_actor_user_id
    ) returning * into service_record;
    activity_action := 'Service created';
    activity_tone := 'blue';
  else
    select * into service_record
    from public.services
    where workspace_id = p_workspace_id and id = p_service_id
    for update;
    if service_record.id is null then raise exception 'Service not found'; end if;
    if p_expected_version is null or service_record.version <> p_expected_version then
      raise exception 'Service changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      update public.services
      set code = trim(p_code),
          name = trim(p_name),
          category = nullif(trim(p_category), ''),
          duration_minutes = p_duration_minutes,
          preparation_buffer_minutes = p_preparation_buffer_minutes,
          recovery_buffer_minutes = p_recovery_buffer_minutes,
          price = p_price,
          vat_rate = p_vat_rate,
          booking_mode = p_booking_mode,
          description = nullif(trim(p_description), ''),
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.services
      set status = 'archived', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service archived';
      activity_tone := 'gold';
    else
      update public.services
      set status = 'active', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object('action', p_action, 'service', to_jsonb(service_record));

  insert into public.service_command_receipts (
    workspace_id, idempotency_key, service_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), service_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    service_record.name || ' · ' || service_record.code::text,
    activity_tone, 'service', service_record.id::text, p_command_id,
    jsonb_build_object(
      'service_id', service_record.id,
      'code', service_record.code::text,
      'status', service_record.status,
      'version', service_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
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
  previous_relationship_id uuid;
  previous_action text;
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

  select receipt.relationship_id, receipt.action, receipt.result
  into previous_relationship_id, previous_action, previous_result
  from public.product_supplier_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    if previous_relationship_id <> p_relationship_id or previous_action <> p_action then
      raise exception 'Product Supplier idempotency key was already used for another command';
    end if;
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

revoke all on function public.apply_product_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.apply_service_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) from public, anon, authenticated;

grant execute on function public.apply_product_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) to service_role;
grant execute on function public.apply_service_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) to service_role;
grant execute on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) to service_role;

comment on function public.apply_product_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) is
  'Catalogue V1 Product command. Stable retries return the original receipt; reuse of a key for another Product or action is rejected.';
comment on function public.apply_service_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) is
  'Catalogue V1 Service command. Stable retries return the original receipt; reuse of a key for another Service or action is rejected.';
comment on function public.apply_product_supplier_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, text, numeric, text, boolean, integer, numeric, text) is
  'Catalogue V1 Product Supplier command. Stable retries return the original receipt; reuse of a key for another relationship or action is rejected.';

commit;
