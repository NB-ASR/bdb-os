begin;

select plan(49);

select has_table('public', 'documents', 'Authoritative Documents table exists');
select has_table('public', 'document_links', 'Typed Document links exist');
select has_table('public', 'document_command_receipts', 'Document command receipts exist');
select has_view('public', 'general_document_index', 'General Documents index exists');
select has_view('public', 'customer_360_operational_summary', 'Customer operational summary exists');
select has_view('public', 'customer_360_activity', 'Customer unified activity exists');

select has_function(
  'public', 'create_general_document',
  array['uuid','uuid','uuid','text','uuid','text','text','text','text','text','bigint','text','text','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Document creation command exists'
);
select has_function(
  'public', 'add_general_document_link',
  array['uuid','uuid','uuid','text','uuid','text','uuid','uuid','timestamp with time zone'],
  'Trusted Document link command exists'
);
select has_function(
  'public', 'revoke_general_document_link',
  array['uuid','uuid','uuid','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Document link revocation command exists'
);
select has_function(
  'public', 'archive_general_document',
  array['uuid','uuid','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Document archive command exists'
);

select ok((select relrowsecurity from pg_class where oid = 'public.documents'::regclass), 'Documents use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_links'::regclass), 'Document links use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_command_receipts'::regclass), 'Document receipts use RLS');

select ok(has_table_privilege('authenticated', 'public.documents', 'SELECT'), 'Authenticated users retain RLS-scoped Document reads');
select ok(not has_table_privilege('authenticated', 'public.documents', 'INSERT'), 'Browser clients cannot insert Documents directly');
select ok(not has_table_privilege('authenticated', 'public.documents', 'UPDATE'), 'Browser clients cannot update Documents directly');
select ok(not has_table_privilege('authenticated', 'public.documents', 'DELETE'), 'Browser clients cannot delete Documents directly');
select ok(not has_table_privilege('anon', 'public.documents', 'SELECT'), 'Anonymous users cannot read Documents');

select ok(has_table_privilege('authenticated', 'public.document_links', 'SELECT'), 'Authenticated users retain RLS-scoped typed-link reads');
select ok(not has_table_privilege('authenticated', 'public.document_links', 'INSERT'), 'Browser clients cannot insert Document links');
select ok(not has_table_privilege('authenticated', 'public.document_links', 'UPDATE'), 'Browser clients cannot update Document links');
select ok(not has_table_privilege('authenticated', 'public.document_links', 'DELETE'), 'Browser clients cannot delete Document links');

select ok(not has_table_privilege('authenticated', 'public.document_command_receipts', 'SELECT'), 'Browser clients cannot read Document receipts');
select ok(not has_table_privilege('authenticated', 'public.document_command_receipts', 'INSERT'), 'Browser clients cannot insert Document receipts');

select ok(has_table_privilege('authenticated', 'public.general_document_index', 'SELECT'), 'Authenticated users can read the permission-aware Document index');
select ok(not has_table_privilege('authenticated', 'public.general_document_index', 'INSERT'), 'Document index cannot be inserted through the browser');
select ok(not has_table_privilege('authenticated', 'public.general_document_index', 'UPDATE'), 'Document index cannot be updated through the browser');
select ok(not has_table_privilege('authenticated', 'public.general_document_index', 'DELETE'), 'Document index cannot be deleted through the browser');

select ok(has_function_privilege('service_role', 'public.create_general_document(uuid,uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can create Documents');
select ok(has_function_privilege('service_role', 'public.add_general_document_link(uuid,uuid,uuid,text,uuid,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can add Document links');
select ok(has_function_privilege('service_role', 'public.revoke_general_document_link(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can revoke Document links');
select ok(has_function_privilege('service_role', 'public.archive_general_document(uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can archive Documents');

select ok(not has_function_privilege('authenticated', 'public.create_general_document(uuid,uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Document creation directly');
select ok(not has_function_privilege('authenticated', 'public.add_general_document_link(uuid,uuid,uuid,text,uuid,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Document link creation directly');
select ok(not has_function_privilege('authenticated', 'public.revoke_general_document_link(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Document link revocation directly');
select ok(not has_function_privilege('authenticated', 'public.archive_general_document(uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Document archive directly');

select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.general_document_index'::regclass), false), 'General Documents index preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_operational_summary'::regclass), false), 'Customer operational summary preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_activity'::regclass), false), 'Customer activity preserves invoker RLS');

select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='document_links_active_target_uidx'), 'Active typed links reject duplicates');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='document_links_target_lookup_idx'), 'Typed target lookup index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='document_command_receipts_document_idx'), 'Document receipt lookup index exists');

select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Members can upload workspace documents'), 'Browser storage uploads are disabled');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Managers can update workspace documents'), 'Browser storage replacement is disabled');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Managers can delete workspace documents'), 'Browser storage deletion is disabled');

select ok(
  position('document_links' in lower(pg_get_viewdef('public.customer_360_operational_summary'::regclass, true))) > 0
  and position('revoked_at is null' in lower(pg_get_viewdef('public.customer_360_operational_summary'::regclass, true))) > 0,
  'Customer operational Document counts use active typed links'
);
select ok(
  position('document_linked' in lower(pg_get_viewdef('public.customer_360_activity'::regclass, true))) > 0
  and position('document_link_revoked' in lower(pg_get_viewdef('public.customer_360_activity'::regclass, true))) > 0
  and position('document_archived' in lower(pg_get_viewdef('public.customer_360_activity'::regclass, true))) > 0,
  'Customer activity includes typed Document link and archive events'
);
select ok(
  position('document_command_receipts' in lower(pg_get_functiondef('public.create_general_document(uuid,uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Document creation stores idempotency receipts'
);
select ok(
  position('general_document_target_exists' in lower(pg_get_functiondef('public.add_general_document_link(uuid,uuid,uuid,text,uuid,text,uuid,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Document link creation validates exact source records'
);

select * from finish();
rollback;
