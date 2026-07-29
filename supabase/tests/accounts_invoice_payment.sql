begin;

select plan(63);

select has_table('public', 'invoice_lines', 'Invoice lines table exists');
select has_table('public', 'payments', 'Payment ledger exists');
select has_table('public', 'payment_allocations', 'Payment allocation ledger exists');
select has_table('public', 'accounts_command_receipts', 'Accounts command receipts exist');
select has_column('public', 'invoices', 'source_sale_id', 'Invoices reference their source Sale');
select has_column('public', 'invoices', 'currency', 'Invoices snapshot currency');
select has_column('public', 'invoices', 'total_amount', 'Invoices expose canonical totals');
select ok(exists(
  select 1 from pg_type type
  join pg_enum value on value.enumtypid = type.oid
  where type.typname = 'invoice_status' and value.enumlabel = 'void'
), 'Invoice status supports void history');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.invoices'::regclass
    and confrelid = 'public.sales'::regclass
    and conname = 'invoices_workspace_source_sale_fkey'
), 'Invoices reference canonical Sales');
select ok(exists(
  select 1 from pg_indexes
  where schemaname = 'public' and tablename = 'invoices'
    and indexname = 'invoices_workspace_active_sale_idx'
), 'One active Invoice per Sale is indexed and enforced');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.invoice_lines'::regclass
    and confrelid = 'public.invoices'::regclass
), 'Invoice lines reference canonical Invoices');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.payments'::regclass
    and confrelid = 'public.customers'::regclass
), 'Payments reference canonical Customers');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.payment_allocations'::regclass
    and confrelid = 'public.payments'::regclass
), 'Allocations reference canonical Payments');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.payment_allocations'::regclass
    and confrelid = 'public.invoices'::regclass
), 'Allocations reference canonical Invoices');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.payment_allocations'::regclass
    and conname like '%reversal_of_id%'
), 'Allocation reversals preserve their original allocation link');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.invoice_lines'::regclass
    and tgname = 'invoice_lines_enforce_mutability'
    and not tgisinternal
), 'Issued Invoice lines have a mutability guard');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.payments'::regclass
    and tgname = 'payments_enforce_mutability'
    and not tgisinternal
), 'Posted Payments have an immutability guard');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.payment_allocations'::regclass
    and tgname = 'payment_allocations_enforce_immutability'
    and not tgisinternal
), 'Payment allocations are append-only');
select has_view('public', 'invoice_account_balances', 'Derived Invoice balances view exists');
select has_view('public', 'payment_account_balances', 'Derived Payment balances view exists');
select has_view('public', 'customer_account_balances', 'Derived Customer balances view exists');
select has_view('public', 'sale_account_status', 'Derived Sale Accounts status view exists');
select ok((select relrowsecurity from pg_class where oid = 'public.invoices'::regclass), 'Invoices use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.invoice_lines'::regclass), 'Invoice lines use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.payments'::regclass), 'Payments use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.payment_allocations'::regclass), 'Payment allocations use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.accounts_command_receipts'::regclass), 'Accounts receipts use RLS');
select ok(not has_table_privilege('anon', 'public.invoices', 'SELECT'), 'Anonymous users cannot read Invoices');
select ok(has_table_privilege('authenticated', 'public.invoices', 'SELECT'), 'Authenticated users receive RLS-scoped Invoice reads');
select ok(not has_table_privilege('authenticated', 'public.invoices', 'INSERT'), 'Browser clients cannot insert Invoices directly');
select ok(not has_table_privilege('authenticated', 'public.invoices', 'UPDATE'), 'Browser clients cannot update Invoices directly');
select ok(not has_table_privilege('authenticated', 'public.invoices', 'DELETE'), 'Browser clients cannot delete Invoices directly');
select ok(not has_table_privilege('anon', 'public.payments', 'SELECT'), 'Anonymous users cannot read Payments');
select ok(has_table_privilege('authenticated', 'public.payments', 'SELECT'), 'Authenticated users receive RLS-scoped Payment reads');
select ok(not has_table_privilege('authenticated', 'public.payments', 'INSERT'), 'Browser clients cannot insert Payments directly');
select ok(not has_table_privilege('authenticated', 'public.payments', 'UPDATE'), 'Browser clients cannot update Payments directly');
select ok(has_table_privilege('authenticated', 'public.payment_allocations', 'SELECT'), 'Authenticated users receive RLS-scoped allocation reads');
select ok(not has_table_privilege('authenticated', 'public.payment_allocations', 'INSERT'), 'Browser clients cannot insert allocations directly');
select ok(not has_table_privilege('authenticated', 'public.accounts_command_receipts', 'SELECT'), 'Browser clients cannot read Accounts receipts');

select has_function(
  'public',
  'apply_invoice_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','uuid','uuid','date','text','text','jsonb','text'],
  'Trusted Invoice command exists'
);
select has_function(
  'public',
  'record_payment',
  array['uuid','uuid','text','uuid','uuid','uuid','numeric','text','timestamp with time zone','text','text','jsonb'],
  'Trusted Payment recording command exists'
);
select has_function(
  'public',
  'allocate_payment',
  array['uuid','uuid','uuid','uuid','numeric','text','uuid','uuid','timestamp with time zone'],
  'Trusted Payment allocation command exists'
);
select has_function(
  'public',
  'reverse_payment_allocation',
  array['uuid','uuid','uuid','text','uuid','uuid','text','timestamp with time zone'],
  'Trusted allocation reversal command exists'
);
select has_function(
  'public',
  'reverse_payment',
  array['uuid','uuid','text','uuid','uuid','text'],
  'Trusted Payment reversal command exists'
);
select ok((
  select prosecdef from pg_proc
  where oid = 'public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure
), 'Invoice command is security definer');
select ok((
  select prosecdef from pg_proc
  where oid = 'public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb)'::regprocedure
), 'Payment recording is security definer');
select ok(not has_function_privilege(
  'authenticated',
  'public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)',
  'EXECUTE'
), 'Browser clients cannot execute Invoice commands directly');
select ok(has_function_privilege(
  'service_role',
  'public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)',
  'EXECUTE'
), 'Service role can execute Invoice commands');
select ok(not has_function_privilege(
  'authenticated',
  'public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb)',
  'EXECUTE'
), 'Browser clients cannot record Payments directly');
select ok(has_function_privilege(
  'service_role',
  'public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb)',
  'EXECUTE'
), 'Service role can record Payments');
select ok(position(
  'This Sale already has an active Invoice' in
  pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure)
) > 0, 'Sale invoicing blocks duplicate active Invoices');
select ok(position(
  'Only draft Invoices can be issued' in
  pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure)
) > 0, 'Only draft Invoices can be issued');
select ok(position(
  'Reverse Invoice Payment allocations before voiding' in
  pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure)
) > 0, 'Invoice voiding protects active allocations');
select ok(position(
  'accounts_command_receipts' in
  pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure)
) > 0, 'Invoice command stores idempotency receipts');
select ok(position(
  'Payment allocation exceeds the unallocated Payment amount' in
  pg_get_functiondef('private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)'::regprocedure)
) > 0, 'Allocation cannot exceed available Payment credit');
select ok(position(
  'Payment and Invoice must belong to the same Customer' in
  pg_get_functiondef('private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)'::regprocedure)
) > 0, 'Allocation cannot cross Customers');
select ok(position(
  'Payment and Invoice currencies must match' in
  pg_get_functiondef('private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)'::regprocedure)
) > 0, 'Allocation cannot cross currencies');
select ok(position(
  'already been reversed' in
  pg_get_functiondef('public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'An allocation can be reversed only once');
select ok(position(
  'Reverse Payment allocations before reversing the Payment' in
  pg_get_functiondef('public.reverse_payment(uuid,uuid,text,uuid,uuid,text)'::regprocedure)
) > 0, 'Payments cannot reverse while allocated');
select ok(
  position('insert into public.bank_transactions' in lower(pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure))) = 0
  and position('insert into public.bank_transactions' in lower(pg_get_functiondef('public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb)'::regprocedure))) = 0,
  'Invoice and Payment commands never create Banking transactions'
);
select ok(
  position('activity_items' in pg_get_functiondef('public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure)) > 0
  and position('activity_items' in pg_get_functiondef('public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb)'::regprocedure)) > 0,
  'Invoice and Payment commands write Activity history'
);
select ok((
  select count(*) = 4
  from pg_class
  where oid in (
    'public.invoice_account_balances'::regclass,
    'public.payment_account_balances'::regclass,
    'public.customer_account_balances'::regclass,
    'public.sale_account_status'::regclass
  )
  and reloptions @> array['security_invoker=true']
), 'All Accounts balance views execute as the caller');
select ok(exists(
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'payment_allocations'
    and indexname = 'payment_allocations_one_reversal_idx'
), 'One reversal per allocation is enforced');

select * from finish();
rollback;
