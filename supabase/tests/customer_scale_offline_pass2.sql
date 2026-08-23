begin;

select plan(14);

select has_function(
  'public',
  'list_customer_register_page',
  array['uuid','integer','text','uuid','text','text'],
  'bounded Customer register RPC exists'
);
select has_function(
  'public',
  'customer_register_summary',
  array['uuid'],
  'Customer register summary RPC exists'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'search_text'
      and is_generated = 'ALWAYS'
  ),
  'Customer search document is database-generated rather than client-maintained'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexname = 'customers_search_text_trgm_idx'
  ),
  'Customer substring search has a trigram index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexname = 'customers_workspace_status_name_cursor_idx'
  ),
  'Customer status register has a keyset cursor index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexname = 'customers_workspace_imported_name_cursor_idx'
  ),
  'Imported Customer register has a bounded cursor index'
);
select ok(
  position('security invoker' in lower(pg_get_functiondef('public.list_customer_register_page(uuid,integer,text,uuid,text,text)'::regprocedure))) > 0,
  'Customer register RPC preserves caller RLS with SECURITY INVOKER'
);
select ok(
  position('(customer.name, customer.id) > (p_after_name, p_after_id)' in lower(pg_get_functiondef('public.list_customer_register_page(uuid,integer,text,uuid,text,text)'::regprocedure))) > 0,
  'Customer register uses name/id keyset continuation'
);
select ok(
  position('least(greatest(coalesce(p_limit, 100), 1), 100) + 1' in lower(pg_get_functiondef('public.list_customer_register_page(uuid,integer,text,uuid,text,text)'::regprocedure))) > 0,
  'Customer register cannot request more than 100 display rows plus one continuation sentinel'
);
select ok(
  position('search_text like' in lower(pg_get_functiondef('public.list_customer_register_page(uuid,integer,text,uuid,text,text)'::regprocedure))) > 0,
  'Customer server search uses the generated indexed search document'
);
select ok(
  not has_function_privilege('anon', 'public.list_customer_register_page(uuid,integer,text,uuid,text,text)', 'EXECUTE'),
  'anonymous users cannot execute the Customer register RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.list_customer_register_page(uuid,integer,text,uuid,text,text)', 'EXECUTE'),
  'authenticated users can execute the RLS-scoped Customer register RPC'
);
select ok(
  not has_function_privilege('anon', 'public.customer_register_summary(uuid)', 'EXECUTE'),
  'anonymous users cannot execute Customer register summary'
);
select ok(
  has_function_privilege('authenticated', 'public.customer_register_summary(uuid)', 'EXECUTE'),
  'authenticated users can execute RLS-scoped Customer register summary'
);

select * from finish();
rollback;
