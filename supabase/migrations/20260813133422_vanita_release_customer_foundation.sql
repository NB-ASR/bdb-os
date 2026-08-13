-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133422_vanita_release_customer_foundation.sql.
-- Sources: 20260729085000_actor_workspace_permission.sql through 20260729092000_customer_reference_indexes.sql.
begin;

-- Trusted server commands supply the actor explicitly, while the original
-- browser permission helper resolves auth.uid(). Keep both paths on the same
-- workspace membership and feature-entitlement model.
create or replace function private.actor_has_workspace_permission(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_feature_key text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
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
      and permission.feature_key = target_feature_key
    limit 1
  )
  select case
    when not private.has_feature(target_workspace_id, target_feature_key) then false
    when not exists (select 1 from membership) then false
    when (select access_profile from membership) = 'owner' then true
    when exists (select 1 from explicit_permission) then case target_action
      when 'view' then (select can_view from explicit_permission)
      when 'create' then (select can_create from explicit_permission)
      when 'edit' then (select can_edit from explicit_permission)
      when 'delete' then (select can_delete from explicit_permission)
      when 'approve' then (select can_approve from explicit_permission)
      when 'export' then (select can_export from explicit_permission)
      else false
    end
    when (select access_profile from membership) = 'manager'
      then target_action in ('view', 'create', 'edit', 'approve', 'export')
    when (select access_profile from membership) = 'employee'
      then target_action in ('view', 'create', 'edit')
    else false
  end;
$function$;

revoke execute on function private.actor_has_workspace_permission(uuid, uuid, text, text)
  from public, anon, authenticated;

commit;


begin;

alter table public.customers
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists version integer not null default 1,
  add column if not exists legacy_source text,
  add column if not exists legacy_id text,
  add column if not exists migration_batch_id uuid,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.customers
  drop constraint if exists customers_code_length_check,
  drop constraint if exists customers_email_length_check,
  drop constraint if exists customers_status_check,
  drop constraint if exists customers_version_check,
  drop constraint if exists customers_preferences_object_check,
  drop constraint if exists customers_name_length_check,
  drop constraint if exists customers_company_length_check,
  drop constraint if exists customers_phone_length_check,
  drop constraint if exists customers_address_length_check,
  drop constraint if exists customers_notes_length_check,
  drop constraint if exists customers_legacy_pair_check;

alter table public.customers
  add constraint customers_code_length_check check (char_length(trim(code)) between 1 and 64),
  add constraint customers_email_length_check check (email is null or char_length(trim(email::text)) <= 320),
  add constraint customers_status_check check (status in ('active', 'archived')),
  add constraint customers_version_check check (version > 0),
  add constraint customers_preferences_object_check check (jsonb_typeof(preferences) = 'object'),
  add constraint customers_name_length_check check (char_length(trim(name)) between 1 and 160),
  add constraint customers_company_length_check check (char_length(company) <= 160),
  add constraint customers_phone_length_check check (phone is null or char_length(phone) <= 50),
  add constraint customers_address_length_check check (address is null or char_length(address) <= 1000),
  add constraint customers_notes_length_check check (notes is null or char_length(notes) <= 4000),
  add constraint customers_legacy_pair_check check (
    (legacy_source is null and legacy_id is null)
    or (legacy_source is not null and legacy_id is not null)
  );

create unique index if not exists customers_workspace_code_ci_idx
  on public.customers(workspace_id, lower(trim(code)));

create unique index if not exists customers_workspace_legacy_identity_idx
  on public.customers(workspace_id, legacy_source, legacy_id)
  where legacy_source is not null and legacy_id is not null;

create index if not exists customers_workspace_status_name_idx
  on public.customers(workspace_id, status, name);

create index if not exists customers_workspace_email_lookup_idx
  on public.customers(workspace_id, lower(trim(email::text)))
  where email is not null and trim(email::text) <> '';

create index if not exists customers_workspace_phone_lookup_idx
  on public.customers(workspace_id, regexp_replace(phone, '[^0-9]', '', 'g'))
  where phone is not null and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6;

create table if not exists public.customer_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  customer_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete cascade
);

create index if not exists customer_command_receipts_customer_idx
  on public.customer_command_receipts(workspace_id, customer_id, created_at desc);

create table if not exists public.customer_import_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (char_length(trim(source)) between 1 and 64),
  source_snapshot_id text check (source_snapshot_id is null or char_length(source_snapshot_id) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  status text not null default 'processing' check (status in ('processing', 'completed', 'completed_with_errors')),
  received_count integer not null default 0 check (received_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  linked_count integer not null default 0 check (linked_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  exceptions jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  result jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id)
);

create table if not exists public.customer_import_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,
  legacy_id text not null,
  customer_id uuid not null,
  batch_id uuid not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, source, legacy_id),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, batch_id)
    references public.customer_import_batches(workspace_id, id) on delete cascade
);

create index if not exists customer_import_receipts_customer_idx
  on public.customer_import_receipts(workspace_id, customer_id, created_at desc);

create index if not exists customer_import_batches_workspace_created_idx
  on public.customer_import_batches(workspace_id, created_at desc);

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function private.touch_updated_at();

create or replace function private.customer_actor_can_write(
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
    'customers',
    target_action
  );
$$;

commit;


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
        'CUS-' || upper(right(replace(new_customer_id::text, '-', ''), 16))
      );
      if exists (
        select 1 from public.customers
        where workspace_id = p_workspace_id and lower(trim(code)) = lower(trim(effective_code))
      ) then
        effective_code := 'CUS-' || upper(right(replace(new_customer_id::text, '-', ''), 16));
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


begin;

do $$
declare
  command_definition text;
  import_definition text;
begin
  select pg_get_functiondef(
    'public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure
  ) into command_definition;

  command_definition := replace(
    command_definition,
    'upper(substr(replace(p_customer_id::text, ''-'', ''''), 1, 8))',
    'upper(right(replace(p_customer_id::text, ''-'', ''''), 16))'
  );
  execute command_definition;

  select pg_get_functiondef(
    'public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure
  ) into import_definition;

  import_definition := replace(
    import_definition,
    'upper(substr(replace(new_customer_id::text, ''-'', ''''), 1, 8))',
    'upper(right(replace(new_customer_id::text, ''-'', ''''), 16))'
  );
  execute import_definition;

  if position(
    'right(replace(p_customer_id::text' in lower(pg_get_functiondef(
      'public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure
    ))
  ) = 0 then
    raise exception 'Customer lifecycle code generation was not hardened';
  end if;

  if position(
    'right(replace(new_customer_id::text' in lower(pg_get_functiondef(
      'public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure
    ))
  ) = 0 then
    raise exception 'Customer import code generation was not hardened';
  end if;
end;
$$;

revoke all on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) to service_role;

revoke all on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) to service_role;

commit;


begin;

create index if not exists customers_created_by_idx
  on public.customers(created_by)
  where created_by is not null;

create index if not exists customers_updated_by_idx
  on public.customers(updated_by)
  where updated_by is not null;

create index if not exists customer_import_batches_created_by_idx
  on public.customer_import_batches(created_by)
  where created_by is not null;

create index if not exists customer_import_receipts_batch_idx
  on public.customer_import_receipts(workspace_id, batch_id);

commit;
