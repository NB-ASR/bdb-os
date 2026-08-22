begin;

select plan(28);

select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='supplier_documents' and indexname='supplier_documents_accounts_cursor_idx'
), 'Supplier document Accounts register has a cursor index');
select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='supplier_payables' and indexname='supplier_payables_register_cursor_idx'
), 'Supplier payable register has a cursor index');
select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='supplier_payments' and indexname='supplier_payments_register_cursor_idx'
), 'Supplier Payment register has a cursor index');
select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='supplier_payment_allocations' and indexname='supplier_payment_allocations_workspace_time_idx'
), 'Supplier Payment allocation history has a workspace/time index');
select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='supplier_credit_allocations' and indexname='supplier_credit_allocations_workspace_time_idx'
), 'Supplier credit allocation history has a workspace/time index');
select ok(exists(
  select 1 from pg_indexes where schemaname='public' and tablename='suppliers' and indexname='suppliers_active_search_idx'
), 'Active Supplier search has a bounded lookup index');
select has_function('public','get_supplier_accounts_summary',array['uuid'],'Supplier Accounts summary function exists');
select ok(not has_function_privilege('authenticated','public.get_supplier_accounts_summary(uuid)','EXECUTE'),'Browser roles cannot bypass the Supplier summary server boundary');
select ok(has_function_privilege('service_role','public.get_supplier_accounts_summary(uuid)','EXECUTE'),'Service role can read the Supplier Accounts summary');

select ok(position(
  'for update'
  in lower(pg_get_functiondef('public.allocate_supplier_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone)'::regprocedure))
) > 0, 'Supplier Payment allocation locks financial source rows before capacity checks');
select ok(position(
  'for update'
  in lower(pg_get_functiondef('public.allocate_supplier_credit(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone)'::regprocedure))
) > 0, 'Supplier credit allocation locks financial source rows before capacity checks');
select ok(position(
  'for update'
  in lower(pg_get_functiondef('public.post_supplier_document_payable(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure))
) > 0, 'Supplier document posting locks the source document before posting');

insert into auth.users(id,email)
values ('a0000000-0000-4000-8000-000000000001'::uuid,'accounts-pass4@bdb.invalid');

insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
select id,'a0000000-0000-4000-8000-000000000001'::uuid,'owner','active','owner',now()
from public.workspaces where slug='bdb-os';

insert into public.suppliers(id,workspace_id,code,name,supplier_type,document_currency)
select fixture.id, workspace.id, fixture.code, fixture.name, 'expense', fixture.currency
from public.workspaces workspace
cross join (values
  ('b0000000-0000-4000-8000-000000000001'::uuid,'PASS4-S1','Pass 4 Supplier One','EUR'),
  ('b0000000-0000-4000-8000-000000000002'::uuid,'PASS4-S2','Pass 4 Supplier Two','EUR')
) as fixture(id,code,name,currency)
where workspace.slug='bdb-os';

insert into public.documents(id,workspace_id,name,document_type,size_label,linked_to,created_by)
select fixture.id, workspace.id, fixture.name, 'Supplier invoice', '1 KB', 'Supplier Accounts', 'a0000000-0000-4000-8000-000000000001'::uuid
from public.workspaces workspace
cross join (values
  ('c0000000-0000-4000-8000-000000000001'::uuid,'Pass 4 Invoice 1'),
  ('c0000000-0000-4000-8000-000000000002'::uuid,'Pass 4 Invoice 2'),
  ('c0000000-0000-4000-8000-000000000003'::uuid,'Pass 4 Credit 1'),
  ('c0000000-0000-4000-8000-000000000004'::uuid,'Pass 4 Invoice 3')
) as fixture(id,name)
where workspace.slug='bdb-os';

insert into public.supplier_documents(
  id,workspace_id,supplier_id,document_type,document_number,document_date,due_date,currency,
  subtotal_before_discount,discount_amount,net_after_discount,vat_rate,vat_amount,gross_amount,
  file_path,file_name,mime_type,file_size,file_sha256,status,extraction_status,
  accounts_posting_status,approved_at,approved_by,created_by,updated_by
)
select
  fixture.id,
  workspace.id,
  fixture.supplier_id,
  fixture.document_type,
  fixture.document_number,
  current_date,
  case when fixture.document_type='invoice' then current_date + 30 else null end,
  'EUR',
  fixture.amount,
  0,
  fixture.amount,
  0,
  0,
  fixture.amount,
  workspace.id::text || '/pass4/' || fixture.file_name,
  fixture.file_name,
  'application/pdf',
  1024,
  repeat(fixture.hash_character,64),
  'approved',
  'completed',
  'ready',
  now(),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'a0000000-0000-4000-8000-000000000001'::uuid
from public.workspaces workspace
cross join (values
  ('c0000000-0000-4000-8000-000000000001'::uuid,'b0000000-0000-4000-8000-000000000001'::uuid,'invoice','PASS4-INV-1',100::numeric,'inv1.pdf','1'),
  ('c0000000-0000-4000-8000-000000000002'::uuid,'b0000000-0000-4000-8000-000000000001'::uuid,'invoice','PASS4-INV-2',80::numeric,'inv2.pdf','2'),
  ('c0000000-0000-4000-8000-000000000003'::uuid,'b0000000-0000-4000-8000-000000000001'::uuid,'credit_note','PASS4-CN-1',50::numeric,'credit1.pdf','3'),
  ('c0000000-0000-4000-8000-000000000004'::uuid,'b0000000-0000-4000-8000-000000000002'::uuid,'invoice','PASS4-INV-3',100::numeric,'inv3.pdf','4')
) as fixture(id,supplier_id,document_type,document_number,amount,file_name,hash_character)
where workspace.slug='bdb-os';

select public.post_supplier_document_payable(
  (select id from public.workspaces where slug='bdb-os'),
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'pass4-post-1',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000001'::uuid
);
select public.post_supplier_document_payable(
  (select id from public.workspaces where slug='bdb-os'),
  'd0000000-0000-4000-8000-000000000002'::uuid,
  'c0000000-0000-4000-8000-000000000002'::uuid,
  'pass4-post-2',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000002'::uuid
);
select public.post_supplier_document_payable(
  (select id from public.workspaces where slug='bdb-os'),
  'd0000000-0000-4000-8000-000000000003'::uuid,
  'c0000000-0000-4000-8000-000000000003'::uuid,
  'pass4-post-3',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000003'::uuid
);
select public.post_supplier_document_payable(
  (select id from public.workspaces where slug='bdb-os'),
  'd0000000-0000-4000-8000-000000000004'::uuid,
  'c0000000-0000-4000-8000-000000000004'::uuid,
  'pass4-post-4',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000004'::uuid
);

select public.record_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  'f0000000-0000-4000-8000-000000000001'::uuid,
  'pass4-payment-1',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000005'::uuid,
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'EUR',120,'bank_transfer',now(),'PASS4-PAY-1','Pass 4 payment one'
);
select public.record_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  'f0000000-0000-4000-8000-000000000002'::uuid,
  'pass4-payment-2',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000006'::uuid,
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'EUR',50,'bank_transfer',now(),'PASS4-PAY-2','Pass 4 payment two'
);

select public.record_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  'f0000000-0000-4000-8000-000000000001'::uuid,
  'pass4-payment-1',
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'e0000000-0000-4000-8000-000000000005'::uuid,
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'EUR',120,'bank_transfer',now(),'PASS4-PAY-1','Pass 4 payment one'
);
select is(
  (select count(*)::integer from public.supplier_payments where id='f0000000-0000-4000-8000-000000000001'::uuid),
  1,
  'A safely retried Supplier Payment command does not duplicate the Payment'
);

select public.allocate_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  '01000000-0000-4000-8000-000000000001'::uuid,
  'f0000000-0000-4000-8000-000000000001'::uuid,
  'd0000000-0000-4000-8000-000000000001'::uuid,
  100,'pass4-allocation-1','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000007'::uuid,now()
);
select public.allocate_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  '01000000-0000-4000-8000-000000000002'::uuid,
  'f0000000-0000-4000-8000-000000000001'::uuid,
  'd0000000-0000-4000-8000-000000000002'::uuid,
  20,'pass4-allocation-2','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000008'::uuid,now()
);

select throws_ok(
  format($$select public.allocate_supplier_payment(%L::uuid,'01000000-0000-4000-8000-000000000003'::uuid,'f0000000-0000-4000-8000-000000000001'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,1,'pass4-allocation-over-payment','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000009'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier Payment allocation exceeds the unallocated Payment amount',
  'A Supplier Payment cannot be allocated beyond its remaining amount'
);

select public.allocate_supplier_credit(
  (select id from public.workspaces where slug='bdb-os'),
  '02000000-0000-4000-8000-000000000001'::uuid,
  'd0000000-0000-4000-8000-000000000003'::uuid,
  'd0000000-0000-4000-8000-000000000002'::uuid,
  20,'pass4-credit-allocation-1','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000010'::uuid,now()
);

select throws_ok(
  format($$select public.allocate_supplier_payment(%L::uuid,'01000000-0000-4000-8000-000000000004'::uuid,'f0000000-0000-4000-8000-000000000002'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,41,'pass4-invoice-over-allocation','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000011'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier Payment allocation exceeds the Supplier invoice outstanding amount',
  'Payments and credits together cannot exceed a Supplier invoice outstanding amount'
);

select public.allocate_supplier_payment(
  (select id from public.workspaces where slug='bdb-os'),
  '01000000-0000-4000-8000-000000000005'::uuid,
  'f0000000-0000-4000-8000-000000000002'::uuid,
  'd0000000-0000-4000-8000-000000000002'::uuid,
  40,'pass4-allocation-3','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000012'::uuid,now()
);

select throws_ok(
  format($$select public.allocate_supplier_payment(%L::uuid,'01000000-0000-4000-8000-000000000006'::uuid,'f0000000-0000-4000-8000-000000000002'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,5,'pass4-cross-supplier-payment','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000013'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier Payment and payable must belong to the same Supplier',
  'Supplier Payments cannot cross Supplier boundaries'
);

select throws_ok(
  format($$select public.allocate_supplier_credit(%L::uuid,'02000000-0000-4000-8000-000000000002'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,31,'pass4-credit-over-available','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000014'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier credit allocation exceeds the unallocated credit amount',
  'Supplier credit cannot be allocated beyond its remaining amount'
);

select throws_ok(
  format($$select public.allocate_supplier_credit(%L::uuid,'02000000-0000-4000-8000-000000000003'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,5,'pass4-cross-supplier-credit','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000015'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier credit and invoice must belong to the same Supplier',
  'Supplier credits cannot cross Supplier boundaries'
);

select throws_ok(
  format($$select public.reverse_supplier_payment(%L::uuid,'f0000000-0000-4000-8000-000000000001'::uuid,'pass4-payment-reverse-blocked','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000016'::uuid,'Payment still allocated')$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Reverse Supplier Payment allocations before reversing the Payment',
  'A Supplier Payment cannot reverse while allocations remain active'
);

select throws_ok(
  format($$select public.reverse_supplier_payable(%L::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,'pass4-payable-reverse-blocked','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000017'::uuid,'Payable still allocated')$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Reverse Supplier allocations before reversing the payable posting',
  'A Supplier payable cannot reverse while allocations remain active'
);

select throws_ok(
  format($$select public.post_supplier_document_payable(%L::uuid,'d0000000-0000-4000-8000-000000000099'::uuid,'c0000000-0000-4000-8000-000000000001'::uuid,'pass4-repost-blocked','a0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000018'::uuid)$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Supplier document already has an active payable posting',
  'The same Supplier document cannot gain a second active payable posting'
);

select is(
  (select outstanding_amount from public.supplier_payable_balances where id='d0000000-0000-4000-8000-000000000001'::uuid),
  0.0000::numeric,
  'A fully allocated Supplier invoice has zero outstanding balance'
);
select is(
  (select outstanding_amount from public.supplier_payable_balances where id='d0000000-0000-4000-8000-000000000002'::uuid),
  0.0000::numeric,
  'Mixed Payment and credit allocation closes a Supplier invoice exactly'
);
select is(
  (select outstanding_amount from public.supplier_payable_balances where id='d0000000-0000-4000-8000-000000000004'::uuid),
  100.0000::numeric,
  'An unrelated Supplier invoice remains untouched'
);

select is(
  ((public.get_supplier_accounts_summary((select id from public.workspaces where slug='bdb-os'))->>'outstandingAmount')::numeric),
  100.0000::numeric,
  'Supplier summary computes outstanding amount inside PostgreSQL'
);
select is(
  ((public.get_supplier_accounts_summary((select id from public.workspaces where slug='bdb-os'))->>'unallocatedCreditAmount')::numeric),
  40.0000::numeric,
  'Supplier summary combines unallocated Supplier Payments and credit notes'
);
select is(
  ((public.get_supplier_accounts_summary((select id from public.workspaces where slug='bdb-os'))->>'supplierAccountCount')::integer),
  2,
  'Supplier summary counts Supplier/currency accounts without loading them into the browser'
);
select is(
  ((public.get_supplier_accounts_summary((select id from public.workspaces where slug='bdb-os'))->>'readyDocumentCount')::integer),
  0,
  'Posted Supplier documents are no longer counted as ready to post'
);

select * from finish();
rollback;
