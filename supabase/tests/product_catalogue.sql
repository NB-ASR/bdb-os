begin;

select plan(16);

select has_table('public', 'products', 'products table exists');
select has_table('public', 'product_command_receipts', 'product command receipts table exists');
select has_function(
  'public',
  'apply_product_command',
  array[
    'uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'numeric', 'numeric', 'numeric', 'numeric', 'text'
  ],
  'trusted product command exists'
);

select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.products'::regclass and relation.relrowsecurity
  ),
  'products use RLS'
);
select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.product_command_receipts'::regclass and relation.relrowsecurity
  ),
  'product command receipts use RLS'
);

select ok(
  not has_table_privilege('anon', 'public.products', 'SELECT'),
  'anonymous users cannot read products'
);
select ok(
  has_table_privilege('authenticated', 'public.products', 'SELECT'),
  'authenticated users retain RLS-scoped product reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.products', 'INSERT'),
  'browser clients cannot insert products directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.products', 'UPDATE'),
  'browser clients cannot update products directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.products', 'DELETE'),
  'browser clients cannot delete products'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_command_receipts', 'SELECT'),
  'browser clients cannot read command receipts'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (workspace_id, sku)'
  ),
  'SKU is unique within a workspace'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'products'
      and indexname = 'products_workspace_barcode_idx'
  ),
  'barcode uniqueness index exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_command_receipts'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, idempotency_key)'
  ),
  'workspace-scoped command idempotency is enforced'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'version'
      and data_type = 'integer'
  ),
  'optimistic concurrency version exists'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name in ('quantity', 'on_hand', 'stock_on_hand')
  ),
  'product definitions do not store stock quantity'
);

select * from finish();
rollback;
