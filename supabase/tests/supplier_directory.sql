begin;

select plan(17);

select has_table('public', 'suppliers', 'suppliers table exists');
select has_table('public', 'supplier_command_receipts', 'supplier command receipts table exists');
select has_function(
  'public',
  'apply_supplier_command',
  array[
    'uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'integer', 'numeric', 'text', 'text[]', 'text', 'text', 'text', 'text'
  ],
  'trusted supplier command exists'
);

select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.suppliers'::regclass and relation.relrowsecurity
  ),
  'suppliers use RLS'
);
select ok(
  exists (
    select 1 from pg_class relation
    where relation.oid = 'public.supplier_command_receipts'::regclass and relation.relrowsecurity
  ),
  'supplier command receipts use RLS'
);

select ok(
  not has_table_privilege('anon', 'public.suppliers', 'SELECT'),
  'anonymous users cannot read suppliers'
);
select ok(
  has_table_privilege('authenticated', 'public.suppliers', 'SELECT'),
  'authenticated users retain RLS-scoped supplier reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.suppliers', 'INSERT'),
  'browser clients cannot insert suppliers directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.suppliers', 'UPDATE'),
  'browser clients cannot update suppliers directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.suppliers', 'DELETE'),
  'browser clients cannot delete suppliers'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_command_receipts', 'SELECT'),
  'browser clients cannot read supplier command receipts'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.suppliers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (workspace_id, code)'
  ),
  'supplier code is unique within a workspace'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_command_receipts'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, idempotency_key)'
  ),
  'workspace-scoped supplier command idempotency is enforced'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'suppliers'
      and column_name = 'version'
      and data_type = 'integer'
  ),
  'supplier optimistic concurrency version exists'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'suppliers'
      and column_name = 'categories'
      and data_type = 'ARRAY'
  ),
  'supplier categories are normalized as an array on the supplier identity'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'suppliers'
      and column_name in ('bank_account', 'iban', 'swift', 'bic', 'payment_approval', 'settled_at')
  ),
  'supplier directory does not store banking or settlement fields'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'suppliers'
      and cmd = 'SELECT'
      and qual ilike '%has_workspace_permission%'
  ),
  'supplier reads are permission scoped'
);

select * from finish();
rollback;
