begin;

select plan(36);

select has_table('public', 'customer_notes', 'Customer note ledger exists');
select has_table('public', 'customer_note_command_receipts', 'Customer note command receipts exist');

select has_view('public', 'customer_note_status', 'Customer note status view exists');
select has_view('public', 'customer_360_financial_summary', 'Customer 360 financial summary exists');
select has_view('public', 'customer_360_operational_summary', 'Customer 360 operational summary exists');
select has_view('public', 'customer_360_activity', 'Customer 360 activity view exists');

select has_function('public', 'create_customer_note', array['uuid','uuid','uuid','text','text','uuid','uuid','timestamp with time zone'], 'Customer note creation command exists');
select has_function('public', 'void_customer_note', array['uuid','uuid','uuid','uuid','text','text','uuid','uuid','timestamp with time zone'], 'Customer note void command exists');
select has_function('public', 'get_customer_360_access', array['uuid'], 'Customer 360 access function exists');

select ok((select relrowsecurity from pg_class where oid = 'public.customer_notes'::regclass), 'Customer notes use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.customer_note_command_receipts'::regclass), 'Customer note receipts use RLS');

select ok(not has_table_privilege('authenticated', 'public.customer_notes', 'INSERT'), 'Browser clients cannot insert Customer notes');
select ok(not has_table_privilege('authenticated', 'public.customer_notes', 'UPDATE'), 'Browser clients cannot update Customer notes');
select ok(not has_table_privilege('authenticated', 'public.customer_notes', 'DELETE'), 'Browser clients cannot delete Customer notes');
select ok(has_table_privilege('authenticated', 'public.customer_notes', 'SELECT'), 'Authenticated users retain RLS-scoped Customer note reads');

select ok(not has_table_privilege('authenticated', 'public.customer_note_command_receipts', 'INSERT'), 'Browser clients cannot insert Customer note receipts');
select ok(not has_table_privilege('authenticated', 'public.customer_note_command_receipts', 'SELECT'), 'Browser clients cannot read Customer note receipts');
select ok(not has_table_privilege('authenticated', 'public.customer_note_command_receipts', 'UPDATE'), 'Browser clients cannot update Customer note receipts');

select ok(has_function_privilege('service_role', 'public.create_customer_note(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can create Customer notes');
select ok(has_function_privilege('service_role', 'public.void_customer_note(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can void Customer notes');
select ok(not has_function_privilege('authenticated', 'public.create_customer_note(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Customer note creation directly');
select ok(not has_function_privilege('authenticated', 'public.void_customer_note(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Authenticated clients cannot execute Customer note voiding directly');

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.customer_notes'::regclass
      and tgname = 'customer_notes_immutable'
      and not tgisinternal
  ),
  'Customer note immutability trigger exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'customer_notes'
      and indexname = 'customer_notes_one_void_per_note_idx'
  ),
  'One void record per Customer note is enforced'
);

select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bookings_customer_activity_idx'), 'Customer Appointment activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sales_customer_activity_idx'), 'Customer Sale activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_customer_activity_idx'), 'Customer Invoice activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'payments_customer_activity_idx'), 'Customer Payment activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'documents_customer_activity_idx'), 'Customer Document activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'messages_customer_activity_idx'), 'Customer Communication activity index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'activity_items_customer_entity_idx'), 'Customer lifecycle activity index exists');

select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_note_status'::regclass), false), 'Customer note status preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_financial_summary'::regclass), false), 'Customer financial summary preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_operational_summary'::regclass), false), 'Customer operational summary preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_activity'::regclass), false), 'Customer activity preserves invoker RLS');
select ok(has_function_privilege('authenticated', 'public.get_customer_360_access(uuid)', 'EXECUTE'), 'Authenticated users can resolve their Customer 360 section access');

select * from finish();
rollback;
