begin;

select plan(25);

select has_column('public','invoices','supplier_email_snapshot','Invoices snapshot supplier email');
select has_column('public','invoices','supplier_phone_snapshot','Invoices snapshot supplier phone');
select has_column('public','invoices','document_footer_snapshot','Invoices snapshot document footer');
select has_column('public','invoices','document_permanence_snapshot_at','Invoices record document permanence capture time');
select has_column('public','credit_notes','document_footer_snapshot','Credit Notes snapshot document footer');
select has_column('public','credit_notes','document_permanence_snapshot_at','Credit Notes record document permanence capture time');
select has_column('public','delivery_notes','supplier_name_snapshot','Delivery Notes snapshot supplier name');
select has_column('public','delivery_notes','supplier_address_snapshot','Delivery Notes snapshot supplier address');
select has_column('public','delivery_notes','supplier_vat_number_snapshot','Delivery Notes snapshot supplier VAT number');
select has_column('public','delivery_notes','supplier_registration_number_snapshot','Delivery Notes snapshot supplier registration');
select has_column('public','delivery_notes','customer_address_snapshot','Delivery Notes snapshot customer address');
select has_column('public','delivery_notes','customer_vat_number_snapshot','Delivery Notes snapshot customer VAT number');
select has_column('public','delivery_notes','document_footer_snapshot','Delivery Notes snapshot document footer');
select has_column('public','delivery_notes','document_permanence_snapshot_at','Delivery Notes record document permanence capture time');

select ok(exists(
  select 1 from pg_trigger
  where tgrelid='public.invoices'::regclass and tgname='invoices_snapshot_document_permanence' and not tgisinternal
), 'Invoice issue has a document permanence snapshot trigger');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid='public.credit_notes'::regclass and tgname='credit_notes_snapshot_document_permanence' and not tgisinternal
), 'Credit Note issue has a document permanence snapshot trigger');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid='public.delivery_notes'::regclass and tgname='delivery_notes_snapshot_document_permanence' and not tgisinternal
), 'Delivery Note issue has a document permanence snapshot trigger');

insert into auth.users(id,email)
values ('10101010-1010-4010-8010-101010101010'::uuid,'accounts-pass2@bdb.invalid');

insert into public.customers(id,workspace_id,code,name,company,address,vat_number)
select
  '20202020-2020-4020-8020-202020202020'::uuid,
  workspace.id,
  'PASS2-CUSTOMER',
  'Freeze Customer',
  '',
  'Freeze Customer Address',
  'MTCUSTFREEZE'
from public.workspaces workspace
where workspace.slug='bdb-os';

update public.workspace_settings settings
set email='freeze-before@example.invalid',
    phone='+35611111111',
    business_address='Freeze Supplier Address',
    vat_number='MTFREEZE1',
    company_registration_number='C-FREEZE',
    document_footer='Freeze Footer Before'
where settings.workspace_id=(select id from public.workspaces where slug='bdb-os');

insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,
  customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,
  net_amount,vat_amount,total_amount
)
select
  '30303030-3030-4030-8030-303030303030'::uuid,
  workspace.id,
  'DRAFT-PASS2',
  '20202020-2020-4020-8020-202020202020'::uuid,
  null,
  'Pass 2 permanence fixture',
  100,
  'draft'::public.invoice_status,
  'EUR',
  'PASS2-CUSTOMER',
  'Freeze Customer',
  100,0,100,0,100
from public.workspaces workspace
where workspace.slug='bdb-os';

update public.invoices
set status='sent'::public.invoice_status
where id='30303030-3030-4030-8030-303030303030'::uuid;

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,issued_at,
  customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,
  created_by,updated_by,issued_by,issued_at_timestamp
)
select
  '40404040-4040-4040-8040-404040404040'::uuid,
  workspace.id,
  'CN-PASS2',
  '30303030-3030-4030-8030-303030303030'::uuid,
  '20202020-2020-4020-8020-202020202020'::uuid,
  'EUR',
  'Pass 2 footer permanence fixture',
  'issued',current_date,
  'Freeze Customer',10,0,10,0,10,
  '10101010-1010-4010-8010-101010101010'::uuid,
  '10101010-1010-4010-8010-101010101010'::uuid,
  '10101010-1010-4010-8010-101010101010'::uuid,
  now()
from public.workspaces workspace
where workspace.slug='bdb-os';

insert into public.delivery_notes(
  id,workspace_id,number,source_invoice_id,customer_id,customer_name_snapshot,
  delivery_address,delivery_date,status,created_by,updated_by,issued_by,issued_at
)
select
  '50505050-5050-4050-8050-505050505050'::uuid,
  workspace.id,
  'DN-PASS2',
  '30303030-3030-4030-8030-303030303030'::uuid,
  '20202020-2020-4020-8020-202020202020'::uuid,
  'Freeze Customer',
  'Freeze Delivery Address',current_date,'issued',
  '10101010-1010-4010-8010-101010101010'::uuid,
  '10101010-1010-4010-8010-101010101010'::uuid,
  '10101010-1010-4010-8010-101010101010'::uuid,
  now()
from public.workspaces workspace
where workspace.slug='bdb-os';

select ok(
  (select document_permanence_snapshot_at is not null from public.invoices where id='30303030-3030-4030-8030-303030303030'::uuid),
  'Issuing an Invoice captures its permanent document snapshot'
);

update public.workspace_settings settings
set email='freeze-after@example.invalid',
    phone='+35699999999',
    business_address='Changed Supplier Address',
    vat_number='MTCHANGED',
    company_registration_number='C-CHANGED',
    document_footer='Changed Footer After Issue'
where settings.workspace_id=(select id from public.workspaces where slug='bdb-os');

update public.customers
set name='Changed Customer',address='Changed Customer Address',vat_number='MTCHANGEDCUST'
where id='20202020-2020-4020-8020-202020202020'::uuid;

select is(
  (select supplier_email_snapshot from public.invoices where id='30303030-3030-4030-8030-303030303030'::uuid),
  'freeze-before@example.invalid',
  'Issued Invoice supplier email remains frozen after settings change'
);
select is(
  (select supplier_phone_snapshot from public.invoices where id='30303030-3030-4030-8030-303030303030'::uuid),
  '+35611111111',
  'Issued Invoice supplier phone remains frozen after settings change'
);
select is(
  (select document_footer_snapshot from public.invoices where id='30303030-3030-4030-8030-303030303030'::uuid),
  'Freeze Footer Before',
  'Issued Invoice footer remains frozen after settings change'
);
select is(
  (select document_footer_snapshot from public.credit_notes where id='40404040-4040-4040-8040-404040404040'::uuid),
  'Freeze Footer Before',
  'Issued Credit Note footer remains frozen after settings change'
);
select is(
  (select supplier_address_snapshot from public.delivery_notes where id='50505050-5050-4050-8050-505050505050'::uuid),
  'Freeze Supplier Address',
  'Issued Delivery Note supplier address remains frozen after settings change'
);
select is(
  (select customer_address_snapshot from public.delivery_notes where id='50505050-5050-4050-8050-505050505050'::uuid),
  'Freeze Customer Address',
  'Issued Delivery Note customer address remains frozen after Customer change'
);
select is(
  (select document_footer_snapshot from public.delivery_notes where id='50505050-5050-4050-8050-505050505050'::uuid),
  'Freeze Footer Before',
  'Issued Delivery Note footer remains frozen after settings change'
);

select * from finish();
rollback;
