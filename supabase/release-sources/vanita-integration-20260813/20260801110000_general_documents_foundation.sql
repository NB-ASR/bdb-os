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
