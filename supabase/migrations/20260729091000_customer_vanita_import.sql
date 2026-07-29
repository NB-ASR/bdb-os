begin;

create or replace function public.import_vanita_customers(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_source_snapshot_id text,
  p_clients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  client jsonb;
  client_index integer := 0;
  v_received_count integer := 0;
  v_created_count integer := 0;
  v_linked_count integer := 0;
  v_skipped_count integer := 0;
  v_error_count integer := 0;
  v_exceptions jsonb := '[]'::jsonb;
  source_id text;
  source_code text;
  customer_name text;
  customer_company text;
  customer_email text;
  customer_phone text;
  customer_address text;
  customer_notes text;
  existing_customer_id uuid;
  new_customer_id uuid;
  effective_code text;
  existing_receipt_hash text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer import idempotency key is invalid';
  end if;
  if p_clients is null or jsonb_typeof(p_clients) <> 'array' then
    raise exception 'Vanita customer import must be a JSON array';
  end if;
  if jsonb_array_length(p_clients) > 5000 then
    raise exception 'Vanita customer import is limited to 5000 records per batch';
  end if;
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Customer import access denied';
  end if;

  select batch.result into previous_result
  from public.customer_import_batches batch
  where batch.workspace_id = p_workspace_id
    and batch.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  v_received_count := jsonb_array_length(p_clients);

  insert into public.customer_import_batches (
    id, workspace_id, source, source_snapshot_id, idempotency_key,
    received_count, created_by
  ) values (
    p_batch_id, p_workspace_id, 'vanita_app_state', nullif(trim(p_source_snapshot_id), ''),
    trim(p_idempotency_key), v_received_count, p_actor_user_id
  );

  for client in select value from jsonb_array_elements(p_clients)
  loop
    client_index := client_index + 1;
    begin
      if jsonb_typeof(client) <> 'object' then
        raise exception 'Record is not a JSON object';
      end if;

      existing_receipt_hash := null;
      source_code := coalesce(
        nullif(trim(client->>'code'), ''),
        nullif(trim(client->>'clientCode'), ''),
        nullif(trim(client->>'customerCode'), '')
      );
      source_id := coalesce(
        nullif(trim(client->>'id'), ''),
        nullif(trim(client->>'clientId'), ''),
        nullif(trim(client->>'customerId'), ''),
        source_code,
        'hash:' || md5(client::text)
      );
      customer_name := coalesce(
        nullif(trim(client->>'name'), ''),
        nullif(trim(client->>'fullName'), ''),
        nullif(trim(client->>'clientName'), ''),
        nullif(trim(client->>'customerName'), '')
      );
      if customer_name is null then
        raise exception 'Customer name is missing';
      end if;

      select receipt.source_hash into existing_receipt_hash
      from public.customer_import_receipts receipt
      where receipt.workspace_id = p_workspace_id
        and receipt.source = 'vanita_app_state'
        and receipt.legacy_id = source_id;

      if existing_receipt_hash is not null then
        if existing_receipt_hash <> md5(client::text) then
          v_error_count := v_error_count + 1;
          v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
            'index', client_index,
            'message', 'Previously imported legacy Customer changed in the source snapshot',
            'legacyId', source_id
          ));
        else
          v_skipped_count := v_skipped_count + 1;
        end if;
        continue;
      end if;

      customer_company := coalesce(
        nullif(trim(client->>'company'), ''),
        nullif(trim(client->>'businessName'), ''),
        ''
      );
      customer_email := nullif(trim(coalesce(client->>'email', client->>'emailAddress')), '');
      customer_phone := nullif(trim(coalesce(client->>'phone', client->>'mobile', client->>'telephone')), '');
      customer_address := nullif(trim(coalesce(client->>'address', client->>'postalAddress')), '');
      customer_notes := nullif(trim(coalesce(client->>'notes', client->>'preferences', client->>'comments')), '');
      existing_customer_id := null;

      select customer.id into existing_customer_id
      from public.customers customer
      where customer.workspace_id = p_workspace_id
        and (
          (
            customer_email is not null
            and customer.email is not null
            and lower(trim(customer.email::text)) = lower(customer_email)
          )
          or (
            customer_phone is not null
            and char_length(regexp_replace(customer_phone, '[^0-9]', '', 'g')) >= 6
            and customer.phone is not null
            and regexp_replace(customer.phone, '[^0-9]', '', 'g') = regexp_replace(customer_phone, '[^0-9]', '', 'g')
          )
        )
      order by customer.created_at
      limit 1;

      if existing_customer_id is not null then
        v_linked_count := v_linked_count + 1;
        insert into public.customer_import_receipts (
          workspace_id, source, legacy_id, customer_id, batch_id, source_hash
        ) values (
          p_workspace_id, 'vanita_app_state', source_id, existing_customer_id,
          p_batch_id, md5(client::text)
        );
        continue;
      end if;

      new_customer_id := gen_random_uuid();
      effective_code := coalesce(
        case when source_code is not null and char_length(source_code) <= 64 then source_code end,
        'CUS-' || upper(substr(replace(new_customer_id::text, '-', ''), 1, 8))
      );
      if exists (
        select 1 from public.customers
        where workspace_id = p_workspace_id and lower(trim(code)) = lower(trim(effective_code))
      ) then
        effective_code := 'CUS-' || upper(substr(replace(new_customer_id::text, '-', ''), 1, 8));
      end if;

      insert into public.customers (
        id, workspace_id, code, name, company, email, phone, address, notes,
        preferences, legacy_source, legacy_id, migration_batch_id,
        created_by, updated_by
      ) values (
        new_customer_id,
        p_workspace_id,
        effective_code,
        customer_name,
        customer_company,
        customer_email,
        customer_phone,
        customer_address,
        customer_notes,
        '{}'::jsonb,
        'vanita_app_state',
        source_id,
        p_batch_id,
        p_actor_user_id,
        p_actor_user_id
      );

      insert into public.customer_import_receipts (
        workspace_id, source, legacy_id, customer_id, batch_id, source_hash
      ) values (
        p_workspace_id, 'vanita_app_state', source_id, new_customer_id,
        p_batch_id, md5(client::text)
      );

      insert into public.activity_items (
        workspace_id, actor_user_id, action, detail, tone,
        entity_type, entity_id, command_id, metadata
      ) values (
        p_workspace_id,
        p_actor_user_id,
        'Customer imported',
        customer_name || ' · ' || effective_code,
        'blue',
        'customer',
        new_customer_id::text,
        p_command_id,
        jsonb_build_object(
          'source', 'vanita_app_state',
          'legacy_id', source_id,
          'batch_id', p_batch_id
        )
      );

      v_created_count := v_created_count + 1;
    exception when others then
      v_error_count := v_error_count + 1;
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'index', client_index,
        'message', sqlerrm
      ));
    end;
  end loop;

  command_result := jsonb_build_object(
    'batchId', p_batch_id,
    'source', 'vanita_app_state',
    'sourceSnapshotId', nullif(trim(p_source_snapshot_id), ''),
    'receivedCount', v_received_count,
    'createdCount', v_created_count,
    'linkedCount', v_linked_count,
    'skippedCount', v_skipped_count,
    'errorCount', v_error_count,
    'exceptions', v_exceptions
  );

  update public.customer_import_batches
  set status = case when v_error_count > 0 then 'completed_with_errors' else 'completed' end,
      created_count = v_created_count,
      linked_count = v_linked_count,
      skipped_count = v_skipped_count,
      error_count = v_error_count,
      exceptions = v_exceptions,
      result = command_result,
      completed_at = now()
  where workspace_id = p_workspace_id and id = p_batch_id;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Vanita customers imported',
    v_created_count || ' created · ' || v_linked_count || ' linked · ' || v_error_count || ' errors',
    case when v_error_count > 0 then 'gold' else 'green' end,
    'customer_import_batch',
    p_batch_id::text,
    p_command_id,
    command_result
  );

  return command_result;
end;
$$;

revoke all on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) to service_role;

revoke all on table public.customers from anon, authenticated;
grant select on table public.customers to authenticated;
grant select, insert, update, delete on table public.customers to service_role;

revoke all on table public.customer_command_receipts, public.customer_import_batches, public.customer_import_receipts from anon, authenticated;
grant select, insert, update, delete on table public.customer_command_receipts, public.customer_import_batches, public.customer_import_receipts to service_role;

alter table public.customers enable row level security;
alter table public.customer_command_receipts enable row level security;
alter table public.customer_import_batches enable row level security;
alter table public.customer_import_receipts enable row level security;

drop policy if exists "Customers permission read" on public.customers;
drop policy if exists "Customers permission insert" on public.customers;
drop policy if exists "Customers permission update" on public.customers;
drop policy if exists "Customers permission delete" on public.customers;

create policy "Customers permission read"
on public.customers for select to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'view'));

comment on table public.customers is
  'Canonical workspace-owned Customer records linked by Sales, Appointments, invoices, Documents and Communications.';
comment on column public.customers.version is
  'Optimistic concurrency version used to reject stale offline edits.';
comment on column public.customers.legacy_id is
  'Original source identifier retained for repeatable Vanita migration and traceability.';
comment on table public.customer_command_receipts is
  'Workspace-scoped idempotency receipts for trusted Customer lifecycle commands.';
comment on table public.customer_import_batches is
  'Auditable Vanita Customer import batches with reconciliation counts and exceptions.';
comment on table public.customer_import_receipts is
  'Per-source Customer migration receipts preventing duplicate imports on retry.';

commit;
