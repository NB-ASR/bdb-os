begin;

create or replace function private.general_document_target_exists(
  target_workspace_id uuid,
  target_link_type text,
  target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case target_link_type
    when 'business' then target_id is null
    when 'customer' then exists (
      select 1 from public.customers record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    when 'appointment' then exists (
      select 1 from public.bookings record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    when 'sale' then exists (
      select 1 from public.sales record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    when 'invoice' then exists (
      select 1 from public.invoices record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    when 'customer_payment' then exists (
      select 1 from public.payments record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    when 'communication' then exists (
      select 1 from public.messages record
      where record.workspace_id = target_workspace_id and record.id = target_id
    )
    else false
  end;
$$;

create or replace function private.general_document_actor_can_link(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_link_type text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case target_link_type
    when 'business' then true
    when 'customer' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'customers', 'view')
    when 'appointment' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'calendar', 'view')
    when 'sale' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'sales', 'view')
    when 'invoice' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'accounts', 'view')
    when 'customer_payment' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'accounts', 'view')
    when 'communication' then private.actor_has_workspace_permission(target_workspace_id, target_actor_user_id, 'communications', 'view')
    else false
  end;
$$;

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
    case when p_link_type = 'customer' then p_target_id else null end,
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

create or replace function public.add_general_document_link(
  p_workspace_id uuid,
  p_document_id uuid,
  p_link_id uuid,
  p_link_type text,
  p_target_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
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
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(p_workspace_id, p_actor_user_id, 'documents', 'edit') then
    raise exception 'Document link access denied';
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

  select * into document_record
  from public.documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Document not found'; end if;
  if document_record.status <> 'active' then raise exception 'Archived Documents cannot receive links'; end if;
  if exists (select 1 from public.document_links where id = p_link_id) then
    raise exception 'Document link identity conflict';
  end if;
  if exists (
    select 1 from public.document_links link
    where link.workspace_id = p_workspace_id
      and link.document_id = p_document_id
      and link.link_type = p_link_type
      and link.target_id is not distinct from p_target_id
      and link.revoked_at is null
  ) then raise exception 'Document link already exists'; end if;

  insert into public.document_links (
    id, workspace_id, document_id, link_type, target_id, created_by, command_id, created_at
  ) values (
    p_link_id, p_workspace_id, p_document_id, p_link_type, p_target_id,
    p_actor_user_id, p_command_id, p_occurred_at
  ) returning * into link_record;

  command_result := jsonb_build_object(
    'action', 'add_link',
    'documentId', p_document_id,
    'link', to_jsonb(link_record)
  );
  insert into public.document_command_receipts (
    workspace_id, idempotency_key, action, document_id, link_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'add_link', p_document_id, p_link_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, occurred_at,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Document linked',
    document_record.name || ' · ' || replace(p_link_type, '_', ' '),
    'blue', p_occurred_at, 'document', p_document_id::text, p_command_id,
    jsonb_build_object('source', 'general_document_link', 'document_id', p_document_id,
      'link_id', p_link_id, 'link_type', p_link_type, 'target_id', p_target_id,
      'idempotency_key', trim(p_idempotency_key))
  );
  return command_result;
end;
$$;

create or replace function public.revoke_general_document_link(
  p_workspace_id uuid,
  p_document_id uuid,
  p_link_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
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
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Document link revoke reason is invalid';
  end if;
  select receipt.result into previous_result
  from public.document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(p_workspace_id, p_actor_user_id, 'documents', 'edit') then
    raise exception 'Document link access denied';
  end if;
  select * into document_record from public.documents
  where workspace_id = p_workspace_id and id = p_document_id;
  if document_record.id is null then raise exception 'Document not found'; end if;

  select * into link_record
  from public.document_links
  where workspace_id = p_workspace_id
    and document_id = p_document_id
    and id = p_link_id
  for update;
  if link_record.id is null then raise exception 'Document link not found'; end if;
  if link_record.revoked_at is not null then raise exception 'Document link is already revoked'; end if;

  update public.document_links
  set revoked_at = p_occurred_at,
      revoked_by = p_actor_user_id,
      revoke_reason = trim(p_reason)
  where id = p_link_id
  returning * into link_record;

  command_result := jsonb_build_object(
    'action', 'revoke_link',
    'documentId', p_document_id,
    'link', to_jsonb(link_record)
  );
  insert into public.document_command_receipts (
    workspace_id, idempotency_key, action, document_id, link_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'revoke_link', p_document_id, p_link_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, occurred_at,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Document link revoked',
    document_record.name || ' · ' || trim(p_reason),
    'neutral', p_occurred_at, 'document', p_document_id::text, p_command_id,
    jsonb_build_object('source', 'general_document_link', 'document_id', p_document_id,
      'link_id', p_link_id, 'link_type', link_record.link_type,
      'target_id', link_record.target_id, 'idempotency_key', trim(p_idempotency_key))
  );
  return command_result;
end;
$$;

create or replace function public.archive_general_document(
  p_workspace_id uuid,
  p_document_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
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
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Document idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Document archive reason is invalid';
  end if;
  select receipt.result into previous_result
  from public.document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(p_workspace_id, p_actor_user_id, 'documents', 'edit') then
    raise exception 'Document archive access denied';
  end if;
  select * into document_record
  from public.documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Document not found'; end if;
  if document_record.status = 'archived' then raise exception 'Document is already archived'; end if;

  update public.documents
  set status = 'archived',
      archived_at = p_occurred_at,
      archived_by = p_actor_user_id
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  command_result := jsonb_build_object(
    'action', 'archive_document',
    'reason', trim(p_reason),
    'document', to_jsonb(document_record)
  );
  insert into public.document_command_receipts (
    workspace_id, idempotency_key, action, document_id, link_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'archive_document', p_document_id, null, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, occurred_at,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Document archived',
    document_record.name || ' · ' || trim(p_reason),
    'neutral', p_occurred_at, 'document', p_document_id::text, p_command_id,
    jsonb_build_object('source', 'general_document', 'document_id', p_document_id,
      'archive_reason', trim(p_reason), 'idempotency_key', trim(p_idempotency_key))
  );
  return command_result;
end;
$$;

revoke all on function private.general_document_target_exists(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.general_document_actor_can_link(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_general_document(uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.add_general_document_link(uuid, uuid, uuid, text, uuid, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_general_document_link(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.archive_general_document(uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function private.general_document_target_exists(uuid, text, uuid) to service_role;
grant execute on function private.general_document_actor_can_link(uuid, uuid, text) to service_role;
grant execute on function public.create_general_document(uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.add_general_document_link(uuid, uuid, uuid, text, uuid, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.revoke_general_document_link(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.archive_general_document(uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;

commit;
