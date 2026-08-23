begin;

select plan(44);

select has_table('public', 'customers', 'Canonical Customers table exists');
select has_table('public', 'customer_command_receipts', 'Customer command receipts exist');
select has_table('public', 'customer_import_batches', 'Customer import batches exist');
select has_table('public', 'customer_import_receipts', 'Customer import receipts exist');

select has_function(
  'public',
  'apply_customer_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','text','text','text','text','text','text','text','jsonb','boolean','text'],
  'trusted Customer lifecycle command exists'
);
select is(
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='apply_customer_command'),
  1::bigint,
  'Customer lifecycle command exposes one unambiguous RPC signature'
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
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='vat_number'), 'Customer canonical VAT identity exists');

select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='customers' and indexname='customers_workspace_code_ci_idx'), 'Customer codes are case-insensitively unique per workspace');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='customers' and indexname='customers_workspace_legacy_identity_idx'), 'Customer legacy identities are unique per workspace');
select ok(exists(select 1 from pg_constraint where conrelid='public.customer_command_receipts'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, idempotency_key)'), 'Customer commands are idempotent');
select ok(exists(select 1 from pg_constraint where conrelid='public.customer_import_receipts'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, source, legacy_id)'), 'Customer imports preserve provenance without duplicate source identities');
select ok(
  not exists (
    select 1
    from (values
      ('customers_created_by_idx'),
      ('customers_updated_by_idx'),
      ('customer_import_batches_created_by_idx'),
      ('customer_import_receipts_batch_idx')
    ) required(index_name)
    where not exists (
      select 1 from pg_indexes where schemaname='public' and indexname=required.index_name
    )
  ),
  'Customer audit and import foreign keys have covering indexes'
);

select ok(position('actor_has_workspace_permission' in lower(pg_get_functiondef('private.customer_actor_can_write(uuid,uuid,text)'::regprocedure))) > 0, 'Customer writes use the shared support-aware permission boundary');
select ok(position('customer_command_receipts' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0, 'Customer lifecycle commands store idempotency receipts');
select ok(position('potential duplicate customer requires review' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0, 'Customer commands require explicit duplicate review');
select ok(
  position('right(replace(p_customer_id::text' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0
  and position('right(replace(new_customer_id::text' in lower(pg_get_functiondef('public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0,
  'Customer codes use the final 64 UUID bits to avoid prefix collisions'
);
select ok(
  position('customer_import_receipts' in lower(pg_get_functiondef('public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0
  and position('legacy_source' in lower(pg_get_functiondef('public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0,
  'Customer imports preserve provenance'
);

select ok(
  position('legacy/imported customer context' in lower(col_description('public.customers'::regclass, (
    select ordinal_position from information_schema.columns where table_schema='public' and table_name='customers' and column_name='notes'
  )))) > 0
  and position('customer_notes' in lower(col_description('public.customers'::regclass, (
    select ordinal_position from information_schema.columns where table_schema='public' and table_name='customers' and column_name='notes'
  )))) > 0,
  'Legacy Customer directory notes are explicitly non-canonical context'
);
select ok(
  position('canonical customer vat/legal tax identity' in lower(col_description('public.customers'::regclass, (
    select ordinal_position from information_schema.columns where table_schema='public' and table_name='customers' and column_name='vat_number'
  )))) > 0,
  'VAT/legal identity is owned by the canonical Customer master record'
);
select ok(
  position('nullif(trim(p_notes)' in lower(pg_get_functiondef('public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) = 0,
  'Normal Customer lifecycle commands cannot create or mutate legacy directory notes'
);
select ok(
  position('canonical general document relationships are public.document_links' in lower(col_description('public.documents'::regclass, (
    select ordinal_position from information_schema.columns where table_schema='public' and table_name='documents' and column_name='customer_id'
  )))) > 0,
  'Legacy direct Document Customer pointer is explicitly non-canonical'
);
select ok(
  not exists (
    select 1
    from public.documents document
    where document.customer_id is not null
      and not exists (
        select 1 from public.document_links link
        where link.workspace_id = document.workspace_id
          and link.document_id = document.id
          and link.link_type = 'customer'
          and link.target_id = document.customer_id
          and link.revoked_at is null
      )
  ),
  'Any legacy direct Document Customer pointer is preserved by a canonical active document link'
);
select ok(
  not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_general_document'
      and position('then p_target_id' in lower(pg_get_functiondef(p.oid))) > 0
  ),
  'New general Documents do not mirror Customer links into the legacy direct pointer'
);
select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='apply_appointment_command'
      and position('customer_record.status <> ''active''' in lower(pg_get_functiondef(p.oid))) > 0
      and position('archived customers cannot receive new appointments' in lower(pg_get_functiondef(p.oid))) > 0
  ),
  'Archived Customers cannot be used for new Appointment work'
);
select ok(
  exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    join pg_namespace function_schema on function_schema.oid = trigger_function.pronamespace
    where trigger_row.tgrelid = 'public.sales'::regclass
      and trigger_row.tgname = 'sales_active_customer_guard'
      and not trigger_row.tgisinternal
      and function_schema.nspname = 'private'
      and trigger_function.proname = 'enforce_active_sale_customer'
      and position('customer.status = ''active''' in lower(pg_get_functiondef(trigger_function.oid))) > 0
  ),
  'Archived Customers cannot be used for new completed Sales'
);
select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='apply_invoice_command'
      and position('customer.status = ''active''' in lower(pg_get_functiondef(p.oid))) > 0
      and position('invoice customer is unavailable' in lower(pg_get_functiondef(p.oid))) > 0
  ),
  'Archived Customers cannot be used for new canonical Invoices'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_workspace_invoice'
      and (
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  ),
  'No executable legacy invoice helper can bypass canonical archived-Customer rules'
);

select * from finish();
rollback;
