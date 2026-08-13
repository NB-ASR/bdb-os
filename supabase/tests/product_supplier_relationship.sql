begin;

select plan(20);

select has_table('public', 'product_suppliers', 'Product Supplier relationship table exists');
select has_table('public', 'product_supplier_command_receipts', 'Product Supplier command receipts table exists');
select has_function(
  'public',
  'apply_product_supplier_command',
  array[
    'uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'integer',
    'uuid', 'uuid', 'text', 'numeric', 'text', 'boolean', 'integer',
    'numeric', 'text'
  ],
  'trusted Product Supplier command exists'
);

select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.product_suppliers'::regclass and relation.relrowsecurity
  ),
  'Product Supplier relationships use RLS'
);
select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.product_supplier_command_receipts'::regclass and relation.relrowsecurity
  ),
  'Product Supplier command receipts use RLS'
);
select ok(
  not has_table_privilege('anon', 'public.product_suppliers', 'SELECT'),
  'anonymous users cannot read Product Supplier relationships'
);
select ok(
  has_table_privilege('authenticated', 'public.product_suppliers', 'SELECT'),
  'authenticated users retain RLS-scoped Product Supplier reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_suppliers', 'INSERT'),
  'browser clients cannot insert Product Supplier relationships directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_suppliers', 'UPDATE'),
  'browser clients cannot update Product Supplier relationships directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_suppliers', 'DELETE'),
  'browser clients cannot delete Product Supplier relationships'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_supplier_command_receipts', 'SELECT'),
  'browser clients cannot read Product Supplier command receipts'
);
select ok(
  has_table_privilege('service_role', 'public.product_suppliers', 'INSERT'),
  'service role can execute trusted Product Supplier mutations after explicit-grant enforcement'
);
select ok(
  has_table_privilege('service_role', 'public.product_supplier_command_receipts', 'INSERT'),
  'service role can persist Product Supplier idempotency receipts after explicit-grant enforcement'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_suppliers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (workspace_id, product_id, supplier_id)'
  ),
  'a Supplier can be linked to a Product once per workspace'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'product_suppliers'
      and indexname = 'product_suppliers_supplier_sku_idx'
  ),
  'Supplier SKU uniqueness index exists'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'product_suppliers'
      and indexname = 'product_suppliers_preferred_product_idx'
  ),
  'one-active-preferred-Supplier index exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_supplier_command_receipts'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, idempotency_key)'
  ),
  'workspace-scoped Product Supplier idempotency is enforced'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_suppliers'
      and column_name = 'version'
      and data_type = 'integer'
  ),
  'Product Supplier optimistic concurrency version exists'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_suppliers'
      and column_name in ('bank_account', 'iban', 'bic', 'swift', 'payment_approval', 'settlement_status')
  ),
  'Product Supplier relationships contain no banking or payment execution fields'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'product_suppliers'
      and cmd = 'SELECT'
      and qual ilike '%products%view%'
      and qual ilike '%suppliers%view%'
  ),
  'Product Supplier reads require both Product and Supplier visibility'
);

select * from finish();
rollback;
