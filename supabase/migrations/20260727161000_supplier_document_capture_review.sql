begin;

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'workspace-documents';

create table public.supplier_documents (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid,
  document_type text not null default 'other' check (document_type in ('invoice', 'credit_note', 'other')),
  document_number text check (document_number is null or char_length(document_number) <= 120),
  document_date date,
  due_date date,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_before_discount numeric(14,2),
  discount_amount numeric(14,2),
  net_after_discount numeric(14,2),
  vat_rate numeric(7,4),
  vat_amount numeric(14,2),
  gross_amount numeric(14,2),
  extracted_supplier_text text check (extracted_supplier_text is null or char_length(extracted_supplier_text) <= 240),
  file_bucket text not null default 'workspace-documents' check (file_bucket = 'workspace-documents'),
  file_path text not null check (file_path like workspace_id::text || '/%'),
  file_name text not null check (char_length(file_name) between 1 and 240),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  file_size bigint not null check (file_size between 1 and 20971520),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploaded' check (status in ('uploaded', 'extracting', 'review_required', 'approved', 'extraction_failed', 'archived')),
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extraction_confidence numeric(6,5) check (extraction_confidence is null or extraction_confidence between 0 and 1),
  extraction_notes text[] not null default '{}'::text[],
  inventory_posting_status text not null default 'not_available' check (inventory_posting_status = 'not_available'),
  accounts_posting_status text not null default 'not_available' check (accounts_posting_status = 'not_available'),
  version integer not null default 1 check (version > 0),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, file_path),
  foreign key (workspace_id, supplier_id)
    references public.suppliers(workspace_id, id)
);

create unique index supplier_documents_workspace_hash_idx
  on public.supplier_documents(workspace_id, file_sha256)
  where status <> 'archived';

create unique index supplier_documents_workspace_number_idx
  on public.supplier_documents(workspace_id, supplier_id, document_type, lower(document_number))
  where supplier_id is not null and document_number is not null and status <> 'archived';

create index supplier_documents_workspace_status_date_idx
  on public.supplier_documents(workspace_id, status, document_date desc, created_at desc);

create table public.supplier_document_lines (
  id uuid primary key,
  workspace_id uuid not null,
  document_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_kind text not null default 'product' check (line_kind in ('product', 'expense')),
  printed_description text not null check (char_length(printed_description) between 1 and 500),
  supplier_sku text check (supplier_sku is null or char_length(supplier_sku) <= 120),
  barcode text check (barcode is null or char_length(barcode) <= 120),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  rrp numeric(14,4) check (rrp is null or rrp >= 0),
  matched_product_id uuid,
  matched_product_supplier_id uuid,
  match_method text not null default 'none' check (match_method in ('supplier_sku', 'barcode', 'sku', 'manual', 'none')),
  match_confidence numeric(6,5) check (match_confidence is null or match_confidence between 0 and 1),
  review_status text not null default 'needs_review' check (review_status in ('needs_review', 'matched', 'non_stock')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, document_id, line_number),
  unique (workspace_id, id),
  foreign key (workspace_id, document_id)
    references public.supplier_documents(workspace_id, id) on delete cascade,
  foreign key (workspace_id, matched_product_id)
    references public.products(workspace_id, id),
  foreign key (workspace_id, matched_product_supplier_id)
    references public.product_suppliers(workspace_id, id)
);

create index supplier_document_lines_document_idx
  on public.supplier_document_lines(workspace_id, document_id, line_number);

create table public.supplier_document_extraction_runs (
  id uuid primary key,
  workspace_id uuid not null,
  document_id uuid not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  provider text not null default 'openai',
  model text,
  schema_version text not null default 'supplier-document-v1',
  raw_output jsonb,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  warnings text[] not null default '{}'::text[],
  error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, document_id)
    references public.supplier_documents(workspace_id, id) on delete cascade
);

create index supplier_document_extraction_runs_document_idx
  on public.supplier_document_extraction_runs(workspace_id, document_id, started_at desc);

create table public.supplier_document_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  document_id uuid not null,
  action text not null check (action in ('upload', 'save_review', 'approve')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, document_id)
    references public.supplier_documents(workspace_id, id) on delete cascade
);

create index supplier_document_command_receipts_document_idx
  on public.supplier_document_command_receipts(workspace_id, document_id, created_at desc);

drop trigger if exists supplier_documents_touch_updated_at on public.supplier_documents;
create trigger supplier_documents_touch_updated_at
before update on public.supplier_documents
for each row execute function private.touch_updated_at();

drop trigger if exists supplier_document_lines_touch_updated_at on public.supplier_document_lines;
create trigger supplier_document_lines_touch_updated_at
before update on public.supplier_document_lines
for each row execute function private.touch_updated_at();

create or replace function private.supplier_document_actor_can_write(
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
  with membership as (
    select m.access_profile
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = target_workspace_id
      and m.user_id = target_actor_user_id
      and m.status = 'active'
      and w.status in ('trial', 'active')
      and p.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'purchasing'
    limit 1
  )
  select not exists (
      select 1
      from public.platform_support_sessions support_session
      where support_session.admin_user_id = target_actor_user_id
        and support_session.workspace_id = target_workspace_id
        and support_session.ended_at is null
        and support_session.expires_at > now()
    )
    and private.has_feature(target_workspace_id, 'purchasing')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        else false
      end
      when (select access_profile from membership) in ('manager', 'employee')
        then target_action in ('create', 'edit')
      else false
    end;
$$;

create or replace function public.apply_supplier_document_upload(
  p_workspace_id uuid,
  p_document_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_file_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_file_sha256 text,
  p_currency text default 'EUR'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  previous_result jsonb;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Supplier document write access denied';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Supplier document idempotency key is invalid';
  end if;
  if p_file_path is null or p_file_path not like p_workspace_id::text || '/purchasing/%' then
    raise exception 'Supplier document storage path is invalid';
  end if;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 240 then
    raise exception 'Supplier document file name is invalid';
  end if;
  if p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Supplier document file type is invalid';
  end if;
  if p_file_size is null or p_file_size < 1 or p_file_size > 20971520 then
    raise exception 'Supplier document file size is invalid';
  end if;
  if p_file_sha256 is null or lower(p_file_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception 'Supplier document file hash is invalid';
  end if;
  if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Supplier document currency is invalid';
  end if;

  insert into public.supplier_documents (
    id, workspace_id, file_path, file_name, mime_type, file_size, file_sha256,
    currency, created_by, updated_by
  ) values (
    p_document_id, p_workspace_id, p_file_path, trim(p_file_name), p_mime_type,
    p_file_size, lower(p_file_sha256), upper(trim(p_currency)), p_actor_user_id, p_actor_user_id
  ) returning * into document_record;

  command_result := jsonb_build_object('action', 'upload', 'document', to_jsonb(document_record));

  insert into public.supplier_document_command_receipts (
    workspace_id, idempotency_key, document_id, action, result
  ) values (p_workspace_id, trim(p_idempotency_key), document_record.id, 'upload', command_result);

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier document uploaded',
    document_record.file_name, 'blue', 'supplier_document', document_record.id,
    p_command_id, jsonb_build_object('status', document_record.status, 'sha256', document_record.file_sha256)
  );

  return command_result;
end;
$$;

create or replace function public.begin_supplier_document_extraction(
  p_workspace_id uuid,
  p_document_id uuid,
  p_run_id uuid,
  p_actor_user_id uuid,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
begin
  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Supplier document write access denied';
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;

  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status in ('approved', 'archived') then
    raise exception 'Approved or archived supplier documents cannot be extracted';
  end if;

  insert into public.supplier_document_extraction_runs (
    id, workspace_id, document_id, status, model, requested_by
  ) values (
    p_run_id, p_workspace_id, p_document_id, 'processing', nullif(trim(p_model), ''), p_actor_user_id
  );

  update public.supplier_documents
  set status = 'extracting', extraction_status = 'processing', updated_by = p_actor_user_id, version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  return jsonb_build_object('document', to_jsonb(document_record), 'runId', p_run_id);
end;
$$;

create or replace function public.complete_supplier_document_extraction(
  p_workspace_id uuid,
  p_document_id uuid,
  p_run_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_model text,
  p_schema_version text,
  p_output jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  matched_supplier_id uuid;
  line_item jsonb;
  line_index integer := 0;
  matched_product_id uuid;
  matched_relationship_id uuid;
  match_method_value text;
  confidence_value numeric;
  extracted_type text;
  extracted_date date;
  notes_value text[];
  supplier_text text;
begin
  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Supplier document write access denied';
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;

  if not exists (
    select 1 from public.supplier_document_extraction_runs run
    where run.workspace_id = p_workspace_id and run.id = p_run_id
      and run.document_id = p_document_id and run.status = 'processing'
  ) then raise exception 'Supplier document extraction run not found'; end if;

  supplier_text := nullif(trim(p_output->>'supplier'), '');
  if supplier_text is not null then
    select supplier.id into matched_supplier_id
    from public.suppliers supplier
    where supplier.workspace_id = p_workspace_id
      and supplier.status = 'active'
      and (lower(supplier.name) = lower(supplier_text) or lower(supplier.code::text) = lower(supplier_text))
    order by case when lower(supplier.name) = lower(supplier_text) then 0 else 1 end
    limit 1;
  end if;

  extracted_type := case p_output->>'document_type'
    when 'Invoice' then 'invoice'
    when 'Credit Note' then 'credit_note'
    else 'other'
  end;
  extracted_date := case
    when coalesce(p_output->>'document_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_output->>'document_date')::date
    else null
  end;
  confidence_value := case
    when jsonb_typeof(p_output->'confidence') = 'number' then (p_output->>'confidence')::numeric
    else null
  end;
  select coalesce(array_agg(value), '{}'::text[]) into notes_value
  from jsonb_array_elements_text(coalesce(p_output->'notes', '[]'::jsonb)) value;

  update public.supplier_documents
  set supplier_id = matched_supplier_id,
      document_type = extracted_type,
      document_number = nullif(trim(p_output->>'document_number'), ''),
      document_date = extracted_date,
      extracted_supplier_text = supplier_text,
      subtotal_before_discount = nullif(p_output->>'subtotal_before_discount', '')::numeric,
      discount_amount = nullif(p_output->>'discount_amount', '')::numeric,
      net_after_discount = nullif(p_output->>'net_after_discount', '')::numeric,
      vat_rate = nullif(p_output->>'vat_rate', '')::numeric,
      vat_amount = nullif(p_output->>'vat_amount', '')::numeric,
      gross_amount = nullif(p_output->>'gross_amount', '')::numeric,
      status = 'review_required',
      extraction_status = 'completed',
      extraction_confidence = confidence_value,
      extraction_notes = notes_value,
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  delete from public.supplier_document_lines
  where workspace_id = p_workspace_id and document_id = p_document_id;

  for line_item in select value from jsonb_array_elements(coalesce(p_output->'items', '[]'::jsonb)) value
  loop
    line_index := line_index + 1;
    matched_product_id := null;
    matched_relationship_id := null;
    match_method_value := 'none';

    if matched_supplier_id is not null and nullif(trim(line_item->>'sku'), '') is not null then
      select relationship.id, relationship.product_id
      into matched_relationship_id, matched_product_id
      from public.product_suppliers relationship
      where relationship.workspace_id = p_workspace_id
        and relationship.supplier_id = matched_supplier_id
        and relationship.status = 'active'
        and relationship.supplier_sku is not null
        and lower(relationship.supplier_sku::text) = lower(trim(line_item->>'sku'))
      limit 1;
      if matched_product_id is not null then match_method_value := 'supplier_sku'; end if;
    end if;

    if matched_product_id is null and nullif(trim(line_item->>'barcode'), '') is not null then
      select product.id into matched_product_id
      from public.products product
      where product.workspace_id = p_workspace_id
        and product.status = 'active'
        and product.barcode is not null
        and lower(product.barcode::text) = lower(trim(line_item->>'barcode'))
      limit 1;
      if matched_product_id is not null then match_method_value := 'barcode'; end if;
    end if;

    if matched_product_id is null and nullif(trim(line_item->>'sku'), '') is not null then
      select product.id into matched_product_id
      from public.products product
      where product.workspace_id = p_workspace_id
        and product.status = 'active'
        and lower(product.sku::text) = lower(trim(line_item->>'sku'))
      limit 1;
      if matched_product_id is not null then match_method_value := 'sku'; end if;
    end if;

    insert into public.supplier_document_lines (
      id, workspace_id, document_id, line_number, printed_description,
      supplier_sku, barcode, quantity, unit_cost, rrp,
      matched_product_id, matched_product_supplier_id, match_method,
      match_confidence, review_status
    ) values (
      gen_random_uuid(), p_workspace_id, p_document_id, line_index,
      coalesce(nullif(trim(line_item->>'name'), ''), 'Unlabelled extracted line'),
      nullif(trim(line_item->>'sku'), ''), nullif(trim(line_item->>'barcode'), ''),
      greatest(coalesce(nullif(line_item->>'quantity', '')::numeric, 1), 0.0001),
      nullif(line_item->>'unit_cost', '')::numeric,
      nullif(line_item->>'rrp', '')::numeric,
      matched_product_id, matched_relationship_id, match_method_value,
      case when matched_product_id is not null then 1 else null end,
      case when matched_product_id is not null then 'matched' else 'needs_review' end
    );
  end loop;

  update public.supplier_document_extraction_runs
  set status = 'completed', provider = coalesce(nullif(trim(p_provider), ''), 'openai'),
      model = nullif(trim(p_model), ''), schema_version = coalesce(nullif(trim(p_schema_version), ''), 'supplier-document-v1'),
      raw_output = p_output, confidence = confidence_value, warnings = notes_value, completed_at = now()
  where workspace_id = p_workspace_id and id = p_run_id;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Supplier document extracted',
    coalesce(document_record.document_number, document_record.file_name), 'blue',
    'supplier_document', p_document_id, p_run_id,
    jsonb_build_object('confidence', confidence_value, 'lines', line_index, 'supplierMatched', matched_supplier_id is not null)
  );

  return jsonb_build_object('document', to_jsonb(document_record), 'lineCount', line_index, 'runId', p_run_id);
end;
$$;

create or replace function public.fail_supplier_document_extraction(
  p_workspace_id uuid,
  p_document_id uuid,
  p_run_id uuid,
  p_actor_user_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Supplier document write access denied';
  end if;
  update public.supplier_document_extraction_runs
  set status = 'failed', error_message = left(coalesce(p_error_message, 'Extraction failed'), 1000), completed_at = now()
  where workspace_id = p_workspace_id and id = p_run_id and document_id = p_document_id;
  update public.supplier_documents
  set status = 'extraction_failed', extraction_status = 'failed', updated_by = p_actor_user_id, version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id and status = 'extracting';
end;
$$;

create or replace function public.apply_supplier_document_review(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_header jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  previous_result jsonb;
  command_result jsonb;
  line_item jsonb;
  line_count integer := 0;
  supplier_uuid uuid;
  product_uuid uuid;
  relationship_uuid uuid;
  line_kind_value text;
  document_type_value text;
  document_date_value date;
  due_date_value date;
begin
  if p_action not in ('save_review', 'approve') then raise exception 'Unsupported supplier document action'; end if;
  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Supplier document write access denied';
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status in ('approved', 'archived') then raise exception 'Approved or archived supplier documents cannot be edited'; end if;
  if p_expected_version is null or p_expected_version <> document_record.version then
    raise exception 'Supplier document changed on another device; refresh before saving';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Supplier document lines are invalid'; end if;

  supplier_uuid := nullif(p_header->>'supplierId', '')::uuid;
  document_type_value := coalesce(nullif(p_header->>'documentType', ''), 'other');
  if document_type_value not in ('invoice', 'credit_note', 'other') then raise exception 'Supplier document type is invalid'; end if;
  document_date_value := case when coalesce(p_header->>'documentDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_header->>'documentDate')::date else null end;
  due_date_value := case when coalesce(p_header->>'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_header->>'dueDate')::date else null end;

  if supplier_uuid is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.workspace_id = p_workspace_id and supplier.id = supplier_uuid and supplier.status = 'active'
  ) then raise exception 'Supplier document Supplier is invalid'; end if;

  delete from public.supplier_document_lines
  where workspace_id = p_workspace_id and document_id = p_document_id;

  for line_item in select value from jsonb_array_elements(p_lines) value
  loop
    line_count := line_count + 1;
    line_kind_value := coalesce(nullif(line_item->>'lineKind', ''), 'product');
    if line_kind_value not in ('product', 'expense') then raise exception 'Supplier document line kind is invalid'; end if;
    product_uuid := nullif(line_item->>'matchedProductId', '')::uuid;
    relationship_uuid := nullif(line_item->>'matchedProductSupplierId', '')::uuid;

    if product_uuid is not null and not exists (
      select 1 from public.products product
      where product.workspace_id = p_workspace_id and product.id = product_uuid and product.status = 'active'
    ) then raise exception 'Supplier document Product match is invalid'; end if;

    if relationship_uuid is not null and not exists (
      select 1 from public.product_suppliers relationship
      where relationship.workspace_id = p_workspace_id and relationship.id = relationship_uuid
        and relationship.product_id = product_uuid and relationship.status = 'active'
        and (supplier_uuid is null or relationship.supplier_id = supplier_uuid)
    ) then raise exception 'Supplier document Product Supplier match is invalid'; end if;

    if p_action = 'approve' and line_kind_value = 'product' and product_uuid is null then
      raise exception 'Every Product line must be matched before approval';
    end if;

    insert into public.supplier_document_lines (
      id, workspace_id, document_id, line_number, line_kind, printed_description,
      supplier_sku, barcode, quantity, unit_cost, rrp, matched_product_id,
      matched_product_supplier_id, match_method, match_confidence, review_status, notes
    ) values (
      coalesce(nullif(line_item->>'id', '')::uuid, gen_random_uuid()),
      p_workspace_id, p_document_id, line_count, line_kind_value,
      coalesce(nullif(trim(line_item->>'description'), ''), 'Reviewed line'),
      nullif(trim(line_item->>'supplierSku'), ''), nullif(trim(line_item->>'barcode'), ''),
      greatest(coalesce(nullif(line_item->>'quantity', '')::numeric, 1), 0.0001),
      nullif(line_item->>'unitCost', '')::numeric, nullif(line_item->>'rrp', '')::numeric,
      case when line_kind_value = 'product' then product_uuid else null end,
      case when line_kind_value = 'product' then relationship_uuid else null end,
      case when line_kind_value = 'expense' then 'manual' when product_uuid is not null then 'manual' else 'none' end,
      case when product_uuid is not null then 1 else null end,
      case when line_kind_value = 'expense' then 'non_stock' when product_uuid is not null then 'matched' else 'needs_review' end,
      nullif(trim(line_item->>'notes'), '')
    );
  end loop;

  if p_action = 'approve' then
    if supplier_uuid is null then raise exception 'A Supplier is required before approval'; end if;
    if document_type_value not in ('invoice', 'credit_note') then raise exception 'Invoice or Credit Note type is required before approval'; end if;
    if nullif(trim(p_header->>'documentNumber'), '') is null then raise exception 'Document number is required before approval'; end if;
    if document_date_value is null then raise exception 'Document date is required before approval'; end if;
    if line_count = 0 then raise exception 'At least one reviewed line is required before approval'; end if;
  end if;

  update public.supplier_documents
  set supplier_id = supplier_uuid,
      document_type = document_type_value,
      document_number = nullif(trim(p_header->>'documentNumber'), ''),
      document_date = document_date_value,
      due_date = due_date_value,
      currency = upper(coalesce(nullif(trim(p_header->>'currency'), ''), currency)),
      subtotal_before_discount = nullif(p_header->>'subtotalBeforeDiscount', '')::numeric,
      discount_amount = nullif(p_header->>'discountAmount', '')::numeric,
      net_after_discount = nullif(p_header->>'netAfterDiscount', '')::numeric,
      vat_rate = nullif(p_header->>'vatRate', '')::numeric,
      vat_amount = nullif(p_header->>'vatAmount', '')::numeric,
      gross_amount = nullif(p_header->>'grossAmount', '')::numeric,
      status = case when p_action = 'approve' then 'approved' else 'review_required' end,
      approved_at = case when p_action = 'approve' then now() else null end,
      approved_by = case when p_action = 'approve' then p_actor_user_id else null end,
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  command_result := jsonb_build_object('action', p_action, 'document', to_jsonb(document_record), 'lineCount', line_count);
  insert into public.supplier_document_command_receipts (
    workspace_id, idempotency_key, document_id, action, result
  ) values (p_workspace_id, trim(p_idempotency_key), p_document_id, p_action, command_result);

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id,
    case when p_action = 'approve' then 'Supplier document approved' else 'Supplier document review saved' end,
    coalesce(document_record.document_number, document_record.file_name),
    case when p_action = 'approve' then 'green' else 'blue' end,
    'supplier_document', p_document_id, p_command_id,
    jsonb_build_object('status', document_record.status, 'lines', line_count,
      'inventoryPosting', document_record.inventory_posting_status,
      'accountsPosting', document_record.accounts_posting_status)
  );

  return command_result;
end;
$$;

alter table public.supplier_documents enable row level security;
alter table public.supplier_document_lines enable row level security;
alter table public.supplier_document_extraction_runs enable row level security;
alter table public.supplier_document_command_receipts enable row level security;

create policy "Supplier documents permission read"
on public.supplier_documents for select to authenticated
using (private.has_workspace_permission(workspace_id, 'purchasing', 'view'));

create policy "Supplier document lines permission read"
on public.supplier_document_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'purchasing', 'view'));

revoke all on public.supplier_documents from anon, authenticated;
revoke all on public.supplier_document_lines from anon, authenticated;
revoke all on public.supplier_document_extraction_runs from anon, authenticated;
revoke all on public.supplier_document_command_receipts from anon, authenticated;
grant select on public.supplier_documents to authenticated;
grant select on public.supplier_document_lines to authenticated;

revoke all on function private.supplier_document_actor_can_write(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_supplier_document_upload(uuid, uuid, text, uuid, uuid, text, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.begin_supplier_document_extraction(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_supplier_document_extraction(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_supplier_document_extraction(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_supplier_document_review(uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.supplier_document_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_supplier_document_upload(uuid, uuid, text, uuid, uuid, text, text, text, bigint, text, text) to service_role;
grant execute on function public.begin_supplier_document_extraction(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_supplier_document_extraction(uuid, uuid, uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.fail_supplier_document_extraction(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.apply_supplier_document_review(uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb) to service_role;

commit;
