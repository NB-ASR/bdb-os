begin;

-- Customer Engine V1 Pass 1 — canonical foundation.
-- Preserve historical compatibility columns, but make the active source-of-truth
-- boundaries explicit before the scale/offline passes.

comment on column public.customers.notes is
  'Legacy/imported Customer context retained for history. Operational Customer notes are canonical in public.customer_notes and must be changed only through the append-only Customer note commands.';

comment on column public.customers.vat_number is
  'Canonical Customer VAT/legal tax identity used by Customer-owned master data and consumed by Business Documents.';

comment on column public.documents.customer_id is
  'Legacy compatibility pointer retained for historical rows. Canonical general Document relationships are public.document_links rows with link_type = customer.';

-- If any historical general Document still has only the legacy direct Customer
-- pointer, preserve that relationship in the canonical link ledger before new
-- writes stop maintaining the direct column.
insert into public.document_links (
  id,
  workspace_id,
  document_id,
  link_type,
  target_id,
  created_by,
  command_id,
  created_at
)
select
  gen_random_uuid(),
  document.workspace_id,
  document.id,
  'customer',
  document.customer_id,
  document.created_by,
  null,
  document.uploaded_at
from public.documents document
where document.customer_id is not null
  and not exists (
    select 1
    from public.document_links link
    where link.workspace_id = document.workspace_id
      and link.document_id = document.id
      and link.link_type = 'customer'
      and link.target_id = document.customer_id
      and link.revoked_at is null
  );

-- Keep the established Customer RPC signature so Accounts/document consumers do
-- not break, but make p_notes compatibility-only. Normal Customer lifecycle
-- commands can no longer create or mutate the legacy notes column.
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
  p_allow_duplicate boolean default false,
  p_vat_number text default null
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
  vat_value text := nullif(trim(coalesce(p_vat_number, '')), '');
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported customer action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer idempotency key is invalid';
  end if;
  if char_length(coalesce(vat_value, '')) > 64 then
    raise exception 'Customer VAT number is invalid';
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
      preferences, vat_number, created_by, updated_by
    ) values (
      p_customer_id,
      p_workspace_id,
      effective_code,
      trim(p_name),
      coalesce(nullif(trim(p_company), ''), ''),
      nullif(trim(p_email), ''),
      nullif(trim(p_phone), ''),
      nullif(trim(p_address), ''),
      null,
      p_preferences,
      vat_value,
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
          preferences = p_preferences,
          vat_number = vat_value,
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

revoke all on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean, text) to service_role;

-- General Document commands now write the relationship only to document_links.
-- The direct documents.customer_id value remains untouched on old rows for
-- compatibility/history, but is not maintained for new general Documents.
create or replace function public.create_general_document(
  p_workspace_id uuid,
  p_document_id uuid,
  p_link_id uuid,
  p_link_type text,
  p_target_id uuid,
  p_name text,
  p_original_file_name text,
  p_document_type text,
  p_mime_type text,
  p_size_label text,
  p_size_bytes bigint,
  p_category text,
  p_description text,
  p_storage_path text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_uploaded_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  document_record public.documents;
  link_record public.document_links;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Document idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(p_workspace_id, p_actor_user_id, 'documents', 'create') then
    raise exception 'Document create access denied';
  end if;
  if p_link_type not in ('business', 'customer', 'appointment', 'sale', 'invoice', 'customer_payment', 'communication') then
    raise exception 'Document link type is invalid';
  end if;
  if not private.general_document_actor_can_link(p_workspace_id, p_actor_user_id, p_link_type) then
    raise exception 'Document source access denied';
  end if;
  if not private.general_document_target_exists(p_workspace_id, p_link_type, p_target_id) then
    raise exception 'Document linked record not found';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 240 then
    raise exception 'Document name is invalid';
  end if;
  if p_original_file_name is null or char_length(trim(p_original_file_name)) not between 1 and 240 then
    raise exception 'Original file name is invalid';
  end if;
  if p_document_type is null or char_length(trim(p_document_type)) not between 1 and 40 then
    raise exception 'Document type is invalid';
  end if;
  if p_mime_type is null or char_length(trim(p_mime_type)) not between 1 and 160 then
    raise exception 'Document media type is invalid';
  end if;
  if p_size_label is null or char_length(trim(p_size_label)) not between 1 and 40 then
    raise exception 'Document size label is invalid';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10000000 then
    raise exception 'Document file size is invalid';
  end if;
  if p_category is null or char_length(trim(p_category)) not between 1 and 80 then
    raise exception 'Document category is invalid';
  end if;
  if p_description is not null and char_length(trim(p_description)) > 2000 then
    raise exception 'Document description is too long';
  end if;
  if p_storage_path is null or char_length(trim(p_storage_path)) not between 1 and 500 then
    raise exception 'Document storage path is invalid';
  end if;
  if p_uploaded_at is null then raise exception 'Document upload date is invalid'; end if;
  if exists (select 1 from public.documents where id = p_document_id) then
    raise exception 'Document identity conflict';
  end if;
  if exists (select 1 from public.document_links where id = p_link_id) then
    raise exception 'Document link identity conflict';
  end if;

  insert into public.documents (
    id,
    workspace_id,
    name,
    original_file_name,
    document_type,
    mime_type,
    size_label,
    size_bytes,
    category,
    description,
    customer_id,
    linked_to,
    uploaded_at,
    storage_path,
    status,
    created_by
  ) values (
    p_document_id,
    p_workspace_id,
    trim(p_name),
    trim(p_original_file_name),
    trim(p_document_type),
    trim(p_mime_type),
    trim(p_size_label),
    p_size_bytes,
    trim(p_category),
    nullif(trim(p_description), ''),
    null,
    case
      when p_link_type = 'business' then 'Business'
      when p_link_type = 'customer' then 'Customer'
      when p_link_type = 'appointment' then 'Appointment'
      when p_link_type = 'sale' then 'Sale'
      when p_link_type = 'invoice' then 'Invoice'
      when p_link_type = 'customer_payment' then 'Customer Payment'
      else 'Communication'
    end,
    p_uploaded_at,
    trim(p_storage_path),
    'active',
    p_actor_user_id
  ) returning * into document_record;

  insert into public.document_links (
    id,
    workspace_id,
    document_id,
    link_type,
    target_id,
    created_by,
    command_id,
    created_at
  ) values (
    p_link_id,
    p_workspace_id,
    p_document_id,
    p_link_type,
    p_target_id,
    p_actor_user_id,
    p_command_id,
    p_uploaded_at
  ) returning * into link_record;

  command_result := jsonb_build_object(
    'action', 'create_document',
    'document', to_jsonb(document_record),
    'link', to_jsonb(link_record)
  );

  insert into public.document_command_receipts (
    workspace_id, idempotency_key, action, document_id, link_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'create_document', p_document_id, p_link_id, command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Document uploaded',
    trim(p_name) || ' · ' || replace(p_link_type, '_', ' '),
    'blue',
    p_uploaded_at,
    'document',
    p_document_id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'general_document',
      'document_id', p_document_id,
      'link_id', p_link_id,
      'link_type', p_link_type,
      'target_id', p_target_id,
      'idempotency_key', trim(p_idempotency_key)
    )
  );

  return command_result;
end;
$$;

revoke all on function public.create_general_document(uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_general_document(uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, text, text, uuid, uuid, timestamptz) to service_role;

commit;
