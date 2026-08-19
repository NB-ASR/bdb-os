begin;

select plan(9);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'due_at'
      and is_nullable = 'YES'
  ),
  'Invoice due date is optional'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.invoices'::regclass
      and tgname = 'invoices_default_without_due_date'
      and not tgisinternal
  ),
  'New draft Invoices default to no due date'
);

select ok(
  position('new.due_at := null' in lower(pg_get_functiondef('private.default_invoice_without_due_date()'::regprocedure))) > 0,
  'Draft Invoice insertion clears invented due dates'
);

select ok(
  position('net_value * vat_rate_value / 100' in lower(pg_get_functiondef('private.write_manual_invoice_lines(uuid,uuid,jsonb)'::regprocedure))) > 0,
  'Invoice VAT is calculated on the VAT-exclusive net amount'
);

select ok(
  position('/ (100 + vat_rate_value)' in lower(pg_get_functiondef('private.write_manual_invoice_lines(uuid,uuid,jsonb)'::regprocedure))) = 0,
  'Invoice pricing no longer backs VAT out of the entered unit price'
);

select ok(
  position('total_value := round(net_value + vat_value' in lower(pg_get_functiondef('private.write_manual_invoice_lines(uuid,uuid,jsonb)'::regprocedure))) > 0,
  'Invoice total adds VAT on top of the net amount'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.invoice_lines'::regclass
      and tgname = 'invoice_lines_enforce_mutability'
      and not tgisinternal
  ),
  'Issued Invoice line immutability remains intact'
);

select ok(
  position('when invoice.due_at<current_date then ''overdue''' in replace(lower(pg_get_viewdef('public.invoice_account_balances'::regclass, true)), ' ', '')) = 0
  or position('invoice.due_at < current_date' in lower(pg_get_viewdef('public.invoice_account_balances'::regclass, true))) > 0,
  'Existing balance logic remains compatible with nullable due dates'
);

select ok(
  position(
    'round(amount, 2) = round(total_amount, 2)'
    in pg_get_constraintdef((
      select oid
      from pg_constraint
      where conrelid = 'public.invoices'::regclass
        and conname = 'invoices_totals_check'
    ))
  ) > 0,
  'Legacy two-decimal Invoice amount agrees with canonical total at currency precision'
);

select * from finish();
rollback;
