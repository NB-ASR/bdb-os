begin;

select plan(8);

select has_table('public', 'sales_enquiries', 'Sales enquiry store exists');
select ok((select relrowsecurity from pg_class where oid = 'public.sales_enquiries'::regclass), 'Sales enquiry store has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.sales_enquiries', 'SELECT'), 'Authenticated browsers cannot read raw enquiries');
select has_function('public', 'submit_sales_enquiry', array['text','text','text','text','text','text','text','text','text','text','text','text'], 'Trusted enquiry function exists');
select ok(has_function_privilege('service_role', 'public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'), 'Service role can submit enquiries');
select ok(not has_function_privilege('authenticated', 'public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'), 'Authenticated browser sessions cannot bypass the server route');
select ok(not has_function_privilege('anon', 'public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'), 'Anonymous browser sessions cannot execute the intake function directly');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)'::regprocedure)) > 0, 'Per-IP rate limiting is serialised against concurrent submissions');

select * from finish();
rollback;
