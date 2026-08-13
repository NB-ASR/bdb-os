begin;

select plan(50);

select has_table('public', 'bank_accounts', 'Bank account catalogue exists');
select has_table('public', 'bank_statement_imports', 'Bank statement import ledger exists');
select has_table('public', 'bank_transactions', 'Canonical Bank transaction catalogue remains in place');
select has_table('public', 'bank_reconciliation_allocations', 'Bank reconciliation allocation ledger exists');
select has_table('public', 'banking_command_receipts', 'Banking command receipts exist');

select has_view('public', 'bank_transaction_reconciliation_balances', 'Bank transaction reconciliation balance view exists');
select has_view('public', 'customer_payment_reconciliation_balances', 'Customer Payment Bank reconciliation view exists');
select has_view('public', 'supplier_payment_reconciliation_balances', 'Supplier Payment Bank reconciliation view exists');
select has_view('public', 'bank_account_reconciliation_summaries', 'Bank account reconciliation summary view exists');

select has_function('public', 'create_bank_account', array['uuid','uuid','text','uuid','uuid','text','text','text','text','text'], 'Bank account creation command exists');
select has_function('public', 'update_bank_account', array['uuid','uuid','integer','text','uuid','uuid','text','text','text'], 'Bank account update command exists');
select has_function('public', 'archive_bank_account', array['uuid','uuid','integer','text','uuid','uuid'], 'Bank account archive command exists');
select has_function('public', 'import_bank_statement', array['uuid','uuid','text','uuid','uuid','uuid','text','text','jsonb'], 'Bank statement import command exists');
select has_function('public', 'reconcile_bank_transaction', array['uuid','uuid','uuid','text','uuid','numeric','text','uuid','uuid','timestamp with time zone'], 'Bank transaction reconciliation command exists');
select has_function('public', 'reverse_bank_reconciliation', array['uuid','uuid','uuid','text','uuid','uuid','text','timestamp with time zone'], 'Bank reconciliation reversal command exists');
select has_function('public', 'reverse_bank_transaction', array['uuid','uuid','text','uuid','uuid','text'], 'Bank transaction reversal command exists');

select ok((select relrowsecurity from pg_class where oid = 'public.bank_accounts'::regclass), 'Bank accounts use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.bank_statement_imports'::regclass), 'Bank statement imports use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.bank_reconciliation_allocations'::regclass), 'Bank reconciliation allocations use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.banking_command_receipts'::regclass), 'Banking command receipts use RLS');

select ok(not has_table_privilege('authenticated', 'public.bank_accounts', 'INSERT'), 'Browser clients cannot insert Bank accounts');
select ok(not has_table_privilege('authenticated', 'public.bank_accounts', 'UPDATE'), 'Browser clients cannot update Bank accounts');
select ok(not has_table_privilege('authenticated', 'public.bank_accounts', 'DELETE'), 'Browser clients cannot delete Bank accounts');
select ok(not has_table_privilege('authenticated', 'public.bank_statement_imports', 'INSERT'), 'Browser clients cannot insert Bank statement imports');
select ok(not has_table_privilege('authenticated', 'public.bank_statement_imports', 'UPDATE'), 'Browser clients cannot update Bank statement imports');
select ok(not has_table_privilege('authenticated', 'public.bank_statement_imports', 'DELETE'), 'Browser clients cannot delete Bank statement imports');

select ok(not has_table_privilege('authenticated', 'public.bank_transactions', 'INSERT'), 'Browser clients cannot insert Bank transactions');
select ok(not has_table_privilege('authenticated', 'public.bank_transactions', 'UPDATE'), 'Browser clients cannot update Bank transactions');
select ok(not has_table_privilege('authenticated', 'public.bank_transactions', 'DELETE'), 'Browser clients cannot delete Bank transactions');
select ok(has_table_privilege('authenticated', 'public.bank_transactions', 'SELECT'), 'Authenticated users retain RLS-scoped Bank transaction reads');

select ok(not has_table_privilege('authenticated', 'public.bank_reconciliation_allocations', 'INSERT'), 'Browser clients cannot insert Bank reconciliation allocations');
select ok(not has_table_privilege('authenticated', 'public.bank_reconciliation_allocations', 'UPDATE'), 'Browser clients cannot update Bank reconciliation allocations');
select ok(not has_table_privilege('authenticated', 'public.bank_reconciliation_allocations', 'DELETE'), 'Browser clients cannot delete Bank reconciliation allocations');

select ok(has_table_privilege('authenticated', 'public.bank_accounts', 'SELECT'), 'Authenticated users retain RLS-scoped Bank account reads');
select ok(has_table_privilege('authenticated', 'public.bank_statement_imports', 'SELECT'), 'Authenticated users retain RLS-scoped statement import reads');
select ok(has_table_privilege('authenticated', 'public.bank_reconciliation_allocations', 'SELECT'), 'Authenticated users retain RLS-scoped reconciliation reads');

select ok(has_function_privilege('service_role', 'public.create_bank_account(uuid,uuid,text,uuid,uuid,text,text,text,text,text)', 'EXECUTE'), 'Service role can create Bank accounts');
select ok(has_function_privilege('service_role', 'public.update_bank_account(uuid,uuid,integer,text,uuid,uuid,text,text,text)', 'EXECUTE'), 'Service role can update Bank accounts');
select ok(has_function_privilege('service_role', 'public.archive_bank_account(uuid,uuid,integer,text,uuid,uuid)', 'EXECUTE'), 'Service role can archive Bank accounts');
select ok(has_function_privilege('service_role', 'public.import_bank_statement(uuid,uuid,text,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'Service role can import Bank statements');
select ok(has_function_privilege('service_role', 'public.reconcile_bank_transaction(uuid,uuid,uuid,text,uuid,numeric,text,uuid,uuid,timestamp with time zone)', 'EXECUTE'), 'Service role can reconcile Bank transactions');
select ok(has_function_privilege('service_role', 'public.reverse_bank_reconciliation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)', 'EXECUTE'), 'Service role can reverse Bank reconciliations');
select ok(has_function_privilege('service_role', 'public.reverse_bank_transaction(uuid,uuid,text,uuid,uuid,text)', 'EXECUTE'), 'Service role can reverse Bank transactions');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'bank_transactions'
      and indexname = 'bank_transactions_fingerprint_unique_idx'
  ),
  'Transaction fingerprints are unique per Bank account'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'bank_statement_imports'
      and indexdef ilike '%source_file_hash%'
  ),
  'Statement file hashes have duplicate protection'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'bank_reconciliation_allocations'
      and indexname = 'bank_reconciliation_one_reversal_idx'
  ),
  'One reversal per original Bank reconciliation is enforced'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.bank_transactions'::regclass
      and tgname = 'bank_transactions_enforce_immutability'
      and not tgisinternal
  ),
  'Imported Bank transaction immutability trigger exists'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.bank_reconciliation_allocations'::regclass
      and tgname = 'bank_reconciliation_allocations_enforce_immutability'
      and not tgisinternal
  ),
  'Bank reconciliation append-only trigger exists'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_prevent_reconciled_reversal'
      and not tgisinternal
  ),
  'Customer Payment reversal guard includes Bank reconciliation'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.supplier_payments'::regclass
      and tgname = 'supplier_payments_prevent_reconciled_reversal'
      and not tgisinternal
  ),
  'Supplier Payment reversal guard includes Bank reconciliation'
);

select * from finish();
rollback;
