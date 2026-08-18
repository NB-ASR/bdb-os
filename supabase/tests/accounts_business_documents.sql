begin;

select plan(48);

select has_table('public','workspace_document_sequences','Workspace document sequence table exists');
select has_table('public','credit_notes','Credit Note table exists');
select has_table('public','credit_note_lines','Credit Note lines exist');
select has_table('public','delivery_notes','Delivery Note table exists');
select has_table('public','delivery_note_lines','Delivery Note lines exist');
select has_view('public','business_document_index','Business document index exists');

select has_column('public','workspace_settings','business_address','Business address is stored for document identity');
select has_column('public','workspace_settings','vat_number','Business VAT number is stored');
select has_column('public','customers','vat_number','Customer VAT number is available');
select has_column('public','invoices','supply_date','Invoices carry supply date');
select has_column('public','invoices','customer_address_snapshot','Issued Invoice customer address is snapshotted');
select has_column('public','invoices','supplier_vat_number_snapshot','Issued Invoice supplier VAT identity is snapshotted');

select ok((select relrowsecurity from pg_class where oid='public.workspace_document_sequences'::regclass),'Document sequences use RLS');
select ok((select relrowsecurity from pg_class where oid='public.credit_notes'::regclass),'Credit Notes use RLS');
select ok((select relrowsecurity from pg_class where oid='public.credit_note_lines'::regclass),'Credit Note lines use RLS');
select ok((select relrowsecurity from pg_class where oid='public.delivery_notes'::regclass),'Delivery Notes use RLS');
select ok((select relrowsecurity from pg_class where oid='public.delivery_note_lines'::regclass),'Delivery Note lines use RLS');

select ok(not has_table_privilege('anon','public.credit_notes','SELECT'),'Anonymous users cannot read Credit Notes');
select ok(has_table_privilege('authenticated','public.credit_notes','SELECT'),'Authenticated Credit Note reads are RLS scoped');
select ok(not has_table_privilege('authenticated','public.credit_notes','INSERT'),'Browser clients cannot insert Credit Notes directly');
select ok(not has_table_privilege('authenticated','public.credit_notes','UPDATE'),'Browser clients cannot update Credit Notes directly');
select ok(has_table_privilege('authenticated','public.delivery_notes','SELECT'),'Authenticated Delivery Note reads are RLS scoped');
select ok(not has_table_privilege('authenticated','public.delivery_notes','INSERT'),'Browser clients cannot insert Delivery Notes directly');
select ok(not has_table_privilege('authenticated','public.workspace_document_sequences','SELECT'),'Document numbering state is hidden from browser clients');

select has_function('public','apply_credit_note_command',array['uuid','uuid','text','text','uuid','uuid','uuid','integer','text','text','jsonb','text'],'Trusted Credit Note command exists');
select has_function('public','apply_delivery_note_command',array['uuid','uuid','text','text','uuid','uuid','uuid','uuid','integer','date','text','text','jsonb','text'],'Trusted Delivery Note command exists');
select has_function('public','apply_invoice_document_metadata',array['uuid','uuid','text','uuid','uuid','integer','date','text'],'Trusted Invoice document metadata command exists');
select ok(not has_function_privilege('authenticated','public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text)','EXECUTE'),'Browser clients cannot execute Credit Note commands directly');
select ok(not has_function_privilege('authenticated','public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text)','EXECUTE'),'Browser clients cannot execute Delivery Note commands directly');
select ok(has_function_privilege('service_role','public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text)','EXECUTE'),'Service role can execute Credit Note commands');
select ok(has_function_privilege('service_role','public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text)','EXECUTE'),'Service role can execute Delivery Note commands');

select ok(position('Credit quantity exceeds the original Invoice line' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text)'::regprocedure))>0,'Credit Note issue rechecks over-crediting');
select ok(position('Credit quantity exceeds the original Invoice line' in pg_get_functiondef('private.rewrite_credit_note_lines(uuid,uuid,uuid,jsonb)'::regprocedure))>0,'Credit Note draft creation blocks known over-crediting');
select ok(position('note.status=''issued''' in pg_get_functiondef('private.rewrite_credit_note_lines(uuid,uuid,uuid,jsonb)'::regprocedure))>0,'Only issued prior Credit Notes consume the credit allowance');
select ok(position('private.next_business_document_number' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text)'::regprocedure))>0,'Credit Notes receive authoritative issue-time numbers');
select ok(position('private.next_business_document_number' in pg_get_functiondef('public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text)'::regprocedure))>0,'Delivery Notes receive authoritative issue-time numbers');
select ok(position('on conflict (workspace_id, document_type, series_year)' in lower(pg_get_functiondef('private.next_business_document_number(uuid,text,date)'::regprocedure)))>0,'Document numbering is atomically workspace/type/year scoped');

select ok(exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='invoices_prepare_issue' and not tgisinternal),'Invoice issue snapshots and final numbering are guarded by a trigger');
select ok(exists(select 1 from pg_trigger where tgrelid='public.credit_notes'::regclass and tgname='credit_notes_enforce_immutability' and not tgisinternal),'Issued Credit Note headers have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.credit_note_lines'::regclass and tgname='credit_note_lines_enforce_immutability' and not tgisinternal),'Issued Credit Note lines have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.delivery_notes'::regclass and tgname='delivery_notes_enforce_immutability' and not tgisinternal),'Issued Delivery Note headers have an immutability guard');
select ok(exists(select 1 from pg_trigger where tgrelid='public.delivery_note_lines'::regclass and tgname='delivery_note_lines_enforce_immutability' and not tgisinternal),'Issued Delivery Note lines have an immutability guard');

select ok(position('credit_note_amount' in pg_get_viewdef('public.invoice_account_balances'::regclass,true))>0,'Invoice balances account for issued Credit Notes');
select ok(position('excess_allocated_amount' in pg_get_viewdef('public.invoice_account_balances'::regclass,true))>0,'Credit after payment is retained as Customer credit rather than lost');
select ok(position('delivery_notes' in pg_get_viewdef('public.invoice_account_balances'::regclass,true))=0,'Delivery Notes have zero Invoice balance effect');
select ok(position('delivery_notes' in pg_get_viewdef('public.customer_account_balances'::regclass,true))=0,'Delivery Notes have zero Customer balance effect');
select ok(position('accounts_command_receipts' in pg_get_functiondef('public.apply_credit_note_command(uuid,uuid,text,text,uuid,uuid,uuid,integer,text,text,jsonb,text)'::regprocedure))>0,'Credit Note commands are idempotent through Accounts receipts');
select ok(position('accounts_command_receipts' in pg_get_functiondef('public.apply_delivery_note_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,integer,date,text,text,jsonb,text)'::regprocedure))>0,'Delivery Note commands are idempotent through Accounts receipts');

select ok((select count(*)=3 from pg_class where oid in ('public.business_document_index'::regclass,'public.invoice_account_balances'::regclass,'public.customer_account_balances'::regclass) and reloptions @> array['security_invoker=true']),'Business document and balance views execute as the caller');
select ok(exists(select 1 from pg_constraint where conrelid='public.credit_notes'::regclass and confrelid='public.invoices'::regclass),'Credit Notes use workspace-safe Invoice foreign keys');
select ok(exists(select 1 from pg_constraint where conrelid='public.delivery_notes'::regclass and confrelid='public.invoices'::regclass),'Delivery Notes use workspace-safe Invoice foreign keys');
select ok(exists(select 1 from pg_constraint where conrelid='public.delivery_notes'::regclass and confrelid='public.sales'::regclass),'Delivery Notes use workspace-safe Sale foreign keys');

select * from finish();
rollback;
