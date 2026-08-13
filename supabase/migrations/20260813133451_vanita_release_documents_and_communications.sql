-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133451_vanita_release_documents_and_communications.sql.
-- Sources: 20260801110000_general_documents_foundation.sql through 20260801133500_unified_communications_reference_indexes.sql.
begin;

alter table public.documents
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists category text not null default 'general',
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

do $$
begin
  alter table public.documents
    add constraint documents_general_status_check
    check (status in ('active', 'archived'));
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.documents
    add constraint documents_general_size_check
    check (size_bytes is null or size_bytes between 0 and 100000000);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.documents
    add constraint documents_general_archive_shape_check
    check (
      (status = 'active' and archived_at is null and archived_by is null)
      or
      (status = 'archived' and archived_at is not null)
    );
exception
  when duplicate_object then null;
end;
$$;

create unique index if not exists documents_workspace_id_id_uidx
  on public.documents(workspace_id, id);

create index if not exists documents_workspace_status_uploaded_idx
  on public.documents(workspace_id, status, uploaded_at desc);

create index if not exists documents_workspace_category_uploaded_idx
  on public.documents(workspace_id, category, uploaded_at desc);

create table if not exists public.document_links (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null,
  link_type text not null check (
    link_type in (
      'business',
      'customer',
      'appointment',
      'sale',
      'invoice',
      'customer_payment',
      'communication'
    )
  ),
  target_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  command_id uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,
  foreign key (workspace_id, document_id)
    references public.documents(workspace_id, id) on delete cascade,
  constraint document_links_target_shape_check check (
    (link_type = 'business' and target_id is null)
    or
    (link_type <> 'business' and target_id is not null)
  ),
  constraint document_links_revoke_shape_check check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or
    (
      revoked_at is not null
      and revoke_reason is not null
      and char_length(trim(revoke_reason)) between 5 and 500
    )
  )
);

create unique index if not exists document_links_active_target_uidx
  on public.document_links(workspace_id, document_id, link_type, target_id)
  where revoked_at is null and target_id is not null;

create unique index if not exists document_links_active_business_uidx
  on public.document_links(workspace_id, document_id)
  where revoked_at is null and link_type = 'business';

create index if not exists document_links_target_lookup_idx
  on public.document_links(workspace_id, link_type, target_id, created_at desc)
  where revoked_at is null;

create index if not exists document_links_document_lookup_idx
  on public.document_links(workspace_id, document_id, created_at desc);

create table if not exists public.document_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  action text not null check (
    action in ('create_document', 'add_link', 'revoke_link', 'archive_document')
  ),
  document_id uuid not null,
  link_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, document_id)
    references public.documents(workspace_id, id) on delete cascade,
  foreign key (link_id)
    references public.document_links(id) on delete set null
);

create index if not exists document_command_receipts_document_idx
  on public.document_command_receipts(workspace_id, document_id, created_at desc);

insert into public.document_links (
  id,
  workspace_id,
  document_id,
  link_type,
  target_id,
  created_at
)
select
  gen_random_uuid(),
  document.workspace_id,
  document.id,
  case when document.customer_id is null then 'business' else 'customer' end,
  document.customer_id,
  coalesce(document.uploaded_at, now())
from public.documents document
where not exists (
  select 1
  from public.document_links existing
  where existing.workspace_id = document.workspace_id
    and existing.document_id = document.id
    and existing.revoked_at is null
    and existing.link_type = case when document.customer_id is null then 'business' else 'customer' end
    and existing.target_id is not distinct from document.customer_id
);

alter table public.document_links enable row level security;
alter table public.document_command_receipts enable row level security;

drop policy if exists "Document links permission read" on public.document_links;
create policy "Document links permission read"
on public.document_links for select to authenticated
using (private.has_workspace_permission(workspace_id, 'documents', 'view'));

revoke all on public.document_links from public, anon, authenticated;
grant select on public.document_links to authenticated;

revoke all on public.document_command_receipts from public, anon, authenticated;

create or replace view public.general_document_index
with (security_invoker = true)
as
select
  document.id,
  document.workspace_id,
  document.name,
  document.original_file_name,
  document.document_type,
  document.mime_type,
  document.size_label,
  document.size_bytes,
  document.category,
  document.description,
  document.status,
  document.storage_path,
  document.uploaded_at,
  document.created_by,
  document.archived_at,
  document.archived_by,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', link.id,
        'type', link.link_type,
        'targetId', link.target_id,
        'createdAt', link.created_at
      )
      order by link.created_at, link.id
    ) filter (where link.id is not null and link.revoked_at is null),
    '[]'::jsonb
  ) as links
from public.documents document
left join public.document_links link
  on link.workspace_id = document.workspace_id
 and link.document_id = document.id
 and link.revoked_at is null
group by
  document.id,
  document.workspace_id,
  document.name,
  document.original_file_name,
  document.document_type,
  document.mime_type,
  document.size_label,
  document.size_bytes,
  document.category,
  document.description,
  document.status,
  document.storage_path,
  document.uploaded_at,
  document.created_by,
  document.archived_at,
  document.archived_by;

revoke all on public.general_document_index from public, anon;
grant select on public.general_document_index to authenticated;

comment on table public.document_links is
  'Typed, revocable links from one authoritative Document to exact cross-department records.';

comment on view public.general_document_index is
  'Security-invoker General Documents read model with active typed links; source record labels remain permission-aware API concerns.';

commit;


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


begin;

-- General Documents is now written only through the trusted command API.
drop policy if exists "Documents permission insert" on public.documents;
drop policy if exists "Documents permission update" on public.documents;
drop policy if exists "Documents permission delete" on public.documents;

revoke all on public.documents from public, anon, authenticated;
grant select on public.documents to authenticated;

revoke all on public.document_links from public, anon, authenticated;
grant select on public.document_links to authenticated;

revoke all on public.document_command_receipts from public, anon, authenticated;

revoke all on public.general_document_index from public, anon, authenticated;
grant select on public.general_document_index to authenticated;

-- File bytes follow the same trusted server boundary as Document metadata.
drop policy if exists "Members can upload workspace documents" on storage.objects;
drop policy if exists "Managers can update workspace documents" on storage.objects;
drop policy if exists "Managers can delete workspace documents" on storage.objects;

create or replace view public.customer_360_operational_summary
with (security_invoker = true)
as
with appointment_counts as (
  select booking.workspace_id,
         booking.customer_id,
         count(*)::integer as appointment_count,
         count(*) filter (where booking.status::text in ('pending', 'confirmed'))::integer as upcoming_appointment_count,
         count(*) filter (where booking.status::text = 'completed')::integer as completed_appointment_count,
         max(coalesce(booking.completed_at, booking.cancelled_at, booking.updated_at, booking.created_at)) as last_appointment_activity_at
  from public.bookings booking
  group by booking.workspace_id, booking.customer_id
), sale_counts as (
  select sale.workspace_id,
         sale.customer_id,
         count(*)::integer as sale_count,
         count(*) filter (where sale.status = 'completed')::integer as completed_sale_count,
         max(coalesce(sale.reversed_at, sale.completed_at, sale.occurred_at)) as last_sale_activity_at
  from public.sales sale
  where sale.customer_id is not null
  group by sale.workspace_id, sale.customer_id
), invoice_counts as (
  select invoice.workspace_id,
         invoice.customer_id,
         count(*)::integer as invoice_count,
         count(*) filter (where invoice.status::text not in ('draft', 'void') and invoice.outstanding_amount > 0)::integer as open_invoice_count,
         max(coalesce(invoice.voided_at, invoice.sent_at, invoice.updated_at, invoice.created_at)) as last_invoice_activity_at
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id
), payment_counts as (
  select payment.workspace_id,
         payment.customer_id,
         count(*)::integer as payment_count,
         max(coalesce(payment.reversed_at, payment.received_at, payment.created_at)) as last_payment_activity_at
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id
), document_counts as (
  select link.workspace_id,
         link.target_id as customer_id,
         count(distinct link.document_id)::integer as document_count,
         max(greatest(
           document.uploaded_at,
           link.created_at,
           coalesce(document.archived_at, '-infinity'::timestamptz)
         )) as last_document_activity_at
  from public.document_links link
  join public.documents document
    on document.workspace_id = link.workspace_id
   and document.id = link.document_id
  where link.link_type = 'customer'
    and link.target_id is not null
    and link.revoked_at is null
  group by link.workspace_id, link.target_id
), message_counts as (
  select message.workspace_id,
         message.customer_id,
         count(*)::integer as message_count,
         count(*) filter (where message.unread)::integer as unread_message_count,
         max(message.occurred_at) as last_message_activity_at
  from public.messages message
  group by message.workspace_id, message.customer_id
), note_counts as (
  select note.workspace_id,
         note.customer_id,
         count(*)::integer as note_count,
         count(*) filter (where note.status = 'active')::integer as active_note_count,
         max(coalesce(note.voided_at, note.occurred_at)) as last_note_activity_at
  from public.customer_note_status note
  group by note.workspace_id, note.customer_id
)
select customer.workspace_id,
       customer.id as customer_id,
       coalesce(appointment.appointment_count, 0) as appointment_count,
       coalesce(appointment.upcoming_appointment_count, 0) as upcoming_appointment_count,
       coalesce(appointment.completed_appointment_count, 0) as completed_appointment_count,
       coalesce(sale.sale_count, 0) as sale_count,
       coalesce(sale.completed_sale_count, 0) as completed_sale_count,
       coalesce(invoice.invoice_count, 0) as invoice_count,
       coalesce(invoice.open_invoice_count, 0) as open_invoice_count,
       coalesce(payment.payment_count, 0) as payment_count,
       coalesce(document.document_count, 0) as document_count,
       coalesce(message.message_count, 0) as message_count,
       coalesce(message.unread_message_count, 0) as unread_message_count,
       coalesce(note.note_count, 0) as note_count,
       coalesce(note.active_note_count, 0) as active_note_count,
       nullif(greatest(
         coalesce(appointment.last_appointment_activity_at, '-infinity'::timestamptz),
         coalesce(sale.last_sale_activity_at, '-infinity'::timestamptz),
         coalesce(invoice.last_invoice_activity_at, '-infinity'::timestamptz),
         coalesce(payment.last_payment_activity_at, '-infinity'::timestamptz),
         coalesce(document.last_document_activity_at, '-infinity'::timestamptz),
         coalesce(message.last_message_activity_at, '-infinity'::timestamptz),
         coalesce(note.last_note_activity_at, '-infinity'::timestamptz),
         customer.updated_at
       ), '-infinity'::timestamptz) as last_activity_at
from public.customers customer
left join appointment_counts appointment
  on appointment.workspace_id = customer.workspace_id and appointment.customer_id = customer.id
left join sale_counts sale
  on sale.workspace_id = customer.workspace_id and sale.customer_id = customer.id
left join invoice_counts invoice
  on invoice.workspace_id = customer.workspace_id and invoice.customer_id = customer.id
left join payment_counts payment
  on payment.workspace_id = customer.workspace_id and payment.customer_id = customer.id
left join document_counts document
  on document.workspace_id = customer.workspace_id and document.customer_id = customer.id
left join message_counts message
  on message.workspace_id = customer.workspace_id and message.customer_id = customer.id
left join note_counts note
  on note.workspace_id = customer.workspace_id and note.customer_id = customer.id;

create or replace view public.customer_360_activity
with (security_invoker = true)
as
select activity.workspace_id,
       customer.id as customer_id,
       'customer'::text as source_type,
       activity.id as source_id,
       'customer_lifecycle'::text as event_type,
       activity.action as title,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/customers/' || customer.id::text)::text as route,
       activity.metadata
from public.activity_items activity
join public.customers customer
  on customer.workspace_id = activity.workspace_id
 and activity.entity_type = 'customer'
 and activity.entity_id = customer.id::text
where coalesce(activity.metadata ->> 'source', '') <> 'customer_note'

union all

select note.workspace_id,
       note.customer_id,
       'customer_note'::text,
       note.id,
       case when note.note_kind = 'note' then 'note_added' else 'note_voided' end,
       case when note.note_kind = 'note' then 'Customer note added' else 'Customer note voided' end,
       coalesce(note.body, note.reason, ''),
       case when note.note_kind = 'note' then 'gold' else 'neutral' end,
       note.occurred_at,
       ('/customers/' || note.customer_id::text)::text,
       jsonb_build_object(
         'note_kind', note.note_kind,
         'parent_note_id', note.parent_note_id,
         'actor_user_id', note.actor_user_id
       )
from public.customer_notes note

union all

select booking.workspace_id,
       booking.customer_id,
       'appointment'::text,
       booking.id,
       ('appointment_' || booking.status::text)::text,
       case booking.status::text
         when 'completed' then 'Appointment completed'
         when 'cancelled' then 'Appointment cancelled'
         when 'confirmed' then 'Appointment confirmed'
         else 'Appointment scheduled'
       end,
       concat_ws(' · ', booking.reference, booking.title, booking.staff_name),
       case booking.status::text
         when 'completed' then 'green'
         when 'cancelled' then 'neutral'
         when 'confirmed' then 'blue'
         else 'gold'
       end,
       coalesce(booking.completed_at, booking.cancelled_at, booking.updated_at, booking.created_at),
       ('/calendar?appointment=' || booking.id::text)::text,
       jsonb_build_object(
         'reference', booking.reference,
         'status', booking.status::text,
         'booking_date', booking.booking_date,
         'booking_time', booking.booking_time,
         'service_id', booking.service_id,
         'staff_user_id', booking.staff_user_id
       )
from public.bookings booking

union all

select sale.workspace_id,
       sale.customer_id,
       'sale'::text,
       sale.id,
       ('sale_' || sale.status)::text,
       case when sale.status = 'reversed' then 'Sale reversed' else 'Sale completed' end,
       concat_ws(' · ', sale.reference, sale.currency || ' ' || trim(to_char(sale.total_amount, 'FM9999999990.00'))),
       case when sale.status = 'reversed' then 'neutral' else 'green' end,
       coalesce(sale.reversed_at, sale.completed_at, sale.occurred_at),
       ('/sales?customerId=' || sale.customer_id::text)::text,
       jsonb_build_object(
         'reference', sale.reference,
         'status', sale.status,
         'currency', sale.currency,
         'total_amount', sale.total_amount
       )
from public.sales sale
where sale.customer_id is not null

union all

select invoice.workspace_id,
       invoice.customer_id,
       'invoice'::text,
       invoice.id,
       ('invoice_' || invoice.display_status)::text,
       case invoice.display_status
         when 'paid' then 'Invoice paid'
         when 'overdue' then 'Invoice overdue'
         when 'void' then 'Invoice voided'
         when 'draft' then 'Invoice drafted'
         else 'Invoice issued'
       end,
       concat_ws(' · ', invoice.number, invoice.currency || ' ' || trim(to_char(invoice.total_amount, 'FM9999999990.00'))),
       case invoice.display_status
         when 'paid' then 'green'
         when 'overdue' then 'gold'
         when 'void' then 'neutral'
         when 'draft' then 'neutral'
         else 'blue'
       end,
       coalesce(invoice.voided_at, invoice.sent_at, invoice.updated_at, invoice.created_at),
       ('/accounts?customerId=' || invoice.customer_id::text)::text,
       jsonb_build_object(
         'number', invoice.number,
         'status', invoice.display_status,
         'currency', invoice.currency,
         'total_amount', invoice.total_amount,
         'outstanding_amount', invoice.outstanding_amount
       )
from public.invoice_account_balances invoice

union all

select payment.workspace_id,
       payment.customer_id,
       'payment'::text,
       payment.id,
       ('payment_' || payment.status)::text,
       case when payment.status = 'reversed' then 'Customer Payment reversed' else 'Customer Payment recorded' end,
       concat_ws(' · ', payment.reference, payment.currency || ' ' || trim(to_char(payment.amount, 'FM9999999990.00'))),
       case when payment.status = 'reversed' then 'neutral' else 'green' end,
       coalesce(payment.reversed_at, payment.received_at, payment.created_at),
       ('/accounts?customerId=' || payment.customer_id::text)::text,
       jsonb_build_object(
         'reference', payment.reference,
         'status', payment.status,
         'currency', payment.currency,
         'amount', payment.amount,
         'unallocated_amount', payment.unallocated_amount
       )
from public.payment_account_balances payment

union all

select document_link.workspace_id,
       document_link.customer_id,
       'document'::text,
       document.id,
       'document_uploaded'::text,
       'Document uploaded'::text,
       concat_ws(' · ', document.name, document.document_type),
       'blue'::text,
       document.uploaded_at,
       ('/documents?documentId=' || document.id::text)::text,
       jsonb_build_object(
         'name', document.name,
         'document_type', document.document_type,
         'category', document.category,
         'status', document.status,
         'link_type', 'customer'
       )
from (
  select distinct link.workspace_id,
         link.target_id as customer_id,
         link.document_id
  from public.document_links link
  where link.link_type = 'customer'
    and link.target_id is not null
) document_link
join public.documents document
  on document.workspace_id = document_link.workspace_id
 and document.id = document_link.document_id

union all

select activity.workspace_id,
       customer.id,
       'document'::text,
       activity.id,
       case activity.action
         when 'Document linked' then 'document_linked'
         else 'document_link_revoked'
       end,
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/documents?documentId=' || activity.entity_id)::text,
       activity.metadata
from public.activity_items activity
join public.customers customer
  on customer.workspace_id = activity.workspace_id
 and customer.id::text = activity.metadata ->> 'target_id'
where activity.entity_type = 'document'
  and activity.action in ('Document linked', 'Document link revoked')
  and activity.metadata ->> 'source' = 'general_document_link'
  and activity.metadata ->> 'link_type' = 'customer'

union all

select distinct activity.workspace_id,
       customer.id,
       'document'::text,
       activity.id,
       'document_archived'::text,
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/documents?documentId=' || activity.entity_id)::text,
       activity.metadata
from public.activity_items activity
join public.documents document
  on document.workspace_id = activity.workspace_id
 and document.id::text = activity.entity_id
join public.document_links link
  on link.workspace_id = document.workspace_id
 and link.document_id = document.id
 and link.link_type = 'customer'
 and link.target_id is not null
join public.customers customer
  on customer.workspace_id = link.workspace_id
 and customer.id = link.target_id
where activity.entity_type = 'document'
  and activity.action = 'Document archived'
  and activity.metadata ->> 'source' = 'general_document'

union all

select message.workspace_id,
       message.customer_id,
       'communication'::text,
       message.id,
       'communication_recorded'::text,
       (message.channel || ' communication')::text,
       concat_ws(' · ', message.subject, message.preview),
       case when message.unread then 'gold' else 'blue' end,
       message.occurred_at,
       ('/communications?customerId=' || message.customer_id::text)::text,
       jsonb_build_object(
         'channel', message.channel,
         'subject', message.subject,
         'status', message.status::text,
         'unread', message.unread
       )
from public.messages message;

revoke all on public.customer_360_operational_summary from public, anon, authenticated;
revoke all on public.customer_360_activity from public, anon, authenticated;
grant select on public.customer_360_operational_summary to authenticated;
grant select on public.customer_360_activity to authenticated;

comment on view public.customer_360_operational_summary is
  'Customer operational counts with Documents resolved through active typed links.';
comment on view public.customer_360_activity is
  'Unified Customer activity with Document upload, link, revoke and archive events resolved through typed links.';

commit;


begin;

create index if not exists documents_created_by_idx
  on public.documents(created_by)
  where created_by is not null;

create index if not exists documents_archived_by_idx
  on public.documents(archived_by)
  where archived_by is not null;

create index if not exists document_links_created_by_idx
  on public.document_links(created_by)
  where created_by is not null;

create index if not exists document_links_revoked_by_idx
  on public.document_links(revoked_by)
  where revoked_by is not null;

create index if not exists document_command_receipts_link_idx
  on public.document_command_receipts(link_id)
  where link_id is not null;

commit;


begin;

create table if not exists public.communication_threads (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null,
  subject text not null,
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  constraint communication_threads_customer_fkey
    foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id)
    on delete restrict,
  constraint communication_threads_channel_check
    check (channel in ('Email', 'WhatsApp', 'Instagram', 'Web')),
  constraint communication_threads_status_check
    check (status in ('open', 'closed')),
  constraint communication_threads_subject_check
    check (char_length(trim(subject)) between 1 and 240),
  constraint communication_threads_close_shape_check
    check (
      (status = 'open' and closed_at is null and closed_by is null)
      or
      (status = 'closed' and closed_at is not null and closed_by is not null)
    )
);

alter table public.messages
  add column if not exists thread_id uuid,
  add column if not exists direction text,
  add column if not exists body text,
  add column if not exists reply_to_message_id uuid,
  add column if not exists draft_state text,
  add column if not exists read_at timestamptz,
  add column if not exists read_by uuid references auth.users(id) on delete set null,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists command_id uuid;

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
)
select message.id,
       message.workspace_id,
       message.customer_id,
       message.channel,
       message.subject,
       'open',
       message.occurred_at,
       message.created_at,
       message.updated_at,
       null
from public.messages message
on conflict (id) do nothing;

update public.messages
set thread_id = coalesce(thread_id, id),
    direction = coalesce(
      direction,
      case when status::text = 'replied' then 'outbound' else 'inbound' end
    ),
    body = coalesce(body, preview),
    draft_state = coalesce(
      draft_state,
      case when status::text = 'approval' then 'review' else 'none' end
    ),
    read_at = case
      when coalesce(direction, case when status::text = 'replied' then 'outbound' else 'inbound' end) = 'inbound'
       and unread = false
      then coalesce(read_at, occurred_at)
      else read_at
    end;

alter table public.messages
  alter column thread_id set not null,
  alter column direction set not null,
  alter column body set not null,
  alter column draft_state set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_thread_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_thread_id_fkey
      foreign key (thread_id)
      references public.communication_threads(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_reply_to_message_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_reply_to_message_id_fkey
      foreign key (reply_to_message_id)
      references public.messages(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_direction_check'
  ) then
    alter table public.messages
      add constraint messages_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_draft_state_check'
  ) then
    alter table public.messages
      add constraint messages_draft_state_check
      check (draft_state in ('none', 'review', 'dismissed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_body_check'
  ) then
    alter table public.messages
      add constraint messages_body_check
      check (char_length(trim(body)) between 1 and 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_draft_direction_check'
  ) then
    alter table public.messages
      add constraint messages_draft_direction_check
      check (draft_state = 'none' or direction = 'outbound');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_read_shape_check'
  ) then
    alter table public.messages
      add constraint messages_read_shape_check
      check (
        direction = 'outbound'
        or unread
        or read_at is not null
      );
  end if;
end
$$;

create table if not exists public.communication_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  thread_id uuid references public.communication_threads(id) on delete restrict,
  message_id uuid references public.messages(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  constraint communication_command_receipts_key_check
    check (char_length(trim(idempotency_key)) between 1 and 128),
  constraint communication_command_receipts_action_check
    check (action in ('record_message', 'mark_read', 'dismiss_draft', 'close_thread'))
);

create index if not exists communication_threads_workspace_activity_idx
  on public.communication_threads(workspace_id, last_message_at desc);
create index if not exists communication_threads_customer_activity_idx
  on public.communication_threads(workspace_id, customer_id, last_message_at desc);
create index if not exists communication_threads_created_by_idx
  on public.communication_threads(created_by) where created_by is not null;
create index if not exists communication_threads_closed_by_idx
  on public.communication_threads(closed_by) where closed_by is not null;
create index if not exists messages_thread_activity_idx
  on public.messages(workspace_id, thread_id, occurred_at asc, created_at asc);
create index if not exists messages_unread_inbound_idx
  on public.messages(workspace_id, occurred_at desc)
  where direction = 'inbound' and unread = true;
create index if not exists messages_reply_to_idx
  on public.messages(reply_to_message_id) where reply_to_message_id is not null;
create index if not exists messages_read_by_idx
  on public.messages(read_by) where read_by is not null;
create index if not exists messages_recorded_by_idx
  on public.messages(recorded_by) where recorded_by is not null;
create index if not exists communication_command_receipts_thread_idx
  on public.communication_command_receipts(thread_id) where thread_id is not null;
create index if not exists communication_command_receipts_message_idx
  on public.communication_command_receipts(message_id) where message_id is not null;

alter table public.communication_threads enable row level security;
alter table public.communication_command_receipts enable row level security;

revoke all on public.communication_threads from public, anon, authenticated;
revoke all on public.communication_command_receipts from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;

grant select on public.communication_threads to authenticated;
grant select on public.messages to authenticated;

drop policy if exists "Communication threads permission read" on public.communication_threads;
create policy "Communication threads permission read"
on public.communication_threads
for select
to authenticated
using (private.has_workspace_permission(workspace_id, 'communications', 'view'));

drop policy if exists "Communications permission insert" on public.messages;
drop policy if exists "Communications permission update" on public.messages;
drop policy if exists "Communications permission delete" on public.messages;

create or replace view public.unified_communication_index
with (security_invoker = true)
as
select thread.id,
       thread.workspace_id,
       thread.customer_id,
       thread.channel,
       thread.subject,
       thread.status,
       thread.last_message_at,
       thread.created_at,
       thread.updated_at,
       thread.closed_at,
       count(message.id)::integer as message_count,
       count(message.id) filter (
         where message.direction = 'inbound'
           and message.unread = true
           and message.draft_state <> 'dismissed'
       )::integer as unread_count,
       count(message.id) filter (
         where message.draft_state = 'review'
       )::integer as draft_review_count,
       latest.id as latest_message_id,
       latest.direction as latest_direction,
       latest.body as latest_body,
       latest.draft_state as latest_draft_state,
       latest.occurred_at as latest_occurred_at
from public.communication_threads thread
join public.messages message
  on message.workspace_id = thread.workspace_id
 and message.thread_id = thread.id
left join lateral (
  select candidate.id,
         candidate.direction,
         candidate.body,
         candidate.draft_state,
         candidate.occurred_at
  from public.messages candidate
  where candidate.workspace_id = thread.workspace_id
    and candidate.thread_id = thread.id
  order by candidate.occurred_at desc, candidate.created_at desc, candidate.id desc
  limit 1
) latest on true
group by thread.id,
         thread.workspace_id,
         thread.customer_id,
         thread.channel,
         thread.subject,
         thread.status,
         thread.last_message_at,
         thread.created_at,
         thread.updated_at,
         thread.closed_at,
         latest.id,
         latest.direction,
         latest.body,
         latest.draft_state,
         latest.occurred_at;

revoke all on public.unified_communication_index from public, anon, authenticated;
grant select on public.unified_communication_index to authenticated;

commit;


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


begin;

create or replace view public.customer_360_communication_summary
with (security_invoker = true)
as
select thread.workspace_id,
       thread.customer_id,
       count(distinct thread.id)::integer as thread_count,
       count(distinct thread.id) filter (where thread.status = 'open')::integer as open_thread_count,
       count(message.id) filter (where message.draft_state <> 'dismissed')::integer as message_count,
       count(message.id) filter (
         where message.direction = 'inbound'
           and message.unread = true
           and message.draft_state <> 'dismissed'
       )::integer as unread_message_count,
       count(message.id) filter (where message.draft_state = 'review')::integer as draft_review_count,
       max(greatest(thread.last_message_at, message.occurred_at)) as last_communication_at
from public.communication_threads thread
join public.messages message
  on message.workspace_id = thread.workspace_id
 and message.thread_id = thread.id
group by thread.workspace_id, thread.customer_id;

create or replace view public.customer_360_communication_activity
with (security_invoker = true)
as
select message.workspace_id,
       message.customer_id,
       'communication'::text as source_type,
       message.id as source_id,
       case
         when message.draft_state = 'review' then 'communication_draft_recorded'
         when message.direction = 'inbound' then 'communication_received'
         else 'communication_recorded'
       end as event_type,
       case
         when message.draft_state = 'review' then 'Communication draft recorded'
         when message.direction = 'inbound' then 'Communication received'
         else 'Outbound communication recorded'
       end as title,
       concat_ws(' · ', message.channel, message.subject, left(message.body, 240)) as detail,
       case
         when message.draft_state = 'review' then 'gold'
         when message.direction = 'inbound' then 'blue'
         else 'green'
       end as tone,
       message.occurred_at,
       ('/communications?threadId=' || message.thread_id::text || '&customerId=' || message.customer_id::text)::text as route,
       jsonb_build_object(
         'thread_id', message.thread_id,
         'message_id', message.id,
         'channel', message.channel,
         'direction', message.direction,
         'draft_state', message.draft_state,
         'unread', message.unread,
         'reply_to_message_id', message.reply_to_message_id
       ) as metadata
from public.messages message
where message.draft_state <> 'dismissed'

union all

select activity.workspace_id,
       (activity.metadata ->> 'customer_id')::uuid,
       'communication'::text,
       activity.id,
       coalesce(activity.metadata ->> 'event_type', 'communication_lifecycle'),
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/communications?threadId=' || (activity.metadata ->> 'thread_id') || '&customerId=' || (activity.metadata ->> 'customer_id'))::text,
       activity.metadata
from public.activity_items activity
where activity.entity_type = 'communication_thread'
  and activity.metadata ->> 'source' = 'unified_communication_lifecycle'
  and activity.metadata ? 'customer_id'
  and activity.metadata ? 'thread_id';

revoke all on public.customer_360_communication_summary from public, anon, authenticated;
revoke all on public.customer_360_communication_activity from public, anon, authenticated;
grant select on public.customer_360_communication_summary to authenticated;
grant select on public.customer_360_communication_activity to authenticated;

commit;


begin;

create index if not exists messages_thread_id_idx
  on public.messages(thread_id);

commit;
