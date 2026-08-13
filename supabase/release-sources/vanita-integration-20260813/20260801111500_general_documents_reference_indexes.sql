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
