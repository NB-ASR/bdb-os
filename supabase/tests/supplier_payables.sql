begin;

select plan(40);

select has_table('public', 'supplier_payables', 'Supplier payable ledger exists');
select has_table('public', 'supplier_payments', 'Supplier Payment ledger exists');
select has_table('public', 'supplier_payment_allocations', 'Supplier Payment allocation ledger exists');
select has_table('public', 'supplier_credit_allocations', 'Supplier credit allocation ledger exists');
select has_table('public', 'supplier_accounts_command_receipts', 'Supplier Accounts command receipts exist');

select has_view('public', 'supplier_payable_balances', 'Supplier payable balance view exists');
select has_view('public', 'supplier_payment_balances', 'Supplier Payment balance view exists');
select has_view('public', 'supplier_account_balances', 'Supplier account balance view exists');

select has_function('public', 'post_supplier_document_payable', array['uuid','uuid','uuid','text','uuid','uuid'], 'Supplier document payable posting command exists');
select has_function('public', 'reverse_supplier_payable', array['uuid','uuid','text','uuid','uuid','text'], 'Supplier payable reversal command exists');
select has_function('public', 'record_supplier_payment', array['uuid','uuid','text','uuid','uuid','uuid','text','numeric','text','timestamp with time zone','text','text'], 'Supplier Payment recording command exists');
select has_function('public', 'allocate_supplier_payment', array['uuid','uuid','uuid','uuid','numeric','text','uuid','uuid','timestamp with time zone'], 'Supplier Payment allocation command exists');
select has_function('public', 'reverse_supplier_payment_allocation', array['uuid','uuid','uuid','text','uuid','uuid','text','timestamp with time zone'], 'Supplier Payment allocation reversal exists');
select has_function('public', 'reverse_supplier_payment', array['uuid','uuid','text','uuid','uuid','text'], 'Supplier Payment reversal exists');
select has_function('public', 'allocate_supplier_credit', array['uuid','uuid','uuid','uuid','numeric','text','uuid','uuid','timestamp with time zone'], 'Supplier credit allocation command exists');
select has_function('public', 'reverse_supplier_credit_allocation', array['uuid','uuid','uuid','text','uuid','uuid','text','timestamp with time zone'], 'Supplier credit allocation reversal exists');

select ok((select relrowsecurity from pg_class where oid = 'public.supplier_payables'::regclass), 'Supplier payables use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_payments'::regclass), 'Supplier Payments use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_payment_allocations'::regclass), 'Supplier Payment allocations use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_credit_allocations'::regclass), 'Supplier credit allocations use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_accounts_command_receipts'::regclass), 'Supplier Accounts receipts use RLS');

select ok(not has_table_privilege('authenticated', 'public.supplier_payables', 'INSERT'), 'Browser clients cannot insert Supplier payables');
select ok(not has_table_privilege('authenticated', 'public.supplier_payables', 'UPDATE'), 'Browser clients cannot update Supplier payables');
select ok(not has_table_privilege('authenticated', 'public.supplier_payables', 'DELETE'), 'Browser clients cannot delete Supplier payables');
select ok(not has_table_privilege('authenticated', 'public.supplier_payments', 'INSERT'), 'Browser clients cannot insert Supplier Payments');
select ok(not has_table_privilege('authenticated', 'public.supplier_payments', 'UPDATE'), 'Browser clients cannot update Supplier Payments');
select ok(not has_table_privilege('authenticated', 'public.supplier_payments', 'DELETE'), 'Browser clients cannot delete Supplier Payments');

select ok(has_table_privilege('authenticated', 'public.supplier_payables', 'SELECT'), 'Authenticated users retain RLS-scoped Supplier payable reads');
select ok(has_table_privilege('authenticated', 'public.supplier_payments', 'SELECT'), 'Authenticated users retain RLS-scoped Supplier Payment reads');
select ok(has_table_privilege('authenticated', 'public.supplier_payment_allocations', 'SELECT'), 'Authenticated users retain RLS-scoped Payment allocation reads');
select ok(has_table_privilege('authenticated', 'public.supplier_credit_allocations', 'SELECT'), 'Authenticated users retain RLS-scoped credit allocation reads');

select ok(has_function_privilege('service_role', 'public.post_supplier_document_payable(uuid,uuid,uuid,text,uuid,uuid)', 'EXECUTE'), 'Service role can post Supplier documents to AP');
select ok(has_function_privilege('service_role', 'public.reverse_supplier_payable(uuid,uuid,text,uuid,uuid,text)', 'EXECUTE'), 'Service role can reverse Supplier payables');
select ok(has_function_privilege('service_role', 'public.record_supplier_payment(uuid,uuid,text,uuid,uuid,uuid,text,numeric,text,timestamp with time zone,text,text)', 'EXECUTE'), 'Service role can record Supplier Payments');
select ok(has_function_privilege('service_role', 'public.allocate_supplier_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can allocate Supplier Payments');
select ok(has_function_privilege('service_role', 'public.reverse_supplier_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)', 'EXECUTE'), 'Service role can reverse Supplier Payment allocations');
select ok(has_function_privilege('service_role', 'public.reverse_supplier_payment(uuid,uuid,text,uuid,uuid,text)', 'EXECUTE'), 'Service role can reverse Supplier Payments');
select ok(has_function_privilege('service_role', 'public.allocate_supplier_credit(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can allocate Supplier credits');
select ok(has_function_privilege('service_role', 'public.reverse_supplier_credit_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)', 'EXECUTE'), 'Service role can reverse Supplier credit allocations');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'supplier_payables'
      and indexname = 'supplier_payables_active_document_idx'
  ),
  'One active payable posting per Supplier document is enforced'
);

select * from finish();
rollback;
