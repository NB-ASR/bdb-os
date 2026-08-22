begin;

select plan(9);

insert into auth.users(id,email)
values ('71000000-0000-4000-8000-000000000001'::uuid,'accounts-100-line@bdb.invalid');

insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
select id,'71000000-0000-4000-8000-000000000001'::uuid,'owner','active','owner',now()
from public.workspaces where slug='bdb-os';

insert into public.customers(id,workspace_id,code,name,company)
select '71000000-0000-4000-8000-000000000002'::uuid,id,'PASS4-100','Pass 4 Hundred Line Customer',''
from public.workspaces where slug='bdb-os';

insert into public.services(id,workspace_id,code,name,duration_minutes,price,vat_rate,status,created_by,updated_by)
select '71000000-0000-4000-8000-000000000003'::uuid,id,'P4-100-SVC','Pass 4 Hundred Line Service',60,10,18,'active',
  '71000000-0000-4000-8000-000000000001'::uuid,'71000000-0000-4000-8000-000000000001'::uuid
from public.workspaces where slug='bdb-os';

select lives_ok(
  format(
    $$select public.create_and_issue_invoice_command(
      %L::uuid,'72000000-0000-4000-8000-000000000001'::uuid,'manual','pass4-100-line-invoice',
      '71000000-0000-4000-8000-000000000001'::uuid,'72000000-0000-4000-8000-000000000002'::uuid,
      null,'71000000-0000-4000-8000-000000000002'::uuid,null,'Hundred line stress Invoice',null,
      (select jsonb_agg(jsonb_build_object(
        'id',md5('p4-hundred-invoice-line-'||g)::uuid,
        'lineType','service','serviceId','71000000-0000-4000-8000-000000000003',
        'quantity',1,'discountPercent',10
      ) order by g) from generate_series(1,100) g),null
    )$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'A catalogue-backed 100-line Invoice issues successfully'
);

select is(
  (select count(*)::integer from public.invoice_lines where invoice_id='72000000-0000-4000-8000-000000000001'::uuid),
  100,
  'The issued stress Invoice contains exactly 100 immutable financial lines'
);
select is(
  (select total_amount from public.invoices where id='72000000-0000-4000-8000-000000000001'::uuid),
  1062.0000::numeric,
  'The 100-line Invoice preserves discount-before-VAT totals exactly'
);

select lives_ok(
  format(
    $$select public.create_and_issue_delivery_note_command(
      %L::uuid,'73000000-0000-4000-8000-000000000001'::uuid,'pass4-100-line-delivery',
      '71000000-0000-4000-8000-000000000001'::uuid,'73000000-0000-4000-8000-000000000002'::uuid,
      'invoice','72000000-0000-4000-8000-000000000001'::uuid,null,current_date,'Pass 4 stress address','Hundred line delivery stress',
      (select jsonb_agg(jsonb_build_object(
        'id',md5('p4-hundred-delivery-line-'||line.line_number)::uuid,
        'sourceInvoiceLineId',line.id,'quantity',1
      ) order by line.line_number)
      from public.invoice_lines line
      where line.invoice_id='72000000-0000-4000-8000-000000000001'::uuid)
    )$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'A source-backed 100-line Delivery Note issues successfully'
);
select is(
  (select count(*)::integer from public.delivery_note_lines where delivery_note_id='73000000-0000-4000-8000-000000000001'::uuid),
  100,
  'The issued stress Delivery Note contains exactly 100 lines'
);

select lives_ok(
  format(
    $$select public.create_and_issue_credit_note_command(
      %L::uuid,'74000000-0000-4000-8000-000000000001'::uuid,'pass4-100-line-credit',
      '71000000-0000-4000-8000-000000000001'::uuid,'74000000-0000-4000-8000-000000000002'::uuid,
      '72000000-0000-4000-8000-000000000001'::uuid,'Hundred line quantity-backed credit',
      (select jsonb_agg(jsonb_build_object(
        'id',md5('p4-hundred-credit-line-'||line.line_number)::uuid,
        'sourceInvoiceLineId',line.id,'quantity',1
      ) order by line.line_number)
      from public.invoice_lines line
      where line.invoice_id='72000000-0000-4000-8000-000000000001'::uuid)
    )$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'A quantity-backed 100-line Credit Note issues successfully'
);
select is(
  (select count(*)::integer from public.credit_note_lines where credit_note_id='74000000-0000-4000-8000-000000000001'::uuid),
  100,
  'The issued stress Credit Note contains exactly 100 source-backed lines'
);
select is(
  (select adjusted_total_amount from public.invoice_account_balances where id='72000000-0000-4000-8000-000000000001'::uuid),
  0.0000::numeric,
  'The 100-line full Credit closes the live balance without rewriting the Invoice'
);

select throws_ok(
  format(
    $$select public.create_and_issue_invoice_command(
      %L::uuid,'75000000-0000-4000-8000-000000000001'::uuid,'manual','pass4-101-line-invoice',
      '71000000-0000-4000-8000-000000000001'::uuid,'75000000-0000-4000-8000-000000000002'::uuid,
      null,'71000000-0000-4000-8000-000000000002'::uuid,null,'Oversized Invoice must fail',null,
      (select jsonb_agg(jsonb_build_object(
        'id',md5('p4-oversized-invoice-line-'||g)::uuid,
        'lineType','service','serviceId','71000000-0000-4000-8000-000000000003',
        'quantity',1,'discountPercent',0
      ) order by g) from generate_series(1,101) g),null
    )$$,
    (select id::text from public.workspaces where slug='bdb-os')
  ),
  'P0001','An Invoice must contain between 1 and 100 lines',
  'A 101-line Invoice is rejected at the database mutation boundary'
);

select * from finish();
rollback;
