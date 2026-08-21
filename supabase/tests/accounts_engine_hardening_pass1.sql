begin;

select plan(41);

select has_table('public','accounts_command_claims','Accounts request-hash claim ledger exists');
select ok((select relrowsecurity from pg_class where oid='public.accounts_command_claims'::regclass),'Accounts request claims use RLS');
select ok(not has_table_privilege('authenticated','public.accounts_command_claims','SELECT'),'Browser clients cannot read Accounts request claims');
select ok(not has_table_privilege('authenticated','public.accounts_command_claims','INSERT'),'Browser clients cannot write Accounts request claims');

select has_function('public','claim_accounts_command',array['uuid','text','text'],'Accounts request hash claim command exists');
select ok(not has_function_privilege('authenticated','public.claim_accounts_command(uuid,text,text)','EXECUTE'),'Browser clients cannot claim financial commands directly');
select ok(has_function_privilege('service_role','public.claim_accounts_command(uuid,text,text)','EXECUTE'),'Service role can claim financial commands');
select lives_ok(
  format($$select public.claim_accounts_command(%L::uuid,'pgtap-pass1-claim',repeat('a',64))$$, (select id::text from public.workspaces where slug='bdb-os')),
  'A new Accounts idempotency key can claim its request hash'
);
select throws_ok(
  format($$select public.claim_accounts_command(%L::uuid,'pgtap-pass1-claim',repeat('b',64))$$, (select id::text from public.workspaces where slug='bdb-os')),
  'P0001',
  'Idempotency key was reused with different Accounts input',
  'The same Accounts idempotency key cannot be reused with changed input'
);

select ok(not has_function_privilege(
  'authenticated',
  'public.create_workspace_invoice(uuid,uuid,uuid,date,text,numeric,text)',
  'EXECUTE'
), 'Legacy arbitrary-amount Invoice RPC is retired from browser roles');
select ok(not has_function_privilege(
  'authenticated',
  'public.reconcile_bank_transaction(uuid,uuid,uuid)',
  'EXECUTE'
), 'Legacy direct Invoice reconciliation RPC is retired from browser roles');

select ok(not has_function_privilege(
  'authenticated',
  'private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)',
  'EXECUTE'
), 'Browser roles cannot execute the private Payment allocation helper');
select ok(not has_function_privilege(
  'authenticated',
  'private.refresh_invoice_payment_status(uuid,uuid,uuid)',
  'EXECUTE'
), 'Browser roles cannot execute the private Invoice payment-status helper');
select ok(not has_function_privilege(
  'authenticated',
  'private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb)',
  'EXECUTE'
), 'Browser roles cannot execute the private Credit Note writer');
select ok(not has_function_privilege(
  'authenticated',
  'private.write_delivery_note_lines(uuid,uuid,text,uuid,jsonb)',
  'EXECUTE'
), 'Browser roles cannot execute the private Delivery Note writer');

select ok(position(
  'from public.credit_notes note'
  in lower(pg_get_functiondef('private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)'::regprocedure))
) > 0, 'Payment allocation reads issued Credit Notes before deciding Invoice capacity');
select ok(position(
  'invoice_record.total_amount - invoice_credited - invoice_allocated'
  in lower(pg_get_functiondef('private.insert_payment_allocation(uuid,uuid,uuid,uuid,numeric,uuid,uuid,timestamp with time zone)'::regprocedure))
) > 0, 'Payment allocation subtracts both Credits and prior Payments');
select ok(position(
  'invoice_record.total_amount - credited_value - allocated_value'
  in lower(pg_get_functiondef('private.refresh_invoice_payment_status(uuid,uuid,uuid)'::regprocedure))
) > 0, 'Invoice payment-status refresh uses the same Credit-adjusted outstanding balance');

select ok(exists(
  select 1 from pg_indexes
  where schemaname='public'
    and tablename='credit_note_lines'
    and indexname='credit_note_lines_one_source_per_note_idx'
    and indexdef ilike '%unique index%source_invoice_line_id%'
), 'A Credit Note cannot repeat the same source Invoice line');
select ok(position(
  'a credit note can reference each original invoice line only once'
  in lower(pg_get_functiondef('private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb)'::regprocedure))
) > 0, 'Credit Note writer explicitly rejects duplicate source lines');
select ok(position(
  'source_line.total_amount - credited_total'
  in lower(pg_get_functiondef('private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb)'::regprocedure))
) > 0, 'Final partial Credit Note quantity absorbs the exact remaining source total');
select ok(position(
  'source_line.vat_amount - credited_vat'
  in lower(pg_get_functiondef('private.write_credit_note_lines_by_quantity(uuid,uuid,uuid,jsonb)'::regprocedure))
) > 0, 'Final partial Credit Note quantity absorbs the exact remaining VAT');

select ok(exists(
  select 1 from pg_indexes
  where schemaname='public'
    and tablename='delivery_note_lines'
    and indexname='delivery_note_lines_one_invoice_source_per_note_idx'
), 'One Delivery Note cannot repeat an Invoice source line');
select ok(exists(
  select 1 from pg_indexes
  where schemaname='public'
    and tablename='delivery_note_lines'
    and indexname='delivery_note_lines_one_sale_source_per_note_idx'
), 'One Delivery Note cannot repeat a Sale source line');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid='public.delivery_notes'::regclass
    and tgname='delivery_notes_issue_quantity_guard'
    and not tgisinternal
), 'Delivery Note issue has a source quantity/concurrency guard');
select ok(position(
  'for update'
  in lower(pg_get_functiondef('private.enforce_delivery_note_issue_quantities()'::regprocedure))
) > 0, 'Delivery Note issue locks its parent Invoice or Sale to serialize concurrent issue');
select ok(position(
  'prior_note.status = ''issued'''
  in lower(pg_get_functiondef('private.enforce_delivery_note_issue_quantities()'::regprocedure))
) > 0, 'Delivery Note issue revalidates against already-issued quantities after locking');

select ok(position(
  'payment_terms_days'
  in lower(pg_get_functiondef('private.assign_invoice_issue_identity()'::regprocedure))
) > 0, 'Invoice issue reads workspace Payment Terms');
select ok(position(
  'new.due_at is null or new.due_at < issue_date'
  in lower(pg_get_functiondef('private.assign_invoice_issue_identity()'::regprocedure))
) > 0, 'Invoice issue assigns Payment Terms when the Due Date is absent');

select ok(exists(
  select 1 from pg_trigger
  where tgrelid='public.workspace_settings'::regclass
    and tgname='workspace_settings_currency_lock'
    and not tgisinternal
), 'Workspace base currency has a post-financial-activity lock');
select ok(position(
  'workspace currency cannot change after financial activity exists'
  in lower(pg_get_functiondef('private.prevent_workspace_currency_change_after_financial_activity()'::regprocedure))
) > 0, 'Currency lock rejects a base-currency mutation after financial activity');

select ok(position(
  'existing_note'
  in lower(pg_get_functiondef('public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure))
) > 0, 'Document Notes are safely replayable after a lost response');
select ok(position(
  'business document note identity conflict'
  in lower(pg_get_functiondef('public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure))
) > 0, 'A retried Note ID cannot be reused for different content');


-- ---------------------------------------------------------------------------
-- Behavioural regressions in the disposable pgTAP transaction
-- ---------------------------------------------------------------------------

insert into auth.users(id,email)
values ('11111111-1111-4111-8111-111111111111'::uuid,'accounts-pass1@bdb.invalid');

insert into public.customers(id,workspace_id,code,name,company)
select
  '22222222-2222-4222-8222-222222222222'::uuid,
  workspace.id,
  'PASS1-CUSTOMER',
  'Pass 1 Customer',
  ''
from public.workspaces workspace
where workspace.slug='bdb-os';

update public.workspace_settings settings
set payment_terms_days=30
where settings.workspace_id=(select id from public.workspaces where slug='bdb-os');

insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,
  customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,
  net_amount,vat_amount,total_amount
)
select
  '33333333-3333-4333-8333-333333333333'::uuid,
  workspace.id,
  'DRAFT-PASS1',
  '22222222-2222-4222-8222-222222222222'::uuid,
  null,
  'Pass 1 integrity fixture',
  100,
  'draft'::public.invoice_status,
  'EUR',
  'PASS1-CUSTOMER',
  'Pass 1 Customer',
  100,0,100,0,100
from public.workspaces workspace
where workspace.slug='bdb-os';

insert into public.invoice_lines(
  id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,
  quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
)
select
  '44444444-4444-4444-8444-444444444444'::uuid,
  workspace.id,
  '33333333-3333-4333-8333-333333333333'::uuid,
  1,'manual','PASS1','Pass 1 rounding source',3,33.3333,100,0,100,0,0,100
from public.workspaces workspace
where workspace.slug='bdb-os';

update public.invoices
set status='sent'::public.invoice_status
where id='33333333-3333-4333-8333-333333333333'::uuid;

select is(
  (select due_at from public.invoices where id='33333333-3333-4333-8333-333333333333'::uuid),
  current_date + 30,
  'Issuing an Invoice with no Due Date applies workspace Payment Terms'
);

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,issued_at,
  customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,
  created_by,updated_by,issued_by,issued_at_timestamp
)
select
  '66666666-6666-4666-8666-666666666666'::uuid,
  workspace.id,
  'CN-PASS1-PAYMENT',
  '33333333-3333-4333-8333-333333333333'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'EUR','Payment allocation credit fixture','issued',current_date,
  'Pass 1 Customer',60,0,60,0,60,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  now()
from public.workspaces workspace
where workspace.slug='bdb-os';

insert into public.payments(
  id,workspace_id,reference,customer_id,customer_code_snapshot,customer_name_snapshot,
  currency,amount,payment_method,received_at,posted_by
)
select
  '55555555-5555-4555-8555-555555555555'::uuid,
  workspace.id,
  'PAY-PASS1',
  '22222222-2222-4222-8222-222222222222'::uuid,
  'PASS1-CUSTOMER','Pass 1 Customer','EUR',100,'bank_transfer',now(),
  '11111111-1111-4111-8111-111111111111'::uuid
from public.workspaces workspace
where workspace.slug='bdb-os';

select throws_ok(
  format(
    $$select private.insert_payment_allocation(%L::uuid,'77777777-7777-4777-8777-777777777771'::uuid,'55555555-5555-4555-8555-555555555555'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,41,'11111111-1111-4111-8111-111111111111'::uuid,'77777777-7777-4777-8777-777777777772'::uuid,now())$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'P0001',
  'Payment allocation exceeds the Invoice outstanding amount after Credit Notes',
  'A Payment cannot allocate beyond the Credit-adjusted Invoice balance'
);

select lives_ok(
  format(
    $$select private.insert_payment_allocation(%L::uuid,'77777777-7777-4777-8777-777777777773'::uuid,'55555555-5555-4555-8555-555555555555'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,40,'11111111-1111-4111-8111-111111111111'::uuid,'77777777-7777-4777-8777-777777777774'::uuid,now())$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'The exact remaining Invoice balance can still be allocated'
);

select is(
  (select status::text from public.invoices where id='33333333-3333-4333-8333-333333333333'::uuid),
  'paid',
  'Invoice payment status refresh uses Credits plus Payments consistently'
);

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,
  customer_name_snapshot,created_by,updated_by
)
select
  '88888888-8888-4888-8888-888888888888'::uuid,
  workspace.id,'DRAFT-CN-PASS1-A','33333333-3333-4333-8333-333333333333'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,'EUR','First rounding slice','draft',
  'Pass 1 Customer','11111111-1111-4111-8111-111111111111'::uuid,'11111111-1111-4111-8111-111111111111'::uuid
from public.workspaces workspace where workspace.slug='bdb-os';

select private.write_credit_note_lines_by_quantity(
  (select id from public.workspaces where slug='bdb-os'),
  '88888888-8888-4888-8888-888888888888'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  jsonb_build_array(jsonb_build_object(
    'id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'sourceInvoiceLineId','44444444-4444-4444-8444-444444444444',
    'quantity',1
  ))
);

update public.credit_notes note
set
  gross_amount=(select sum(line.gross_amount) from public.credit_note_lines line where line.credit_note_id=note.id),
  discount_amount=(select sum(line.discount_amount) from public.credit_note_lines line where line.credit_note_id=note.id),
  net_amount=(select sum(line.net_amount) from public.credit_note_lines line where line.credit_note_id=note.id),
  vat_amount=(select sum(line.vat_amount) from public.credit_note_lines line where line.credit_note_id=note.id),
  total_amount=(select sum(line.total_amount) from public.credit_note_lines line where line.credit_note_id=note.id),
  status='issued',issued_at=current_date,issued_at_timestamp=now(),
  issued_by='11111111-1111-4111-8111-111111111111'::uuid
where note.id='88888888-8888-4888-8888-888888888888'::uuid;

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,
  customer_name_snapshot,created_by,updated_by
)
select
  '99999999-9999-4999-8999-999999999999'::uuid,
  workspace.id,'DRAFT-CN-PASS1-B','33333333-3333-4333-8333-333333333333'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,'EUR','Final rounding slice','draft',
  'Pass 1 Customer','11111111-1111-4111-8111-111111111111'::uuid,'11111111-1111-4111-8111-111111111111'::uuid
from public.workspaces workspace where workspace.slug='bdb-os';

select private.write_credit_note_lines_by_quantity(
  (select id from public.workspaces where slug='bdb-os'),
  '99999999-9999-4999-8999-999999999999'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  jsonb_build_array(jsonb_build_object(
    'id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'sourceInvoiceLineId','44444444-4444-4444-8444-444444444444',
    'quantity',2
  ))
);

select is(
  (select round(sum(line.total_amount),4)
   from public.credit_note_lines line
   where line.source_invoice_line_id='44444444-4444-4444-8444-444444444444'::uuid
     and line.credit_note_id in ('88888888-8888-4888-8888-888888888888'::uuid,'99999999-9999-4999-8999-999999999999'::uuid)),
  100.0000::numeric,
  'Repeated partial Credit quantities close to the exact original line total'
);

select is(
  (select sum(line.quantity)
   from public.credit_note_lines line
   where line.source_invoice_line_id='44444444-4444-4444-8444-444444444444'::uuid
     and line.credit_note_id in ('88888888-8888-4888-8888-888888888888'::uuid,'99999999-9999-4999-8999-999999999999'::uuid)),
  3::numeric,
  'Repeated partial Credit quantities close to the exact original line quantity'
);

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,
  customer_name_snapshot,created_by,updated_by
)
select
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'::uuid,
  workspace.id,'DRAFT-CN-PASS1-DUP','33333333-3333-4333-8333-333333333333'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,'EUR','Duplicate source test','draft',
  'Pass 1 Customer','11111111-1111-4111-8111-111111111111'::uuid,'11111111-1111-4111-8111-111111111111'::uuid
from public.workspaces workspace where workspace.slug='bdb-os';

select throws_ok(
  format(
    $$select private.write_credit_note_lines_by_quantity(%L::uuid,'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,'[{"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","sourceInvoiceLineId":"44444444-4444-4444-8444-444444444444","quantity":0.25},{"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","sourceInvoiceLineId":"44444444-4444-4444-8444-444444444444","quantity":0.25}]'::jsonb)$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'P0001',
  'A Credit Note can reference each original Invoice line only once',
  'A single Credit Note rejects duplicate source Invoice rows'
);

select throws_ok(
  format(
    $$update public.workspace_settings set currency='USD' where workspace_id=%L::uuid$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'P0001',
  'Workspace currency cannot change after financial activity exists',
  'Workspace base currency cannot change after financial activity exists'
);

select * from finish();
rollback;
