begin;

create or replace function private.communication_target_exists(
  target_workspace_id uuid,
  target_customer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.customers customer
    where customer.workspace_id = target_workspace_id
      and customer.id = target_customer_id
      and customer.status = 'active'
  );
$$;

create or replace function private.communication_actor_can_write(
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
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'communications',
    target_action
  );
$$;

create or replace function public.record_communication_message(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_message_id uuid,
  p_customer_id uuid,
  p_channel text,
  p_direction text,
  p_subject text,
  p_body text,
  p_reply_to_message_id uuid,
  p_draft_state text,
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
  thread_record public.communication_threads;
  message_record public.messages;
  reply_record public.messages;
  creating_thread boolean := false;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Communication idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.communication_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.communication_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Communication create access denied';
  end if;
  if not private.actor_has_workspace_permission(p_workspace_id, p_actor_user_id, 'customers', 'view') then
    raise exception 'Communication Customer access denied';
  end if;
  if not private.communication_target_exists(p_workspace_id, p_customer_id) then
    raise exception 'Communication Customer not found';
  end if;
  if p_channel not in ('Email', 'WhatsApp', 'Instagram', 'Web') then
    raise exception 'Communication channel is invalid';
  end if;
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'Communication direction is invalid';
  end if;
  if p_draft_state not in ('none', 'review') then
    raise exception 'Communication draft state is invalid';
  end if;
  if p_draft_state = 'review' and p_direction <> 'outbound' then
    raise exception 'Only outbound communication can require draft review';
  end if;
  if p_subject is null or char_length(trim(p_subject)) not between 1 and 240 then
    raise exception 'Communication subject is invalid';
  end if;
  if p_body is null or char_length(trim(p_body)) not between 1 and 10000 then
    raise exception 'Communication body is invalid';
  end if;
  if p_occurred_at is null then
    raise exception 'Communication date is invalid';
  end if;
  if exists (select 1 from public.messages where id = p_message_id) then
    raise exception 'Communication message identity conflict';
  end if;

  select * into thread_record
  from public.communication_threads thread
  where thread.workspace_id = p_workspace_id
    and thread.id = p_thread_id
  for update;

  if thread_record.id is null then
    creating_thread := true;
    insert into public.communication_threads (
      id,
      workspace_id,
      customer_id,
      channel,
      subject,
      status,
      last_message_at,
      created_at,
      updated_at,
      created_by
    ) values (
      p_thread_id,
      p_workspace_id,
      p_customer_id,
      p_channel,
      trim(p_subject),
      'open',
      p_occurred_at,
      p_occurred_at,
      p_occurred_at,
      p_actor_user_id
    ) returning * into thread_record;
  else
    if thread_record.customer_id <> p_customer_id then
      raise exception 'Communication thread Customer conflict';
    end if;
    if thread_record.channel <> p_channel then
      raise exception 'Communication thread channel conflict';
    end if;
    if thread_record.status <> 'open' then
      raise exception 'Closed communication threads cannot receive messages';
    end if;
  end if;

  if p_reply_to_message_id is not null then
    select * into reply_record
    from public.messages reply
    where reply.workspace_id = p_workspace_id
      and reply.thread_id = p_thread_id
      and reply.id = p_reply_to_message_id;
    if reply_record.id is null then
      raise exception 'Communication reply target not found';
    end if;
  end if;

  insert into public.messages (
    id,
    workspace_id,
    customer_id,
    channel,
    subject,
    preview,
    body,
    occurred_at,
    unread,
    status,
    thread_id,
    direction,
    reply_to_message_id,
    draft_state,
    read_at,
    read_by,
    recorded_by,
    command_id,
    created_at,
    updated_at
  ) values (
    p_message_id,
    p_workspace_id,
    p_customer_id,
    p_channel,
    trim(p_subject),
    left(trim(p_body), 500),
    trim(p_body),
    p_occurred_at,
    p_direction = 'inbound',
    case
      when p_draft_state = 'review' then 'approval'::public.message_status
      when p_direction = 'outbound' then 'replied'::public.message_status
      else 'open'::public.message_status
    end,
    p_thread_id,
    p_direction,
    p_reply_to_message_id,
    p_draft_state,
    case when p_direction = 'outbound' then p_occurred_at else null end,
    case when p_direction = 'outbound' then p_actor_user_id else null end,
    p_actor_user_id,
    p_command_id,
    p_occurred_at,
    p_occurred_at
  ) returning * into message_record;

  update public.communication_threads
  set last_message_at = greatest(last_message_at, p_occurred_at),
      updated_at = p_occurred_at
  where workspace_id = p_workspace_id
    and id = p_thread_id
  returning * into thread_record;

  command_result := jsonb_build_object(
    'action', 'record_message',
    'createdThread', creating_thread,
    'thread', to_jsonb(thread_record),
    'message', to_jsonb(message_record)
  );

  insert into public.communication_command_receipts (
    workspace_id,
    idempotency_key,
    action,
    thread_id,
    message_id,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    'record_message',
    p_thread_id,
    p_message_id,
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
    case
      when p_draft_state = 'review' then 'Communication draft recorded'
      when p_direction = 'inbound' then 'Communication received'
      else 'Communication recorded'
    end,
    trim(p_subject) || ' · ' || p_channel,
    case
      when p_draft_state = 'review' then 'gold'
      when p_direction = 'inbound' then 'blue'
      else 'green'
    end,
    p_occurred_at,
    'communication_message',
    p_message_id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'unified_communication',
      'workspace_id', p_workspace_id,
      'customer_id', p_customer_id,
      'thread_id', p_thread_id,
      'message_id', p_message_id,
      'channel', p_channel,
      'direction', p_direction,
      'draft_state', p_draft_state,
      'idempotency_key', trim(p_idempotency_key)
    )
  );

  return command_result;
end;
$$;

create or replace function public.mark_communication_message_read(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_message_id uuid,
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
  message_record public.messages;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Communication idempotency key is invalid';
  end if;
  select receipt.result into previous_result
  from public.communication_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.communication_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Communication edit access denied';
  end if;

  select * into message_record
  from public.messages message
  where message.workspace_id = p_workspace_id
    and message.thread_id = p_thread_id
    and message.id = p_message_id
  for update;
  if message_record.id is null then raise exception 'Communication message not found'; end if;
  if message_record.direction <> 'inbound' then
    raise exception 'Only inbound communication can be marked read';
  end if;

  if message_record.unread or message_record.read_at is null then
    update public.messages
    set unread = false,
        read_at = coalesce(read_at, p_occurred_at),
        read_by = coalesce(read_by, p_actor_user_id),
        updated_at = p_occurred_at
    where id = p_message_id
    returning * into message_record;
  end if;

  command_result := jsonb_build_object(
    'action', 'mark_read',
    'threadId', p_thread_id,
    'message', to_jsonb(message_record)
  );
  insert into public.communication_command_receipts (
    workspace_id, idempotency_key, action, thread_id, message_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'mark_read', p_thread_id, p_message_id, command_result
  );
  return command_result;
end;
$$;

create or replace function public.dismiss_communication_draft(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_message_id uuid,
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
  message_record public.messages;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Communication idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Communication draft dismissal reason is invalid';
  end if;
  select receipt.result into previous_result
  from public.communication_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.communication_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Communication edit access denied';
  end if;

  select * into message_record
  from public.messages message
  where message.workspace_id = p_workspace_id
    and message.thread_id = p_thread_id
    and message.id = p_message_id
  for update;
  if message_record.id is null then raise exception 'Communication message not found'; end if;
  if message_record.draft_state <> 'review' then
    raise exception 'Communication draft is not awaiting review';
  end if;

  update public.messages
  set draft_state = 'dismissed',
      status = 'open'::public.message_status,
      updated_at = p_occurred_at
  where id = p_message_id
  returning * into message_record;

  command_result := jsonb_build_object(
    'action', 'dismiss_draft',
    'reason', trim(p_reason),
    'threadId', p_thread_id,
    'message', to_jsonb(message_record)
  );
  insert into public.communication_command_receipts (
    workspace_id, idempotency_key, action, thread_id, message_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'dismiss_draft', p_thread_id, p_message_id, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, occurred_at,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Communication draft dismissed',
    message_record.subject || ' · ' || trim(p_reason),
    'neutral',
    p_occurred_at,
    'communication_thread',
    p_thread_id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'unified_communication_lifecycle',
      'customer_id', message_record.customer_id,
      'thread_id', p_thread_id,
      'message_id', p_message_id,
      'event_type', 'communication_draft_dismissed',
      'reason', trim(p_reason),
      'idempotency_key', trim(p_idempotency_key)
    )
  );
  return command_result;
end;
$$;

create or replace function public.close_communication_thread(
  p_workspace_id uuid,
  p_thread_id uuid,
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
  thread_record public.communication_threads;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Communication idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Communication thread closure reason is invalid';
  end if;
  select receipt.result into previous_result
  from public.communication_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.communication_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Communication edit access denied';
  end if;

  select * into thread_record
  from public.communication_threads thread
  where thread.workspace_id = p_workspace_id
    and thread.id = p_thread_id
  for update;
  if thread_record.id is null then raise exception 'Communication thread not found'; end if;
  if thread_record.status = 'closed' then raise exception 'Communication thread is already closed'; end if;

  update public.communication_threads
  set status = 'closed',
      closed_at = p_occurred_at,
      closed_by = p_actor_user_id,
      updated_at = p_occurred_at
  where workspace_id = p_workspace_id
    and id = p_thread_id
  returning * into thread_record;

  command_result := jsonb_build_object(
    'action', 'close_thread',
    'reason', trim(p_reason),
    'thread', to_jsonb(thread_record)
  );
  insert into public.communication_command_receipts (
    workspace_id, idempotency_key, action, thread_id, message_id, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'close_thread', p_thread_id, null, command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, occurred_at,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Communication thread closed',
    thread_record.subject || ' · ' || trim(p_reason),
    'neutral',
    p_occurred_at,
    'communication_thread',
    p_thread_id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'unified_communication_lifecycle',
      'customer_id', thread_record.customer_id,
      'thread_id', p_thread_id,
      'event_type', 'communication_thread_closed',
      'reason', trim(p_reason),
      'idempotency_key', trim(p_idempotency_key)
    )
  );
  return command_result;
end;
$$;

revoke all on function private.communication_target_exists(uuid, uuid) from public, anon, authenticated;
revoke all on function private.communication_actor_can_write(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_communication_message(uuid, uuid, uuid, uuid, text, text, text, text, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_communication_message_read(uuid, uuid, uuid, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.dismiss_communication_draft(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.close_communication_thread(uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function private.communication_target_exists(uuid, uuid) to service_role;
grant execute on function private.communication_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.record_communication_message(uuid, uuid, uuid, uuid, text, text, text, text, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.mark_communication_message_read(uuid, uuid, uuid, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.dismiss_communication_draft(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.close_communication_thread(uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;

commit;
