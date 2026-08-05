begin;

select plan(24);

select has_table('public', 'supplier_documents', 'Supplier document table exists');
select has_table('public', 'supplier_document_lines', 'Supplier document line table exists');
select has_table('public', 'supplier_document_extraction_runs', 'Extraction run table exists');
select has_table('public', 'supplier_document_command_receipts', 'Supplier document command receipts exist');

select has_function(
  'public',
  'apply_supplier_document_upload',
  array['uuid','uuid','text','uuid','uuid','text','text','text','bigint','text','text'],
  'trusted supplier document upload command exists'
);
select has_function(
  'public',
  'apply_supplier_document_review',
  array['uuid','uuid','text','text','uuid','uuid','integer','jsonb','jsonb'],
  'trusted supplier document review command exists'
);
select has_function(
  'public',
  'begin_supplier_document_extraction',
  array['uuid','uuid','uuid','uuid','text'],
  'trusted extraction start command exists'
);
select has_function(
  'public',
  'complete_supplier_document_extraction',
  array['uuid','uuid','uuid','uuid','text','text','text','jsonb'],
  'trusted extraction completion command exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.supplier_documents'::regclass),
  'Supplier documents use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.supplier_document_lines'::regclass),
  'Supplier document lines use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.supplier_document_extraction_runs'::regclass),
  'Extraction runs use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.supplier_document_command_receipts'::regclass),
  'Command receipts use RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.supplier_documents', 'SELECT'),
  'authenticated users retain RLS-scoped document reads'
);
select ok(
  has_table_privilege('authenticated', 'public.supplier_document_lines', 'SELECT'),
  'authenticated users retain RLS-scoped line reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_documents', 'INSERT'),
  'browser clients cannot insert supplier documents directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_documents', 'UPDATE'),
  'browser clients cannot update supplier documents directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_documents', 'DELETE'),
  'browser clients cannot delete supplier documents directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_document_extraction_runs', 'SELECT'),
  'browser clients cannot read raw extraction runs'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_document_command_receipts', 'SELECT'),
  'browser clients cannot read command receipts'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'supplier_documents'
      and indexname = 'supplier_documents_workspace_hash_idx'
  ),
  'workspace file-hash duplicate guard exists'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'supplier_documents'
      and indexname = 'supplier_documents_workspace_number_idx'
  ),
  'workspace supplier-document-number duplicate guard exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_document_command_receipts'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, idempotency_key)'
  ),
  'workspace-scoped supplier document idempotency is enforced'
);
select ok(
  exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public'
      and check_clause ilike '%inventory_posting_status%not_available%'
  ),
  'Inventory posting remains unavailable in this slice'
);
select ok(
  exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public'
      and check_clause ilike '%accounts_posting_status%not_available%'
  ),
  'Accounts posting remains unavailable in this slice'
);

select * from finish();
rollback;
