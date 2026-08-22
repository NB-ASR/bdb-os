begin;

select plan(32);

select ok(not has_function_privilege('authenticated','public.create_and_issue_invoice_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb,text)','EXECUTE'),'Browser roles cannot execute final Invoice creation directly');
select ok(not has_function_privilege('authenticated','public.create_and_issue_credit_note_command(uuid,uuid,text,uuid,uuid,uuid,text,jsonb)','EXECUTE'),'Browser roles cannot execute final Credit Note creation directly');
select ok(not has_function_privilege('authenticated','public.create_and_issue_delivery_note_command(uuid,uuid,text,uuid,uuid,text,uuid,uuid,date,text,text,jsonb)','EXECUTE'),'Browser roles cannot execute final Delivery Note creation directly');
select ok(not has_function_privilege('authenticated','private.next_business_document_number(uuid,text,text,date)','EXECUTE'),'Browser roles cannot allocate permanent document numbers directly');
select ok(position('on conflict (workspace_id, document_type, series_year, prefix) do update' in lower(pg_get_functiondef('private.next_business_document_number(uuid,text,text,date)'::regprocedure))) > 0,'Permanent numbering uses one atomic sequence-row increment');
select ok(position('if not exists' in lower(pg_get_functiondef('private.next_business_document_number(uuid,text,text,date)'::regprocedure))) > 0,'Permanent numbering refuses to reuse an existing document number');
select ok(exists(select 1 from pg_trigger where tgrelid='public.invoice_lines'::regclass and tgname='invoice_lines_enforce_mutability' and not tgisinternal),'Issued Invoice lines have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.credit_notes'::regclass and tgname='credit_notes_immutability' and not tgisinternal),'Issued Credit Notes have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.delivery_notes'::regclass and tgname='delivery_notes_immutability' and not tgisinternal),'Issued Delivery Notes have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.payments'::regclass and tgname='payments_enforce_mutability' and not tgisinternal),'Posted Payments have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.payment_allocations'::regclass and tgname='payment_allocations_enforce_immutability' and not tgisinternal),'Payment allocation history is append-only');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.customer_account_balances'::regclass),'Customer balance view executes as its caller');

insert into auth.users(id,email)
values ('41000000-0000-4000-8000-000000000001'::uuid,'accounts-pass4-closure@bdb.invalid');

insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
select id,'41000000-0000-4000-8000-000000000001'::uuid,'owner','active','owner',now()
from public.workspaces where slug='bdb-os';

insert into public.customers(id,workspace_id,code,name,company)
select '42000000-0000-4000-8000-000000000001'::uuid,id,'PASS4-CUSTOMER','Pass 4 Closure Customer',''
from public.workspaces where slug='bdb-os';

insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,
  customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,
  created_by,updated_by
)
select
  '43000000-0000-4000-8000-000000000001'::uuid,id,'DRAFT-PASS4-A','42000000-0000-4000-8000-000000000001'::uuid,
  null,'Pass 4 combined ledger fixture',118,'draft'::public.invoice_status,'EUR','PASS4-CUSTOMER','Pass 4 Closure Customer',105,5,100,18,118,
  '41000000-0000-4000-8000-000000000001'::uuid,'41000000-0000-4000-8000-000000000001'::uuid
from public.workspaces where slug='bdb-os';

insert into public.invoice_lines(
  id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,
  quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
)
select '44000000-0000-4000-8000-000000000001'::uuid,id,'43000000-0000-4000-8000-000000000001'::uuid,
  1,'manual','PASS4-A','Decimal closure line',10.5,10,105,5,100,18,18,118
from public.workspaces where slug='bdb-os';

update public.invoices set status='sent'::public.invoice_status where id='43000000-0000-4000-8000-000000000001'::uuid;
select is((select total_amount from public.invoices where id='43000000-0000-4000-8000-000000000001'::uuid),118.0000::numeric,'Issuing the fixture preserves the original Invoice total');

select public.create_and_issue_credit_note_command(
  (select id from public.workspaces where slug='bdb-os'),
  '45000000-0000-4000-8000-000000000001'::uuid,'pass4-closure-cn-a',
  '41000000-0000-4000-8000-000000000001'::uuid,'46000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000001'::uuid,'Partial quantity reduction',
  '[{"id":"47000000-0000-4000-8000-000000000001","sourceInvoiceLineId":"44000000-0000-4000-8000-000000000001","quantity":1.5}]'::jsonb
);
select is((select credited_amount from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000001'::uuid),16.8571::numeric,'A decimal partial Credit reduces the live balance without rewriting the Invoice total');

select public.record_payment(
  (select id from public.workspaces where slug='bdb-os'),'48000000-0000-4000-8000-000000000001'::uuid,'pass4-closure-pay-1',
  '41000000-0000-4000-8000-000000000001'::uuid,'49000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000001'::uuid,60,'bank_transfer',now(),'PASS4-1','First closure payment','[]'::jsonb
);
select public.allocate_payment(
  (select id from public.workspaces where slug='bdb-os'),'4a000000-0000-4000-8000-000000000001'::uuid,
  '48000000-0000-4000-8000-000000000001'::uuid,'43000000-0000-4000-8000-000000000001'::uuid,60,'pass4-closure-alloc-1',
  '41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000001'::uuid,now()
);
select lives_ok(format($$select public.record_payment(%L::uuid,'48000000-0000-4000-8000-000000000002'::uuid,'pass4-closure-pay-2','41000000-0000-4000-8000-000000000001'::uuid,'49000000-0000-4000-8000-000000000002'::uuid,'42000000-0000-4000-8000-000000000001'::uuid,50,'bank_transfer',now(),'PASS4-2','Second closure payment','[]'::jsonb)$$,(select id::text from public.workspaces where slug='bdb-os')),'A second Payment can be recorded independently');
select throws_ok(
  format($$select public.allocate_payment(%L::uuid,'4a000000-0000-4000-8000-000000000002'::uuid,'48000000-0000-4000-8000-000000000002'::uuid,'43000000-0000-4000-8000-000000000001'::uuid,50,'pass4-closure-overalloc','41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000002'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Payment allocation exceeds the Invoice outstanding amount after Credit Notes','Credit plus multiple Payments cannot over-allocate the Invoice'
);
select lives_ok(format($$select public.allocate_payment(%L::uuid,'4a000000-0000-4000-8000-000000000003'::uuid,'48000000-0000-4000-8000-000000000002'::uuid,'43000000-0000-4000-8000-000000000001'::uuid,40,'pass4-closure-alloc-2','41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000003'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),'A valid second allocation remains possible');
select is((select outstanding_amount from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000001'::uuid),1.1429::numeric,'Invoice outstanding equals original total minus Credit minus both Payments');

select lives_ok(format($$select public.reverse_payment_allocation(%L::uuid,'4a000000-0000-4000-8000-000000000004'::uuid,'4a000000-0000-4000-8000-000000000003'::uuid,'pass4-closure-reverse-alloc','41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000004'::uuid,'Allocation reversal test',now())$$,(select id::text from public.workspaces where slug='bdb-os')),'A Payment allocation can be reversed append-only');
select lives_ok(format($$select public.reverse_payment(%L::uuid,'48000000-0000-4000-8000-000000000002'::uuid,'pass4-closure-reverse-payment','41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000005'::uuid,'Payment reversal test')$$,(select id::text from public.workspaces where slug='bdb-os')),'A Payment can be reversed after its allocations are reversed');
select is((select outstanding_amount from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000001'::uuid),41.1429::numeric,'Reversal restores the Invoice outstanding balance exactly');
select is((select status from public.payments where id='48000000-0000-4000-8000-000000000002'::uuid),'reversed','Reversed Payment remains a separate historical ledger event');
select is(
  (select net_balance from public.customer_account_balances where customer_id='42000000-0000-4000-8000-000000000001'::uuid),
  (select round(outstanding_amount-unallocated_credit,4) from public.customer_account_balances where customer_id='42000000-0000-4000-8000-000000000001'::uuid),
  'Customer Balance equals its underlying outstanding ledger less unallocated credit'
);

insert into public.workspaces(id,slug,name)
values ('4c000000-0000-4000-8000-000000000001'::uuid,'pass4-other-workspace','Pass 4 Other Workspace');
insert into public.customers(id,workspace_id,code,name,company)
values ('4d000000-0000-4000-8000-000000000001'::uuid,'4c000000-0000-4000-8000-000000000001'::uuid,'OTHER','Other Workspace Customer','');
insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,customer_code_snapshot,customer_name_snapshot,
  gross_amount,discount_amount,net_amount,vat_amount,total_amount
) values (
  '4e000000-0000-4000-8000-000000000001'::uuid,'4c000000-0000-4000-8000-000000000001'::uuid,'OTHER-INV','4d000000-0000-4000-8000-000000000001'::uuid,
  current_date+14,'Cross workspace fixture',20,'sent'::public.invoice_status,'EUR','OTHER','Other Workspace Customer',20,0,20,0,20
);
select throws_ok(
  format($$select public.allocate_payment(%L::uuid,'4a000000-0000-4000-8000-000000000005'::uuid,'48000000-0000-4000-8000-000000000001'::uuid,'4e000000-0000-4000-8000-000000000001'::uuid,1,'pass4-cross-workspace','41000000-0000-4000-8000-000000000001'::uuid,'4b000000-0000-4000-8000-000000000006'::uuid,now())$$,(select id::text from public.workspaces where slug='bdb-os')),
  'P0001','Invoice is unavailable for allocation','A Payment cannot mutate an Invoice from another workspace'
);

insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,
  customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,
  created_by,updated_by
)
select
  '43000000-0000-4000-8000-000000000002'::uuid,id,'DRAFT-PASS4-B','42000000-0000-4000-8000-000000000001'::uuid,
  null,'Pass 4 repeated credit fixture',118,'draft'::public.invoice_status,'EUR','PASS4-CUSTOMER','Pass 4 Closure Customer',105,5,100,18,118,
  '41000000-0000-4000-8000-000000000001'::uuid,'41000000-0000-4000-8000-000000000001'::uuid
from public.workspaces where slug='bdb-os';
insert into public.invoice_lines(
  id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
)
select '44000000-0000-4000-8000-000000000002'::uuid,id,'43000000-0000-4000-8000-000000000002'::uuid,1,'manual','PASS4-B','Repeated decimal credit line',10.5,10,105,5,100,18,18,118
from public.workspaces where slug='bdb-os';
update public.invoices set status='sent'::public.invoice_status where id='43000000-0000-4000-8000-000000000002'::uuid;

select lives_ok(format($$select public.create_and_issue_credit_note_command(%L::uuid,'45000000-0000-4000-8000-000000000002'::uuid,'pass4-repeat-cn-1','41000000-0000-4000-8000-000000000001'::uuid,'46000000-0000-4000-8000-000000000002'::uuid,'43000000-0000-4000-8000-000000000002'::uuid,'Repeated credit one','[{"id":"47000000-0000-4000-8000-000000000002","sourceInvoiceLineId":"44000000-0000-4000-8000-000000000002","quantity":3.5}]'::jsonb)$$,(select id::text from public.workspaces where slug='bdb-os')),'First one-third Credit issues');
select lives_ok(format($$select public.create_and_issue_credit_note_command(%L::uuid,'45000000-0000-4000-8000-000000000003'::uuid,'pass4-repeat-cn-2','41000000-0000-4000-8000-000000000001'::uuid,'46000000-0000-4000-8000-000000000003'::uuid,'43000000-0000-4000-8000-000000000002'::uuid,'Repeated credit two','[{"id":"47000000-0000-4000-8000-000000000003","sourceInvoiceLineId":"44000000-0000-4000-8000-000000000002","quantity":3.5}]'::jsonb)$$,(select id::text from public.workspaces where slug='bdb-os')),'Second one-third Credit issues');
select lives_ok(format($$select public.create_and_issue_credit_note_command(%L::uuid,'45000000-0000-4000-8000-000000000004'::uuid,'pass4-repeat-cn-3','41000000-0000-4000-8000-000000000001'::uuid,'46000000-0000-4000-8000-000000000004'::uuid,'43000000-0000-4000-8000-000000000002'::uuid,'Repeated credit three','[{"id":"47000000-0000-4000-8000-000000000004","sourceInvoiceLineId":"44000000-0000-4000-8000-000000000002","quantity":3.5}]'::jsonb)$$,(select id::text from public.workspaces where slug='bdb-os')),'Final one-third Credit issues and absorbs rounding remainder');
select is((select credited_amount from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000002'::uuid),118.0000::numeric,'Repeated partial Credits close to the exact original Invoice total');
select is((select adjusted_total_amount from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000002'::uuid),0.0000::numeric,'A fully credited Invoice has zero adjusted balance');
select is((select total_amount from public.invoices where id='43000000-0000-4000-8000-000000000002'::uuid),118.0000::numeric,'Full Credit closure never rewrites the issued Invoice total');
select is((select round(sum(quantity),4) from public.credit_note_lines where source_invoice_line_id='44000000-0000-4000-8000-000000000002'::uuid),10.5000::numeric,'Repeated partial Credits close to the exact original quantity');
select throws_ok(
  $$update public.invoice_lines set quantity=11 where id='44000000-0000-4000-8000-000000000002'::uuid$$,
  'P0001','Issued Invoice lines are immutable','Stress operations cannot mutate an issued Invoice line'
);
select throws_ok(
  $$update public.invoices set status='void'::public.invoice_status where id='43000000-0000-4000-8000-000000000002'::uuid$$,
  'P0001','Issued Invoices can only be cancelled by an issued Credit Note','Invalid direct Invoice cancellation remains blocked'
);
select is((select overallocated_credit from public.invoice_account_balances where id='43000000-0000-4000-8000-000000000002'::uuid),0.0000::numeric,'Full Credit closure creates no overallocated phantom credit');

select * from finish();
rollback;
