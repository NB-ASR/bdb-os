begin;

select plan(52);

select has_table('public','business_document_sequences','Business document sequence table exists');
select has_table('public','credit_notes','Credit Notes exist');
select has_table('public','credit_note_lines','Credit Note lines exist');
select has_table('public','delivery_notes','Delivery Notes exist');
select has_table('public','delivery_note_lines','Delivery Note lines exist');
select has_view('public','business_document_index','Unified business document index exists');

select has_column('public','workspace_settings','business_address','Business address is configurable');
select has_column('public','workspace_settings','vat_number','Business VAT number is configurable');
select has_column('public','workspace_settings','company_registration_number','Company registration number is configurable');
select has_column('public','workspace_settings','credit_note_prefix','Credit Note prefix is configurable');
select has_column('public','workspace_settings','delivery_note_prefix','Delivery Note prefix is configurable');
select has_column('public','customers','vat_number','Customer VAT identifier is available');
select has_column('public','invoices','supplier_vat_number_snapshot','Issued Invoices preserve supplier VAT identity');
select has_column('public','invoices','customer_vat_number_snapshot','Issued Invoices preserve customer VAT identity');
select has_column('public','invoices','final_number_assigned_at','Issued Invoices record authoritative number assignment');

select ok((select relrowsecurity from pg_class where oid='public.credit_notes'::regclass),'Credit Notes use RLS');
select ok((select relrowsecurity from pg_class where oid='public.credit_note_lines'::regclass),'Credit Note lines use RLS');
select ok((select relrowsecurity from pg_class where oid='public.delivery_notes'::regclass),'Delivery Notes use RLS');
select ok((select relrowsecurity from pg_class where oid='public.delivery_note_lines'::regclass),'Delivery Note lines use RLS');
select ok((select relrowsecurity from pg_class where oid='public.business_document_sequences'::regclass),'Document sequences use RLS');

select ok(has_table_privilege('authenticated','public.credit_notes','SELECT'),'Authenticated users receive RLS-scoped Credit Note reads');
select ok(not has_table_privilege('authenticated','public.credit_notes','INSERT'),'Browser clients cannot insert Credit Notes');
select ok(not has_table_privilege('authenticated','public.credit_notes','UPDATE'),'Browser clients cannot update Credit Notes');
select ok(has_table_privilege('authenticated','public.delivery_notes','SELECT'),'Authenticated users receive RLS-scoped Delivery Note reads');
select ok(not has_table_privilege('authenticated','public.delivery_notes','INSERT'),'Browser clients cannot insert Delivery Notes');
select ok(not has_table_privilege('authenticated','public.business_document_sequences','SELECT'),'Browser clients cannot inspect authoritative counters');

select has_function('public','apply_credit_note_command',array['uuid','uuid','text','text','uuid','uuid','integer','uuid','text','jsonb'],'Credit Note trusted command exists');
select has_function('public','apply_delivery_note_command',array['uuid','uuid','text','text','uuid','uuid','integer','text','uuid','date','text','text','jsonb'],'Delivery Note trusted command exists');
select has_function('private','next_business_document_number',array['uuid','text','text','date'],'Sequential business document numbering exists');
select ok(not has_function_privilege('authenticated','public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)','EXECUTE'),'Browser cannot execute Credit Note RPC directly');
select ok(has_function_privilege('service_role','public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)','EXECUTE'),'Service role can execute Credit Note RPC');
select ok(not has_function_privilege('authenticated','public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb)','EXECUTE'),'Browser cannot execute Delivery Note RPC directly');
select ok(has_function_privilege('service_role','public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb)','EXECUTE'),'Service role can execute Delivery Note RPC');

select ok(position('p_document_type' in pg_get_functiondef('private.next_business_document_number(uuid,text,text,date)'::regprocedure))>0,'Number generator scopes by document type');
select ok(position('series_year' in pg_get_functiondef('private.next_business_document_number(uuid,text,text,date)'::regprocedure))>0,'Number generator scopes by issue year');
select ok(position('on conflict' in lower(pg_get_functiondef('private.next_business_document_number(uuid,text,text,date)'::regprocedure)))>0,'Number generator increments atomically');
select ok(exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='invoices_assign_issue_identity' and not tgisinternal),'Invoice issue transition assigns legal identity and number');
select ok(position('next_business_document_number' in pg_get_functiondef('private.assign_invoice_issue_identity()'::regprocedure))>0,'Invoice issue uses shared sequential numbering');

select ok(position('Credit Note quantity exceeds the uncredited Invoice quantity' in pg_get_functiondef('private.write_credit_note_lines(uuid,uuid,uuid,jsonb)'::regprocedure))>0,'Credit Note prevents line over-crediting');
select ok(position('Credit Note exceeds the remaining Invoice value' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure))>0,'Credit Note prevents total over-crediting at issue');
select ok(position('Only an issued Invoice can be credited' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure))>0,'Credit Notes require an issued Invoice');
select ok(position('invoice_record.number' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure))>0,'Credit Note activity preserves original Invoice reference');
select ok(position('accounts_command_receipts' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure))>0,'Credit Note command is idempotent');

select ok(position('Delivery Note quantity exceeds the undelivered' in pg_get_functiondef('private.write_delivery_note_lines(uuid,uuid,text,uuid,jsonb)'::regprocedure))>0,'Delivery Note prevents over-delivery');
select ok(position('accounts_command_receipts' in pg_get_functiondef('public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb)'::regprocedure))>0,'Delivery Note command is idempotent');
select ok(position('insert into public.payment' in lower(pg_get_functiondef('public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb)'::regprocedure)))=0,'Delivery Note does not create Payments');
select ok(position('update public.invoices' in lower(pg_get_functiondef('public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,integer,text,uuid,date,text,text,jsonb)'::regprocedure)))=0,'Delivery Note does not alter Invoice accounting state');

select ok(exists(select 1 from pg_trigger where tgrelid='public.credit_note_lines'::regclass and tgname='credit_note_lines_immutability' and not tgisinternal),'Issued Credit Note lines are immutable');
select ok(exists(select 1 from pg_trigger where tgrelid='public.delivery_note_lines'::regclass and tgname='delivery_note_lines_immutability' and not tgisinternal),'Issued Delivery Note lines are immutable');
select ok(position('credited_amount' in pg_get_viewdef('public.invoice_account_balances'::regclass,true))>0,'Invoice balances subtract issued Credit Notes');
select ok(position('overallocated_credit' in pg_get_viewdef('public.customer_account_balances'::regclass,true))>0,'Credit after prior Payment becomes Customer credit');
select ok(position('delivery_note' in pg_get_viewdef('public.business_document_index'::regclass,true))>0,'Business document index includes Delivery Notes without accounting totals');

select * from finish();
rollback;
