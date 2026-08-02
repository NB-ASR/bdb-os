begin;

create or replace function public.update_workspace_configuration(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_business_name text,
  target_legal_name text,
  target_owner_name text,
  target_email text,
  target_phone text,
  target_currency text,
  target_invoice_prefix text,
  target_vat_rate numeric,
  target_timezone text,
  target_theme jsonb,
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
  normalized_business_name text := btrim(coalesce(target_business_name, ''));
  normalized_legal_name text := nullif(btrim(coalesce(target_legal_name, '')), '');
  normalized_owner_name text := btrim(coalesce(target_owner_name, ''));
  normalized_email text := nullif(lower(btrim(coalesce(target_email, ''))), '');
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_currency text := upper(btrim(coalesce(target_currency, '')));
  normalized_invoice_prefix text := upper(btrim(coalesce(target_invoice_prefix, '')));
  normalized_timezone text := btrim(coalesce(target_timezone, ''));
  normalized_theme jsonb := coalesce(target_theme, '{}'::jsonb);
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace settings management is not permitted';
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
    if existing_receipt.action <> 'update_configuration'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with different settings input';
    end if;
    return existing_receipt.result;
  end if;

  if length(normalized_business_name) not between 2 and 120 then
    raise exception 'Business name must contain between 2 and 120 characters';
  end if;
  if normalized_legal_name is not null and length(normalized_legal_name) > 160 then
    raise exception 'Legal name is too long';
  end if;
  if length(normalized_owner_name) not between 2 and 120 then
    raise exception 'Owner name must contain between 2 and 120 characters';
  end if;
  if normalized_email is not null
    and normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Business email is invalid';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be an ISO three-letter code';
  end if;
  if normalized_invoice_prefix !~ '^[A-Z0-9-]{1,8}$' then
    raise exception 'Invoice prefix must use 1 to 8 letters, numbers or hyphens';
  end if;
  if target_vat_rate is null or target_vat_rate < 0 or target_vat_rate > 100 then
    raise exception 'VAT rate must be between 0 and 100';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = normalized_timezone
  ) then
    raise exception 'Timezone is invalid';
  end if;
  if coalesce(normalized_theme->>'preset', '') not in (
    'obsidian-gold', 'ocean', 'forest', 'clay', 'slate', 'custom'
  ) then
    raise exception 'Theme preset is invalid';
  end if;
  if coalesce(normalized_theme->>'mode', '') not in ('dark', 'light', 'system') then
    raise exception 'Theme mode is invalid';
  end if;
  if coalesce(normalized_theme->>'accentColor', '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Accent colour is invalid';
  end if;
  if coalesce(normalized_theme->>'fontFamily', '') not in ('manrope', 'dm-sans', 'system') then
    raise exception 'Font family is invalid';
  end if;
  if coalesce(normalized_theme->>'density', '') not in ('compact', 'comfortable', 'spacious') then
    raise exception 'Interface density is invalid';
  end if;
  if coalesce((normalized_theme->>'textScale')::numeric, 0) < 0.9
    or coalesce((normalized_theme->>'textScale')::numeric, 0) > 1.2
  then
    raise exception 'Text scale is invalid';
  end if;

  update public.workspaces
  set
    name = normalized_business_name,
    legal_name = normalized_legal_name,
    updated_at = target_occurred_at
  where id = target_workspace_id;

  insert into public.workspace_settings (
    workspace_id,
    owner_name,
    email,
    phone,
    currency,
    invoice_prefix,
    vat_rate,
    timezone,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    normalized_owner_name,
    normalized_email,
    normalized_phone,
    normalized_currency,
    normalized_invoice_prefix,
    target_vat_rate,
    normalized_timezone,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    owner_name = excluded.owner_name,
    email = excluded.email,
    phone = excluded.phone,
    currency = excluded.currency,
    invoice_prefix = excluded.invoice_prefix,
    vat_rate = excluded.vat_rate,
    timezone = excluded.timezone,
    updated_at = excluded.updated_at;

  insert into public.workspace_themes (
    workspace_id,
    preset,
    mode,
    accent_color,
    font_family,
    text_scale,
    density,
    high_contrast,
    reduced_motion,
    client_logo_path,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    normalized_theme->>'preset',
    normalized_theme->>'mode',
    normalized_theme->>'accentColor',
    normalized_theme->>'fontFamily',
    (normalized_theme->>'textScale')::numeric,
    normalized_theme->>'density',
    coalesce((normalized_theme->>'highContrast')::boolean, false),
    coalesce((normalized_theme->>'reducedMotion')::boolean, false),
    (
      select client_logo_path
      from public.workspace_themes
      where workspace_id = target_workspace_id
    ),
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    preset = excluded.preset,
    mode = excluded.mode,
    accent_color = excluded.accent_color,
    font_family = excluded.font_family,
    text_scale = excluded.text_scale,
    density = excluded.density,
    high_contrast = excluded.high_contrast,
    reduced_motion = excluded.reduced_motion,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

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
    'Workspace settings updated',
    normalized_business_name,
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object('currency', normalized_currency, 'timezone', normalized_timezone)
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
    'workspace.settings_updated',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('command_id', target_command_id),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'businessName', normalized_business_name,
    'legalName', normalized_legal_name,
    'ownerName', normalized_owner_name,
    'email', normalized_email,
    'phone', normalized_phone,
    'currency', normalized_currency,
    'invoicePrefix', normalized_invoice_prefix,
    'vatRate', target_vat_rate,
    'timezone', normalized_timezone,
    'theme', normalized_theme,
    'updatedAt', target_occurred_at
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
    'update_configuration',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

create or replace function public.set_workspace_logo(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_logo_path text,
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
  previous_logo_path text;
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace appearance management is not permitted';
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
    if existing_receipt.action <> 'set_logo'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different logo';
    end if;
    return existing_receipt.result;
  end if;

  if target_logo_path !~ ('^' || target_workspace_id::text || '/branding/[a-zA-Z0-9._-]+$') then
    raise exception 'Logo path is outside the workspace branding area';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'workspace-assets'
      and name = target_logo_path
  ) then
    raise exception 'Uploaded logo object does not exist';
  end if;

  select client_logo_path
  into previous_logo_path
  from public.workspace_themes
  where workspace_id = target_workspace_id;

  insert into public.workspace_themes (
    workspace_id,
    client_logo_path,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    target_logo_path,
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    client_logo_path = excluded.client_logo_path,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace logo updated',
    target_logo_path,
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'logoPath', target_logo_path,
    'previousLogoPath', previous_logo_path,
    'updatedAt', target_occurred_at
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
    'set_logo',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

create or replace function public.export_workspace_snapshot(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_exported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_table text;
  table_rows jsonb;
  sections jsonb := '{}'::jsonb;
  workspace_row public.workspaces%rowtype;
  storage_manifest jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'recover'
  ) then
    raise exception 'Workspace export is restricted to the owner';
  end if;

  select *
  into workspace_row
  from public.workspaces
  where id = target_workspace_id
    and status in ('trial', 'active');

  if not found then
    raise exception 'Workspace is not available';
  end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source_row) order by to_jsonb(source_row)::text), ''[]''::jsonb)
       from public.%I source_row
       where source_row.workspace_id = $1',
      target_table
    )
    into table_rows
    using target_workspace_id;

    sections := sections || jsonb_build_object(target_table, table_rows);
  end loop;

  select jsonb_build_object(
    'workspaceAssets',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', 'workspace-assets', 'path', theme.client_logo_path))
      from public.workspace_themes theme
      where theme.workspace_id = target_workspace_id
        and theme.client_logo_path is not null
    ), '[]'::jsonb),
    'workspaceDocuments',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', 'workspace-documents', 'path', document.storage_path))
      from public.documents document
      where document.workspace_id = target_workspace_id
        and document.storage_path is not null
    ), '[]'::jsonb),
    'supplierDocuments',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', document.file_bucket, 'path', document.file_path))
      from public.supplier_documents document
      where document.workspace_id = target_workspace_id
        and document.file_bucket is not null
        and document.file_path is not null
    ), '[]'::jsonb)
  )
  into storage_manifest;

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
    'workspace.snapshot_exported',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('schema_version', 1),
    target_exported_at
  );

  return jsonb_build_object(
    'format', 'bdb_workspace_snapshot',
    'schemaVersion', 1,
    'workspaceId', target_workspace_id,
    'exportedAt', target_exported_at,
    'workspace', jsonb_build_object(
      'name', workspace_row.name,
      'legalName', workspace_row.legal_name
    ),
    'sections', sections,
    'storageManifest', storage_manifest,
    'exclusions', jsonb_build_array(
      'authentication',
      'workspace memberships',
      'member permissions',
      'feature entitlements',
      'billing and subscriptions',
      'support sessions',
      'command receipts',
      'audit and activity logs',
      'device subscriptions'
    )
  );
end;
$function$;

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

revoke all on function public.update_workspace_configuration(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_workspace_configuration(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, text, jsonb, uuid, timestamptz
) to service_role;

revoke all on function public.set_workspace_logo(
  uuid, uuid, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_workspace_logo(
  uuid, uuid, text, text, text, uuid, timestamptz
) to service_role;

revoke all on function public.export_workspace_snapshot(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.export_workspace_snapshot(
  uuid, uuid, timestamptz
) to service_role;

revoke all on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) to service_role;

commit;