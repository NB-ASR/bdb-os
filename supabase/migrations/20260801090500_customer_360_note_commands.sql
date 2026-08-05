begin;

create or replace function public.create_customer_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_customer_id uuid,
  p_body text,
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
  customer_record public.customers;
  note_record public.customer_notes;
  previous_result jsonb;
  command_result jsonb;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer note idempotency key is invalid';
  end if;
  if p_body is null or char_length(trim(p_body)) not between 1 and 4000 then
    raise exception 'Customer note body is invalid';
  end if;
  if p_occurred_at is null then
    raise exception 'Customer note date is invalid';
  end if;

  select receipt.result into previous_result
  from public.customer_note_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'customers',
    'create'
  ) then
    raise exception 'Customer note write access denied';
  end if;

  select * into customer_record
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and customer.id = p_customer_id
  for share;
  if customer_record.id is null then
    raise exception 'Customer not found';
  end if;

  insert into public.customer_notes (
    id,
    workspace_id,
    customer_id,
    note_kind,
    body,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_note_id,
    p_workspace_id,
    p_customer_id,
    'note',
    trim(p_body),
    p_actor_user_id,
    p_command_id,
    p_occurred_at
  ) returning * into note_record;

  command_result := jsonb_build_object(
    'action', 'create',
    'note', to_jsonb(note_record)
  );

  insert into public.customer_note_command_receipts (
    workspace_id,
    idempotency_key,
    note_id,
    action,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    note_record.id,
    'create',
    command_result
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
    'Customer note added',
    customer_record.name || ' · ' || left(note_record.body, 160),
    'gold',
    note_record.occurred_at,
    'customer',
    customer_record.id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'customer_note',
      'customer_id', customer_record.id,
      'note_id', note_record.id,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

create or replace function public.void_customer_note(
  p_workspace_id uuid,
  p_void_note_id uuid,
  p_customer_id uuid,
  p_note_id uuid,
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
  customer_record public.customers;
  original_note public.customer_notes;
  void_record public.customer_notes;
  previous_result jsonb;
  command_result jsonb;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer note idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Customer note void reason is invalid';
  end if;
  if p_occurred_at is null then
    raise exception 'Customer note void date is invalid';
  end if;

  select receipt.result into previous_result
  from public.customer_note_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'customers',
    'edit'
  ) then
    raise exception 'Customer note void access denied';
  end if;

  select * into customer_record
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and customer.id = p_customer_id
  for share;
  if customer_record.id is null then
    raise exception 'Customer not found';
  end if;

  select * into original_note
  from public.customer_notes note
  where note.workspace_id = p_workspace_id
    and note.customer_id = p_customer_id
    and note.id = p_note_id
    and note.note_kind = 'note'
  for update;
  if original_note.id is null then
    raise exception 'Customer note not found';
  end if;

  if exists (
    select 1
    from public.customer_notes note_void
    where note_void.workspace_id = p_workspace_id
      and note_void.parent_note_id = original_note.id
      and note_void.note_kind = 'void'
  ) then
    raise exception 'Customer note has already been voided';
  end if;

  insert into public.customer_notes (
    id,
    workspace_id,
    customer_id,
    note_kind,
    body,
    parent_note_id,
    reason,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_void_note_id,
    p_workspace_id,
    p_customer_id,
    'void',
    null,
    original_note.id,
    trim(p_reason),
    p_actor_user_id,
    p_command_id,
    p_occurred_at
  ) returning * into void_record;

  command_result := jsonb_build_object(
    'action', 'void',
    'noteId', original_note.id,
    'void', to_jsonb(void_record)
  );

  insert into public.customer_note_command_receipts (
    workspace_id,
    idempotency_key,
    note_id,
    action,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    void_record.id,
    'void',
    command_result
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
    'Customer note voided',
    customer_record.name || ' · ' || trim(p_reason),
    'neutral',
    void_record.occurred_at,
    'customer',
    customer_record.id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'customer_note',
      'customer_id', customer_record.id,
      'note_id', original_note.id,
      'void_note_id', void_record.id,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function public.create_customer_note(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.void_customer_note(uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_customer_note(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.void_customer_note(uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;

commit;
