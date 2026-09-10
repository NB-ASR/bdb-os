begin;

create table public.founder_development_workspaces (
  target_workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 8 and 500),
  enabled_at timestamptz not null default now()
);

alter table public.founder_development_workspaces enable row level security;
revoke all on table public.founder_development_workspaces from public, anon, authenticated;
grant select, insert, update, delete on table public.founder_development_workspaces to service_role;

comment on table public.founder_development_workspaces is
  'Founder-controlled allowlist for non-customer workspaces that may use destructive development reset tools.';

create table public.founder_development_snapshots (
  id uuid primary key default gen_random_uuid(),
  target_workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('customers', 'products', 'services', 'sales', 'workspace')),
  snapshot jsonb not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  check (expires_at > created_at)
);

create index founder_development_snapshots_workspace_created_idx
  on public.founder_development_snapshots (target_workspace_id, created_at desc);

alter table public.founder_development_snapshots enable row level security;
revoke all on table public.founder_development_snapshots from public, anon, authenticated;
grant select, insert, delete on table public.founder_development_snapshots to service_role;

comment on table public.founder_development_snapshots is
  'Private, time-limited recovery snapshots created immediately before a founder development reset.';

create table public.founder_development_reset_receipts (
  target_workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (target_workspace_id, idempotency_key)
);

alter table public.founder_development_reset_receipts enable row level security;
revoke all on table public.founder_development_reset_receipts from public, anon, authenticated;
grant select, insert on table public.founder_development_reset_receipts to service_role;

create or replace function private.active_founder(target_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = target_actor_user_id
      and administrator.role = 'founder'
      and administrator.active
  );
$$;

revoke all on function private.active_founder(uuid) from public, anon, authenticated;

create or replace function private.founder_development_reset_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'accounts_command_claims','accounts_command_receipts','activity_items',
    'appointment_command_receipts','automations','bank_accounts',
    'bank_reconciliation_allocations','bank_statement_imports','bank_transactions',
    'banking_command_receipts','bookings','business_document_notes',
    'business_document_sequences','calendar_availability_command_receipts',
    'calendar_command_claims','calendar_rooms','calendar_service_eligibility_command_receipts',
    'calendar_staff_breaks','calendar_staff_leave','calendar_staff_service_eligibility',
    'calendar_staff_working_hours','communication_command_receipts','communication_threads',
    'credit_note_lines','credit_notes','customer_command_claims','customer_command_receipts',
    'customer_delete_receipts','customer_import_batches','customer_import_receipts',
    'customer_import_review_items','customer_note_command_receipts','customer_notes','customers',
    'delivery_note_lines','delivery_notes','document_command_receipts','document_links','documents',
    'inventory_command_receipts','inventory_locations','inventory_movements','invoice_lines','invoices',
    'messages','notification_deliveries','operator_approvals','operator_delivery_attempts',
    'operator_exceptions','operator_runs','operator_value_events','payment_allocations','payments',
    'product_command_receipts','product_supplier_command_receipts','product_suppliers','products',
    'sale_command_receipts','sale_draft_command_receipts','sale_drafts','sale_lines','sales',
    'service_command_receipts','services','supplier_accounts_command_receipts',
    'supplier_command_receipts','supplier_credit_allocations','supplier_document_command_receipts',
    'supplier_document_extraction_runs','supplier_document_lines','supplier_documents',
    'supplier_payables','supplier_payment_allocations','supplier_payments','suppliers'
  ]::text[];
$$;

revoke all on function private.founder_development_reset_tables() from public, anon, authenticated;

create or replace function private.founder_development_snapshot(
  target_workspace_id uuid,
  target_exported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_table text;
  table_rows jsonb;
  sections jsonb := '{}'::jsonb;
  workspace_row public.workspaces%rowtype;
begin
  select * into workspace_row
  from public.workspaces
  where id = target_workspace_id
  for share;

  if not found then raise exception 'Workspace is not available'; end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source_row) order by to_jsonb(source_row)::text), ''[]''::jsonb)
       from public.%I source_row where source_row.workspace_id = $1',
      target_table
    ) into table_rows using target_workspace_id;
    sections := sections || jsonb_build_object(target_table, table_rows);
  end loop;

  return jsonb_build_object(
    'format', 'bdb_workspace_snapshot',
    'schemaVersion', 1,
    'workspaceId', target_workspace_id,
    'exportedAt', target_exported_at,
    'workspace', jsonb_build_object('name', workspace_row.name, 'legalName', workspace_row.legal_name),
    'sections', sections,
    'storageManifest', jsonb_build_object(
      'workspaceAssets', coalesce((select jsonb_agg(jsonb_build_object('bucket','workspace-assets','path',theme.client_logo_path)) from public.workspace_themes theme where theme.workspace_id=target_workspace_id and theme.client_logo_path is not null),'[]'::jsonb),
      'workspaceDocuments', coalesce((select jsonb_agg(jsonb_build_object('bucket','workspace-documents','path',document.storage_path)) from public.documents document where document.workspace_id=target_workspace_id and document.storage_path is not null),'[]'::jsonb),
      'supplierDocuments', coalesce((select jsonb_agg(jsonb_build_object('bucket',document.file_bucket,'path',document.file_path)) from public.supplier_documents document where document.workspace_id=target_workspace_id and document.file_bucket is not null and document.file_path is not null),'[]'::jsonb)
    ),
    'exclusions', jsonb_build_array('authentication','workspace memberships','member permissions','feature entitlements','billing and subscriptions','command receipts','audit logs','device subscriptions')
  );
end;
$$;

revoke all on function private.founder_development_snapshot(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.founder_set_development_workspace(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_enabled boolean,
  target_expected_name text,
  target_reason text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_record public.workspaces%rowtype;
begin
  if not private.active_founder(target_actor_user_id) then raise exception 'Active Founder access required'; end if;
  select * into workspace_record from public.workspaces where id=target_workspace_id for update;
  if not found then raise exception 'Workspace not found'; end if;
  if workspace_record.name <> btrim(coalesce(target_expected_name,'')) then raise exception 'Workspace confirmation did not match'; end if;

  if target_enabled then
    if char_length(btrim(coalesce(target_reason,''))) < 8 then raise exception 'A development purpose is required'; end if;
    if exists (select 1 from public.contracts where workspace_id=target_workspace_id and status='active')
       or exists (select 1 from public.subscriptions where workspace_id=target_workspace_id and status in ('active','past_due'))
    then raise exception 'Commercially active workspaces cannot be marked for development resets'; end if;
    insert into public.founder_development_workspaces(target_workspace_id,enabled_by,reason,enabled_at)
    values(target_workspace_id,target_actor_user_id,btrim(target_reason),target_occurred_at)
    on conflict on constraint founder_development_workspaces_pkey
    do update set enabled_by=excluded.enabled_by,reason=excluded.reason,enabled_at=excluded.enabled_at;
  else
    delete from public.founder_development_workspaces where founder_development_workspaces.target_workspace_id=$1;
  end if;

  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata,created_at)
  values(target_workspace_id,target_actor_user_id,
    case when target_enabled then 'founder.development_workspace.enabled' else 'founder.development_workspace.disabled' end,
    'workspace',target_workspace_id::text,jsonb_build_object('reason',nullif(btrim(coalesce(target_reason,'')),'')),target_occurred_at);

  return jsonb_build_object('workspace_id',target_workspace_id,'enabled',target_enabled,'reason',nullif(btrim(coalesce(target_reason,'')),''));
end;
$$;

create or replace function public.founder_development_reset_preview(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_scope text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  affected_tables text[];
  blocker_tables text[] := array[]::text[];
  target_table text;
  blocker_column text;
  row_count bigint;
  affected jsonb := '{}'::jsonb;
  blockers jsonb := '{}'::jsonb;
  affected_total bigint := 0;
  blocker_total bigint := 0;
begin
  if not private.active_founder(target_actor_user_id) then raise exception 'Active Founder access required'; end if;
  if not exists(select 1 from public.founder_development_workspaces development where development.target_workspace_id=$1) then raise exception 'Workspace is not enabled for development resets'; end if;

  affected_tables := case target_scope
    when 'customers' then array['customer_import_review_items','customer_import_receipts','customer_import_batches','customer_note_command_receipts','customer_notes','customer_delete_receipts','customer_command_claims','customer_command_receipts','customers']
    when 'products' then array['product_supplier_command_receipts','product_suppliers','product_command_receipts','products']
    when 'services' then array['calendar_staff_service_eligibility','service_command_receipts','services']
    when 'sales' then array['sale_draft_command_receipts','sale_drafts','sale_command_receipts','sale_lines','sales']
    when 'workspace' then private.founder_development_reset_tables()
    else null
  end;
  if affected_tables is null then raise exception 'Unsupported development reset scope'; end if;

  blocker_tables := case target_scope
    when 'customers' then array['bookings','communication_threads','credit_notes','delivery_notes','documents','invoices','messages','payments','sale_drafts','sales']
    when 'products' then array['credit_note_lines','delivery_note_lines','inventory_movements','invoice_lines','sale_lines','supplier_document_lines']
    when 'services' then array['bookings','credit_note_lines','delivery_note_lines','invoice_lines','sale_drafts','sale_lines']
    when 'sales' then array['delivery_notes','invoices']
    else array[]::text[]
  end;

  foreach target_table in array affected_tables loop
    execute format('select count(*) from public.%I where workspace_id=$1',target_table) into row_count using target_workspace_id;
    if row_count > 0 then affected := affected || jsonb_build_object(target_table,row_count); affected_total := affected_total + row_count; end if;
  end loop;
  foreach target_table in array blocker_tables loop
    blocker_column := case
      when target_scope='customers' then 'customer_id'
      when target_scope='products' and target_table='supplier_document_lines' then 'matched_product_id'
      when target_scope='products' then 'product_id'
      when target_scope='services' then 'service_id'
      when target_scope='sales' then 'source_sale_id'
      else null
    end;
    execute format('select count(*) from public.%I where workspace_id=$1 and %I is not null',target_table,blocker_column) into row_count using target_workspace_id;
    if row_count > 0 then blockers := blockers || jsonb_build_object(target_table,row_count); blocker_total := blocker_total + row_count; end if;
  end loop;

  return jsonb_build_object('workspace_id',target_workspace_id,'scope',target_scope,'can_reset',blocker_total=0,'affected_total',affected_total,'affected_counts',affected,'blocker_total',blocker_total,'blocker_counts',blockers);
end;
$$;

create or replace function public.founder_reset_development_workspace(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_scope text,
  target_expected_name text,
  target_idempotency_key text,
  target_request_hash text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_record public.workspaces%rowtype;
  existing_receipt public.founder_development_reset_receipts%rowtype;
  preview jsonb;
  snapshot_payload jsonb;
  snapshot_checksum text;
  snapshot_id uuid;
  result_payload jsonb;
  remaining_tables text[];
  selected_table text;
  deleted_count bigint;
  deleted_counts jsonb := '{}'::jsonb;
begin
  if not private.active_founder(target_actor_user_id) then raise exception 'Active Founder access required'; end if;
  if target_scope not in ('customers','products','services','sales','workspace') then raise exception 'Unsupported development reset scope'; end if;
  if char_length(btrim(coalesce(target_idempotency_key,''))) < 8 or char_length(target_idempotency_key)>128 or target_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'Valid retry identity required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));
  select * into existing_receipt from public.founder_development_reset_receipts receipt where receipt.target_workspace_id=$1 and receipt.idempotency_key=$5;
  if found then
    if existing_receipt.request_hash <> target_request_hash then raise exception 'Retry identity was reused for another reset'; end if;
    return existing_receipt.result;
  end if;

  select * into workspace_record from public.workspaces where id=target_workspace_id for update;
  if not found then raise exception 'Workspace not found'; end if;
  if workspace_record.name <> btrim(coalesce(target_expected_name,'')) then raise exception 'Workspace confirmation did not match'; end if;
  if not exists(select 1 from public.founder_development_workspaces development where development.target_workspace_id=$1) then raise exception 'Workspace is not enabled for development resets'; end if;

  preview := public.founder_development_reset_preview(target_workspace_id,target_actor_user_id,target_scope);
  if not coalesce((preview->>'can_reset')::boolean,false) then raise exception 'Reset is blocked by dependent records'; end if;

  snapshot_payload := private.founder_development_snapshot(target_workspace_id,target_occurred_at);
  snapshot_checksum := encode(extensions.digest(snapshot_payload::text,'sha256'),'hex');
  delete from public.founder_development_snapshots where expires_at <= target_occurred_at;
  insert into public.founder_development_snapshots(target_workspace_id,scope,snapshot,checksum,created_by,created_at)
  values(target_workspace_id,target_scope,snapshot_payload,snapshot_checksum,target_actor_user_id,target_occurred_at)
  returning id into snapshot_id;

  if target_scope='customers' then
    delete from public.customer_import_review_items where workspace_id=target_workspace_id;
    delete from public.customer_import_receipts where workspace_id=target_workspace_id;
    delete from public.customer_import_batches where workspace_id=target_workspace_id;
    delete from public.customer_note_command_receipts where workspace_id=target_workspace_id;
    delete from public.customer_notes where workspace_id=target_workspace_id;
    delete from public.customer_delete_receipts where workspace_id=target_workspace_id;
    delete from public.customer_command_claims where workspace_id=target_workspace_id;
    delete from public.customer_command_receipts where workspace_id=target_workspace_id;
    delete from public.customers where workspace_id=target_workspace_id;
  elsif target_scope='products' then
    delete from public.product_supplier_command_receipts where workspace_id=target_workspace_id;
    delete from public.product_suppliers where workspace_id=target_workspace_id;
    delete from public.product_command_receipts where workspace_id=target_workspace_id;
    delete from public.products where workspace_id=target_workspace_id;
  elsif target_scope='services' then
    delete from public.calendar_staff_service_eligibility where workspace_id=target_workspace_id;
    delete from public.service_command_receipts where workspace_id=target_workspace_id;
    delete from public.services where workspace_id=target_workspace_id;
  elsif target_scope='sales' then
    delete from public.sale_draft_command_receipts where workspace_id=target_workspace_id;
    delete from public.sale_drafts where workspace_id=target_workspace_id;
    delete from public.sale_command_receipts where workspace_id=target_workspace_id;
    delete from public.sale_lines where workspace_id=target_workspace_id;
    delete from public.sales where workspace_id=target_workspace_id;
  else
    remaining_tables := private.founder_development_reset_tables();
    while cardinality(remaining_tables) > 0 loop
      select candidate into selected_table
      from unnest(remaining_tables) candidate
      where not exists (
        select 1 from pg_catalog.pg_constraint dependency
        where dependency.contype='f'
          and dependency.confrelid=to_regclass('public.'||candidate)
          and dependency.conrelid = any(select to_regclass('public.'||child_name) from unnest(remaining_tables) child_name)
          and dependency.confrelid <> dependency.conrelid
      )
      order by candidate limit 1;
      if selected_table is null then raise exception 'Development reset dependency graph contains a cycle'; end if;
      execute format('delete from public.%I where workspace_id=$1',selected_table) using target_workspace_id;
      get diagnostics deleted_count = row_count;
      if deleted_count > 0 then deleted_counts := deleted_counts || jsonb_build_object(selected_table,deleted_count); end if;
      remaining_tables := array_remove(remaining_tables,selected_table);
    end loop;
  end if;

  if target_scope <> 'workspace' then deleted_counts := coalesce(preview->'affected_counts','{}'::jsonb); end if;
  result_payload := jsonb_build_object('workspace_id',target_workspace_id,'scope',target_scope,'snapshot_id',snapshot_id,'snapshot_checksum',snapshot_checksum,'deleted_counts',deleted_counts,'reset_at',target_occurred_at);

  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata,created_at)
  values(target_workspace_id,target_actor_user_id,'founder.development_workspace.reset','workspace',target_workspace_id::text,result_payload,target_occurred_at);
  insert into public.founder_development_reset_receipts(target_workspace_id,idempotency_key,request_hash,result,created_at)
  values(target_workspace_id,target_idempotency_key,target_request_hash,result_payload,target_occurred_at);
  return result_payload;
end;
$$;

revoke all on function public.founder_set_development_workspace(uuid,uuid,boolean,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.founder_set_development_workspace(uuid,uuid,boolean,text,text,timestamptz) to service_role;
revoke all on function public.founder_development_reset_preview(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.founder_development_reset_preview(uuid,uuid,text) to service_role;
revoke all on function public.founder_reset_development_workspace(uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.founder_reset_development_workspace(uuid,uuid,text,text,text,text,timestamptz) to service_role;

comment on function public.founder_reset_development_workspace(uuid,uuid,text,text,text,text,timestamptz) is
  'Founder-only, idempotent reset for explicitly designated development workspaces. Creates a private recovery snapshot before deleting any scoped records.';

commit;
