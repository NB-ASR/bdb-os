begin;

select plan(18);

select has_table('public', 'inventory_items', 'inventory items table exists');
select has_table('public', 'inventory_locations', 'inventory locations table exists');
select has_table('public', 'inventory_movements', 'inventory movements table exists');
select has_view('public', 'inventory_stock_balances', 'derived stock balance view exists');

select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.inventory_items'::regclass and relation.relrowsecurity
  ),
  'inventory items use RLS'
);
select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.inventory_locations'::regclass and relation.relrowsecurity
  ),
  'inventory locations use RLS'
);
select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.inventory_movements'::regclass and relation.relrowsecurity
  ),
  'inventory movements use RLS'
);

select ok(
  not has_table_privilege('anon', 'public.inventory_movements', 'SELECT'),
  'anonymous users cannot read inventory movements'
);
select ok(
  has_table_privilege('authenticated', 'public.inventory_movements', 'SELECT'),
  'authenticated users retain RLS-scoped movement reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT'),
  'browser clients cannot post ledger movements directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'UPDATE'),
  'browser clients cannot edit ledger movements'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'DELETE'),
  'browser clients cannot delete ledger movements'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.inventory_movements'::regclass
      and tgname = 'inventory_movements_immutable'
      and not tgisinternal
  ),
  'movement immutability trigger exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'inventory_movements_workspace_id_item_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, item_id)%'
  ),
  'movement-to-item workspace isolation constraint exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'inventory_movements_workspace_id_location_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, location_id)%'
  ),
  'movement-to-location workspace isolation constraint exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_movements'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like 'UNIQUE (workspace_id, idempotency_key)%'
  ),
  'workspace-scoped movement idempotency is enforced'
);
select ok(
  to_regprocedure('public.post_inventory_movement(uuid,uuid,uuid,uuid,text,numeric,text,uuid,uuid,timestamp with time zone,text,text,text,jsonb,uuid)') is not null,
  'trusted movement command exists'
);
select ok(
  to_regprocedure('public.transfer_inventory_stock(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text,jsonb)') is not null,
  'atomic transfer command exists'
);

select * from finish();
rollback;
