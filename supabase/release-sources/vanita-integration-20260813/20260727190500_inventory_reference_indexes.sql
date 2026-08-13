begin;

create index if not exists inventory_locations_created_by_idx
  on public.inventory_locations(created_by)
  where created_by is not null;

create index if not exists inventory_locations_updated_by_idx
  on public.inventory_locations(updated_by)
  where updated_by is not null;

create index if not exists inventory_movements_actor_user_idx
  on public.inventory_movements(actor_user_id, occurred_at desc);

create index if not exists supplier_documents_inventory_location_idx
  on public.supplier_documents(workspace_id, inventory_location_id)
  where inventory_location_id is not null;

create index if not exists supplier_documents_inventory_posted_by_idx
  on public.supplier_documents(inventory_posted_by)
  where inventory_posted_by is not null;

create index if not exists supplier_documents_inventory_reversed_by_idx
  on public.supplier_documents(inventory_reversed_by)
  where inventory_reversed_by is not null;

commit;
