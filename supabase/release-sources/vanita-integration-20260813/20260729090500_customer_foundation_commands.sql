begin;

create or replace function public.apply_customer_command(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_company text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_preferences jsonb default '{}'::jsonb,
  p_allow_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_record public.customers;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
  effective_code text;
  duplicate_ids uuid[] := '{}'::uuid[];
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported customer action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.customer_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Customer write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_name is null or char_length(trim(p_name)) not between 1 and 160 then
      raise exception 'Customer name is invalid';
    end if;
    if p_company is not null and char_length(trim(p_company)) > 160 then
      raise exception 'Customer company is invalid';
    end if;
    if p_email is not null and char_length(trim(p_email)) > 320 then
      raise exception 'Customer email is invalid';
    end if;
    if p_phone is not null and char_length(trim(p_phone)) > 50 then
      raise exception 'Customer phone is invalid';
    end if;
    if p_address is not null and char_length(p_address) > 1000 then
      raise exception 'Customer address is invalid';
    end if;
    if p_notes is not null and char_length(p_notes) > 4000 then
      raise exception 'Customer notes are invalid';
    end if;
    if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
      raise exception 'Customer preferences are invalid';
    end if;

    select coalesce(array_agg(customer.id), '{}'::uuid[])
    into duplicate_ids
    from public.customers customer
    where customer.workspace_id = p_workspace_id
      and customer.id <> p_customer_id
      and (
        (
          nullif(trim(p_email), '') is not null
          and customer.email is not null
          and lower(trim(customer.email::text)) = lower(trim(p_email))
        )
        or (
          nullif(trim(p_phone), '') is not null
          and char_length(regexp_replace(p_phone, '[^0-9]', '', 'g')) >= 6
          and customer.phone is not null
          and regexp_replace(customer.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
        )
      );

    if cardinality(duplicate_ids) > 0 and not p_allow_duplicate then
      raise exception 'Potential duplicate customer requires review';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.customers where id = p_customer_id) then
      raise exception 'Customer identity conflict';
    end if;

    effective_code := coalesce(
      nullif(trim(p_code), ''),
      'CUS-' || upper(right(replace(p_customer_id::text, '-', ''), 16))
    );

    insert into public.customers (
      id, workspace_id, code, name, company, email, phone, address, notes,
      preferences, created_by, updated_by
    ) values (
      p_customer_id,
      p_workspace_id,
      effective_code,
      trim(p_name),
      coalesce(nullif(trim(p_company), ''), ''),
      nullif(trim(p_email), ''),
      nullif(trim(p_phone), ''),
      nullif(trim(p_address), ''),
      nullif(trim(p_notes), ''),
      p_preferences,
      p_actor_user_id,
      p_actor_user_id
    ) returning * into customer_record;
    activity_action := 'Customer created';
    activity_tone := 'blue';
  else
    select * into customer_record
    from public.customers
    where workspace_id = p_workspace_id and id = p_customer_id
    for update;

    if customer_record.id is null then
      raise exception 'Customer not found';
    end if;
    if p_expected_version is null or customer_record.version <> p_expected_version then
      raise exception 'Customer changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      effective_code := coalesce(nullif(trim(p_code), ''), customer_record.code);
      update public.customers
      set code = effective_code,
          name = trim(p_name),
          company = coalesce(nullif(trim(p_company), ''), ''),
          email = nullif(trim(p_email), ''),
          phone = nullif(trim(p_phone), ''),
          address = nullif(trim(p_address), ''),
          notes = nullif(trim(p_notes), ''),
          preferences = p_preferences,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_customer_id
      returning * into customer_record;
      activity_action := 'Customer updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.customers
      set status = 'archived',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_customer_id
      returning * into customer_record;
      activity_action := 'Customer archived';
      activity_tone := 'gold';
    else
      update public.customers
      set status = 'active',
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_customer_id
      returning * into customer_record;
      activity_action := 'Customer restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object(
    'action', p_action,
    'customer', to_jsonb(customer_record),
    'duplicateCustomerIds', to_jsonb(duplicate_ids)
  );

  insert into public.customer_command_receipts (
    workspace_id, idempotency_key, customer_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), customer_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    activity_action,
    customer_record.name || ' · ' || customer_record.code,
    activity_tone,
    'customer',
    customer_record.id::text,
    p_command_id,
    jsonb_build_object(
      'customer_id', customer_record.id,
      'code', customer_record.code,
      'status', customer_record.status,
      'version', customer_record.version,
      'idempotency_key', p_idempotency_key,
      'duplicate_override', p_allow_duplicate
    )
  );

  return command_result;
end;
$$;

revoke all on function private.customer_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function private.customer_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) to service_role;

commit;
