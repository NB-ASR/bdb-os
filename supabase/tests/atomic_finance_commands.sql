begin;

select plan(8);

select ok(
  to_regprocedure('public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text)') is not null,
  'atomic invoice command exists'
);
select ok(
  to_regprocedure('public.reconcile_bank_transaction(uuid,uuid,uuid)') is not null,
  'atomic reconciliation command exists'
);
select ok(
  not has_function_privilege('anon', 'public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text)', 'EXECUTE'),
  'anonymous callers cannot create invoices'
);
select ok(
  has_function_privilege('authenticated', 'public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text)', 'EXECUTE'),
  'authenticated members use the permission-checked invoice command'
);
select ok(
  not has_function_privilege('anon', 'public.reconcile_bank_transaction(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot reconcile finances'
);
select ok(
  has_function_privilege('authenticated', 'public.reconcile_bank_transaction(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated members use the permission-checked reconciliation command'
);
select ok(
  position(
    'FOR UPDATE' in upper(pg_get_functiondef('public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text)'::regprocedure))
  ) > 0,
  'invoice numbering is serialised per workspace'
);
select ok(
  position(
    'UPDATE PUBLIC.BANK_TRANSACTIONS' in upper(pg_get_functiondef('public.reconcile_bank_transaction(uuid,uuid,uuid)'::regprocedure))
  ) > 0
  and position(
    'UPDATE PUBLIC.INVOICES' in upper(pg_get_functiondef('public.reconcile_bank_transaction(uuid,uuid,uuid)'::regprocedure))
  ) > 0,
  'transaction and invoice state share one atomic command'
);

select * from finish();
rollback;
