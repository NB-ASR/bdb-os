begin;

create or replace function public.restore_workspace_snapshot(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_snapshot jsonb,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  allowed_tables text[] := private.workspace_restorable_tables();
  target_table text;
  section_rows jsonb;
  sanitized_rows jsonb;
  row_count bigint;
  restored_counts jsonb := '{}'::jsonb;
  extra_section text;
  missing_object jsonb;
  snapshot_workspace jsonb := coalesce(target_snapshot->'workspace', '{}'::jsonb);
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'recover'
  ) then
    raise exception 'Workspace restore is restricted to the owner';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'restore_snapshot'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different snapshot';
    end if;
    return existing_receipt.result;
  end if;

  if coalesce(target_snapshot->>'format', '') <> 'bdb_workspace_snapshot'
    or coalesce((target_snapshot->>'schemaVersion')::integer, 0) <> 1
    or coalesce(target_snapshot->>'workspaceId', '') <> target_workspace_id::text
    or jsonb_typeof(target_snapshot->'sections') <> 'object'
  then
    raise exception 'Snapshot format, version or workspace identity is invalid';
  end if;

  select section_name
  into extra_section
  from jsonb_object_keys(target_snapshot->'sections') as section_name
  where not (section_name = any(allowed_tables))
  limit 1;

  if extra_section is not null then
    raise exception 'Snapshot contains unsupported section: %', extra_section;
  end if;

  if private.workspace_restorable_record_count(
    target_workspace_id,
    target_actor_user_id
  ) > 0 then
    raise exception 'Workspace restore requires an empty operational workspace';
  end if;

  select object_row
  into missing_object
  from (
    select value as object_row
    from jsonb_array_elements(
      coalesce(target_snapshot->'storageManifest'->'workspaceAssets', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'workspaceDocuments', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'supplierDocuments', '[]'::jsonb)
    )
  ) objects
  where not exists (
    select 1
    from storage.objects stored
    where stored.bucket_id = object_row->>'bucket'
      and stored.name = object_row->>'path'
  )
  limit 1;

  if missing_object is not null then
    raise exception 'Snapshot references a missing storage object: %/%',
      missing_object->>'bucket',
      missing_object->>'path';
  end if;

  delete from public.workspace_settings where workspace_id = target_workspace_id;
  delete from public.workspace_themes where workspace_id = target_workspace_id;
  delete from public.workspace_operational_settings where workspace_id = target_workspace_id;

  update public.workspaces
  set
    name = coalesce(nullif(btrim(snapshot_workspace->>'name'), ''), name),
    legal_name = nullif(btrim(coalesce(snapshot_workspace->>'legalName', '')), ''),
    updated_at = target_occurred_at
  where id = target_workspace_id;

  foreach target_table in array allowed_tables
  loop
    section_rows := coalesce(target_snapshot->'sections'->target_table, '[]'::jsonb);
    if jsonb_typeof(section_rows) <> 'array' then
      raise exception 'Snapshot section % is not an array', target_table;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_set(section_row, '{workspace_id}', to_jsonb(target_workspace_id), true)
      ),
      '[]'::jsonb
    )
    into sanitized_rows
    from jsonb_array_elements(section_rows) section_row;

    row_count := jsonb_array_length(sanitized_rows);
    if row_count > 0 then
      execute format(
        'insert into public.%I
         select * from jsonb_populate_recordset(null::public.%I, $1)',
        target_table,
        target_table
      )
      using sanitized_rows;
    end if;

    restored_counts := restored_counts || jsonb_build_object(target_table, row_count);
  end loop;

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
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace snapshot restored',
    'Structured business data restored from a verified workspace snapshot',
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object('schema_version', 1, 'restored_counts', restored_counts)
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.snapshot_restored',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object(
      'command_id', target_command_id,
      'schema_version', 1,
      'restored_counts', restored_counts
    ),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'schemaVersion', 1,
    'restoredCounts', restored_counts,
    'restoredAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'restore_snapshot',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

revoke all on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) to service_role;

commit;
