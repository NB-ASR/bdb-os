begin;

select plan(27);

select has_table('public', 'inventory_locations', 'Inventory locations table exists');
select has_table('public', 'inventory_movements', 'Inventory movements table exists');
select has_table('public', 'inventory_command_receipts', 'Inventory command receipts table exists');
select has_view('public', 'inventory_stock_balances', 'Inventory stock-balance view exists');
select has_view('public', 'inventory_product_totals', 'Inventory Product totals view exists');

select has_function(
  'public',
  'post_inventory_movement',
  array['uuid','uuid','uuid','uuid','text','numeric','text','uuid','uuid','timestamp with time zone','numeric','text','text','text','text','jsonb','uuid'],
  'trusted Inventory movement command exists'
);
select has_function(
  'public',
  'transfer_inventory_stock',
  array['uuid','uuid','uuid','uuid','uuid','uuid','uuid','numeric','text','uuid','uuid','timestamp with time zone','text','jsonb'],
  'trusted Inventory transfer command exists'
);
select has_function(
  'public',
  'post_supplier_document_to_inventory',
  array['uuid','uuid','uuid','text','uuid','uuid'],
  'trusted Purchasing-to-Inventory posting command exists'
);
select has_function(
  'public',
  'reverse_supplier_document_inventory',
  array['uuid','uuid','text','uuid','uuid','text'],
  'trusted supplier-document Inventory reversal exists'
);

select ok(
  exists (select 1 from pg_class where oid='public.inventory_locations'::regclass and relrowsecurity),
  'Inventory locations use RLS'
);
select ok(
  exists (select 1 from pg_class where oid='public.inventory_movements'::regclass and relrowsecurity),
  'Inventory movements use RLS'
);
select ok(
  exists (select 1 from pg_class where oid='public.inventory_command_receipts'::regclass and relrowsecurity),
  'Inventory command receipts use RLS'
);

select ok(not has_table_privilege('anon','public.inventory_locations','SELECT'), 'anonymous users cannot read Inventory locations');
select ok(not has_table_privilege('anon','public.inventory_movements','SELECT'), 'anonymous users cannot read Inventory movements');
select ok(has_table_privilege('authenticated','public.inventory_locations','SELECT'), 'authenticated users retain RLS-scoped location reads');
select ok(has_table_privilege('authenticated','public.inventory_movements','SELECT'), 'authenticated users retain RLS-scoped movement reads');
select ok(not has_table_privilege('authenticated','public.inventory_locations','INSERT'), 'browser clients cannot insert Inventory locations directly');
select ok(not has_table_privilege('authenticated','public.inventory_movements','INSERT'), 'browser clients cannot insert Inventory movements directly');
select ok(not has_table_privilege('authenticated','public.inventory_movements','UPDATE'), 'browser clients cannot edit Inventory movements directly');
select ok(not has_table_privilege('authenticated','public.inventory_movements','DELETE'), 'browser clients cannot delete Inventory movements');
select ok(not has_table_privilege('authenticated','public.inventory_command_receipts','SELECT'), 'browser clients cannot read Inventory command receipts');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.inventory_movements'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) ilike '%FOREIGN KEY (workspace_id, product_id)%products(workspace_id, id)%'
  ),
  'Inventory movements reference the canonical Product catalogue'
);
select ok(to_regclass('public.inventory_items') is null, 'no duplicate Inventory item catalogue exists');
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid='public.inventory_movements'::regclass
      and tgname='inventory_movements_immutable'
      and not tgisinternal
  ),
  'posted Inventory movements are immutable'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='inventory_movements'
      and indexname='inventory_movements_single_reversal_idx'
  ),
  'one reversal per original movement is enforced'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='inventory_movements'
      and indexname='inventory_movements_single_document_line_post_idx'
  ),
  'one original posting per supplier document line is enforced'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='inventory_movements'
      and cmd='SELECT' and qual ilike '%inventory%view%'
  ),
  'Inventory movement reads require Inventory visibility'
);

select * from finish();
rollback;
