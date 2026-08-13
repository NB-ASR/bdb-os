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
