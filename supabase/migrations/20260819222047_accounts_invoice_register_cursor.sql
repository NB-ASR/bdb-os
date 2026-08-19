begin;

-- Final-first Invoices are created atomically at issue time. created_at is therefore the precise,
-- non-null operational cursor for modern Invoice registers, including thousands issued on one date.
create index if not exists invoices_workspace_created_cursor_idx
  on public.invoices(workspace_id, created_at desc, id desc);

commit;
