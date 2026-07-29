begin;

select plan(30);

select has_table('public', 'customers', 'Canonical Customers table exists');
select has_table('public', 'customer_command_receipts', 'Customer command receipts exist');
select has_table('public', 'customer_import_batches', 'Customer import batches exist');
select has_table('public', 'customer_import_receipts', 'Customer import receipts exist');

select has_function(
  'public',
  'apply_customer_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','text','text','text','text','text','text','text','jsonb','boolean'],
  'trusted Customer lifecycle command exists'
);
select has_function(
  'public',
  'import_vanita_customers',
  array['uuid','uuid','text','uuid','uuid','text','jsonb'],
  'trusted Vanita Customer import command exists'
);

select ok(exists(select 1 from pg_class where oid='public.customers'::regclass and relrowsecurity), 'Customers use RLS');
select ok(exists(select 1 from pg_class where oid='public.customer_command_receipts'::regclass and relrowsecurity), 'Customer receipts use RLS');
select ok(exists(select 1 from pg_class where oid='public.customer_import_batches'::regclass and relrowsecurity), 'Customer import batches use RLS');
select ok(exists(select 1 from pg_class where oid='public.customer_import_receipts'::regclass and relrowsecurity), 'Customer import receipts use RLS');

select ok(not has_table_privilege('anon','public.customers','SELECT'), 'anonymous users cannot read Customers');
select ok(has_table_privilege('authenticated','public.customers','SELECT'), 'authenticated users retain RLS-scoped Customer reads');
select ok(not has_table_privilege('authenticated','public.customers','INSERT'), 'browser clients cannot insert Customers directly');
select ok(not has_table_privilege('authenticated','public.customers','UPDATE'), 'browser clients cannot update Customers directly');
select ok(not has_table_privilege('authenticated','public.customers','DELETE'), 'browser clients cannot delete Customers directly');
select ok(not has_table_privilege('authenticated','public.customer_command_receipts','SELECT'), 'browser clients cannot read Customer receipts');
select ok(not has_table_privilege('authenticated','public.customer_import_batches','SELECT'), 'browser clients cannot read Customer import batches');
select ok(not has_table_privilege('authenticated','public.customer_import_receipts','SELECT'), 'browser clients cannot read Customer import receipts');

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='status' and data_type='text'), 'Customer lifecycle status exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='version' and data_type='integer'), 'Customer optimistic version exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='preferences' and data_type='jsonb'), 'Customer preferences remain structured');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='legacy_id'), 'Customer legacy identity exists');

select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='customers' and indexname='customers_workspace_code_ci_idx'), 'Customer codes are case-insensitively unique per workspace');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='customers' and indexname='customers_workspace_legacy_identity_idx'), 'Customer legacy identities are unique per workspace');
select ok(exists(select 1 from pg_constraint where conrelid='public.customer_command_receipts'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, idempotency_key)'), 'Customer commands are idempotent');
select ok(exists(select 1 from pg_constraint where conrelid='public.customer_import_receipts'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, source, legacy_id)'), 'Customer imports preserve provenance without duplicate source identities');

select ok(position('actor_has_workspace_permission' in lower(pg_get_functiondef('private.customer_actor_can_write(uuid,uuid,text)'::regprocedure))) > 0, 'Customer writes use the shared support-aware permission boundary');
select ok(position('customer_command_receipts' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure))) > 0, 'Customer lifecycle commands store idempotency receipts');
select ok(position('potential duplicate customer requires review' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure))) > 0, 'Customer commands require explicit duplicate review');
select ok(
  position('customer_import_receipts' in lower(pg_get_functiondef('public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0
  and position('legacy_source' in lower(pg_get_functiondef('public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0,
  'Customer imports preserve provenance'
);

select * from finish();
rollback;
