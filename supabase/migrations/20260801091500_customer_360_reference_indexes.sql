begin;

create index if not exists bookings_customer_activity_idx
  on public.bookings(workspace_id, customer_id, updated_at desc, created_at desc);

create index if not exists sales_customer_activity_idx
  on public.sales(workspace_id, customer_id, occurred_at desc)
  where customer_id is not null;

create index if not exists invoices_customer_activity_idx
  on public.invoices(workspace_id, customer_id, created_at desc);

create index if not exists payments_customer_activity_idx
  on public.payments(workspace_id, customer_id, received_at desc);

create index if not exists documents_customer_activity_idx
  on public.documents(workspace_id, customer_id, uploaded_at desc)
  where customer_id is not null;

create index if not exists messages_customer_activity_idx
  on public.messages(workspace_id, customer_id, occurred_at desc);

create index if not exists activity_items_customer_entity_idx
  on public.activity_items(workspace_id, entity_type, entity_id, occurred_at desc)
  where entity_type = 'customer';

commit;
