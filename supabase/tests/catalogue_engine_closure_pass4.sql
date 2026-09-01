begin;

select plan(29);

-- Catalogue owns canonical Product, Service and Product <-> Supplier identity.
-- Downstream engines reference those records with workspace-scoped foreign keys
-- and own their own operational/financial truth.
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.product_suppliers'::regclass
      and c.confrelid='public.products'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, product_id)%'
  ),
  'Product Supplier relationships reference the canonical Product in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.product_suppliers'::regclass
      and c.confrelid='public.suppliers'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, supplier_id)%'
  ),
  'Product Supplier relationships reference the canonical Supplier in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.supplier_document_lines'::regclass
      and c.confrelid='public.products'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, matched_product_id)%'
  ),
  'Purchasing document lines match the canonical Product in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.supplier_document_lines'::regclass
      and c.confrelid='public.product_suppliers'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, matched_product_supplier_id)%'
  ),
  'Purchasing document lines can retain the canonical Product Supplier relationship'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_movements'::regclass
      and c.confrelid='public.products'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, product_id)%'
  ),
  'Inventory movements reference the canonical Product while Inventory owns quantity'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sale_lines'::regclass
      and c.confrelid='public.products'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, product_id)%'
  ),
  'Sales Product lines reference the canonical Product in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sale_lines'::regclass
      and c.confrelid='public.services'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, service_id)%'
  ),
  'Sales Service lines reference the canonical Service in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.invoice_lines'::regclass
      and c.confrelid='public.products'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, product_id)%'
  ),
  'Accounts Product invoice lines reference the canonical Product in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.invoice_lines'::regclass
      and c.confrelid='public.services'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, service_id)%'
  ),
  'Accounts Service invoice lines reference the canonical Service in the same workspace'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.bookings'::regclass
      and c.confrelid='public.services'::regclass
      and c.contype='f'
      and pg_get_constraintdef(c.oid) ilike '%foreign key (workspace_id, service_id)%'
  ),
  'Calendar Appointments reference the canonical Service in the same workspace'
);

-- Sales and Accounts retain historical commercial facts instead of re-reading
-- mutable Catalogue values after the transaction/document has been created.
select has_column('public','sale_lines','code_snapshot','Sales retain the Catalogue code used at transaction time');
select has_column('public','sale_lines','description_snapshot','Sales retain the Catalogue description used at transaction time');
select has_column('public','sale_lines','unit_price','Sales own the transaction unit price');
select has_column('public','sale_lines','vat_rate','Sales own the transaction VAT rate');
select has_column('public','invoice_lines','code_snapshot','Accounts retain the Catalogue code used on the document');
select has_column('public','invoice_lines','description_snapshot','Accounts retain the Catalogue description used on the document');
select has_column('public','invoice_lines','unit_price','Accounts own the document unit price');
select has_column('public','invoice_lines','vat_rate','Accounts own the document VAT rate');
select has_column('public','bookings','service_code_snapshot','Calendar retains the booked Service code snapshot');
select has_column('public','bookings','price_snapshot','Calendar retains the booked Service price snapshot');
select has_column('public','bookings','duration_minutes','Calendar owns the booked duration snapshot used for availability');

select ok(
  pg_get_viewdef('public.inventory_product_totals'::regclass, true) ilike '%inventory_movements%'
  and pg_get_viewdef('public.inventory_product_totals'::regclass, true) ilike '%products%',
  'Inventory quantity is derived from the Inventory movement ledger while Product metadata remains canonical'
);
select ok(
  pg_get_viewdef('public.customer_360_operational_summary'::regclass, true) ilike '%bookings%'
  and pg_get_viewdef('public.customer_360_operational_summary'::regclass, true) ilike '%sales%',
  'Customer 360 operational history composes Calendar and Sales records instead of duplicating Catalogue state'
);
select ok(
  pg_get_viewdef('public.customer_360_financial_summary'::regclass, true) ilike '%customer_account_balances%',
  'Customer 360 financial history reads the frozen Accounts balance model rather than creating Catalogue financial truth'
);

-- Catalogue lifecycle commands may mutate Catalogue masters, receipts and activity,
-- but must never silently post stock, transactions, financial documents or bookings.
select ok(
  lower(pg_get_functiondef('public.apply_product_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text)'::regprocedure)) not like '%insert into public.inventory_movements%'
  and lower(pg_get_functiondef('public.apply_product_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text)'::regprocedure)) not like '%insert into public.sales%'
  and lower(pg_get_functiondef('public.apply_product_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text)'::regprocedure)) not like '%insert into public.invoices%'
  and lower(pg_get_functiondef('public.apply_product_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text)'::regprocedure)) not like '%insert into public.bookings%',
  'Product lifecycle commands cannot silently create Inventory, Sales, Accounts or Calendar records'
);
select ok(
  lower(pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) not like '%insert into public.inventory_movements%'
  and lower(pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) not like '%insert into public.sales%'
  and lower(pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) not like '%insert into public.invoices%'
  and lower(pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) not like '%insert into public.bookings%',
  'Service lifecycle commands cannot silently create Inventory, Sales, Accounts or Calendar records'
);
select ok(
  lower(pg_get_functiondef('public.apply_product_supplier_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,text,numeric,text,boolean,integer,numeric,text)'::regprocedure)) not like '%insert into public.inventory_movements%'
  and lower(pg_get_functiondef('public.apply_product_supplier_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,text,numeric,text,boolean,integer,numeric,text)'::regprocedure)) not like '%insert into public.sales%'
  and lower(pg_get_functiondef('public.apply_product_supplier_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,text,numeric,text,boolean,integer,numeric,text)'::regprocedure)) not like '%insert into public.invoices%'
  and lower(pg_get_functiondef('public.apply_product_supplier_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,text,numeric,text,boolean,integer,numeric,text)'::regprocedure)) not like '%insert into public.bookings%',
  'Product Supplier lifecycle commands cannot silently post downstream business records'
);

select ok(
  exists (select 1 from pg_constraint where conrelid='public.sale_lines'::regclass and conname='sale_lines_identity_shape' and contype='c'),
  'Sales line identity remains exactly one canonical Product or Service'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='public.invoice_lines'::regclass and conname='invoice_lines_identity_shape' and contype='c'),
  'Accounts line identity remains Product, Service or explicit manual line without a parallel Catalogue identity'
);

select * from finish();
rollback;
