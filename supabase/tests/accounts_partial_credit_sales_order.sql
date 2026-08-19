begin;

select plan(9);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'sales_order_reference'
  ),
  'Invoices store a Sales Order reference'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'credit_notes'
      and column_name = 'sales_order_reference'
  ),
  'Credit Notes store the inherited Sales Order reference'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.invoices'::regclass
      and tgname = 'invoices_require_sales_order'
      and not tgisinternal
  ),
  'Product Invoice issue has an SO enforcement trigger'
);

select ok(
  position(
    'line.line_type = ''product'''
    in lower(pg_get_functiondef('private.enforce_invoice_sales_order_on_issue()'::regprocedure))
  ) > 0,
  'SO enforcement is specifically driven by Product lines'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.credit_notes'::regclass
      and tgname = 'credit_notes_snapshot_sales_order'
      and not tgisinternal
  ),
  'Credit Notes automatically snapshot the Invoice SO reference'
);

select ok(
  position(
    'allocation_factor := target_amount / remaining_source_total'
    in lower(pg_get_functiondef('private.write_credit_note_amount_lines(uuid,uuid,uuid,numeric)'::regprocedure))
  ) > 0,
  'Historical amount-credit implementation remains readable for migration history'
);

select ok(
  position(
    'totals.total <> target_amount'
    in lower(pg_get_functiondef('private.write_credit_note_amount_lines(uuid,uuid,uuid,numeric)'::regprocedure))
  ) > 0,
  'Historical amount-credit implementation retains its exact-allocation safeguard'
);

select ok(
  position(
    'credit notes cannot deduct an arbitrary amount'
    in lower(pg_get_functiondef('private.write_credit_note_lines(uuid,uuid,uuid,jsonb)'::regprocedure))
  ) > 0
  and position(
    'write_credit_note_lines_by_quantity'
    in lower(pg_get_functiondef('private.write_credit_note_lines(uuid,uuid,uuid,jsonb)'::regprocedure))
  ) > 0,
  'Credit Note writer rejects money-first commands and uses the quantity-backed path'
);

select ok(
  position(
    'sales_order_reference'
    in lower(pg_get_viewdef('public.invoice_account_balances'::regclass, true))
  ) > 0,
  'Accounts Invoice reads expose the SO reference'
);

select * from finish();
rollback;
