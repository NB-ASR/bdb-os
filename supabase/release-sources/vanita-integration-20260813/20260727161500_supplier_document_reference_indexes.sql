begin;

create index if not exists supplier_document_lines_workspace_product_idx
  on public.supplier_document_lines(workspace_id, matched_product_id)
  where matched_product_id is not null;

create index if not exists supplier_document_lines_workspace_relationship_idx
  on public.supplier_document_lines(workspace_id, matched_product_supplier_id)
  where matched_product_supplier_id is not null;

create index if not exists supplier_document_extraction_runs_requested_by_idx
  on public.supplier_document_extraction_runs(requested_by)
  where requested_by is not null;

create index if not exists supplier_documents_approved_by_idx
  on public.supplier_documents(approved_by)
  where approved_by is not null;

create index if not exists supplier_documents_created_by_idx
  on public.supplier_documents(created_by)
  where created_by is not null;

create index if not exists supplier_documents_updated_by_idx
  on public.supplier_documents(updated_by)
  where updated_by is not null;

commit;
