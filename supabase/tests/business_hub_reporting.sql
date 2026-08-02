begin;

select plan(38);

select has_function('public', 'get_business_hub_access', array['uuid'], 'Business Hub access function exists');
select has_view('public', 'business_hub_operational_metrics', 'Business Hub operational metrics exist');
select has_view('public', 'business_hub_currency_metrics', 'Business Hub currency metrics exist');
select has_view('public', 'business_hub_attention', 'Business Hub attention view exists');
select has_view('public', 'business_hub_recent_activity', 'Business Hub recent activity exists');
select has_view('public', 'business_report_monthly_sales', 'Monthly Sales report exists');
select has_view('public', 'business_report_customer_sales', 'Customer Sales report exists');

select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_hub_operational_metrics'::regclass), false), 'Operational metrics preserve caller RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_hub_currency_metrics'::regclass), false), 'Currency metrics preserve caller RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_hub_attention'::regclass), false), 'Attention view preserves caller RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_hub_recent_activity'::regclass), false), 'Activity view preserves caller RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_report_monthly_sales'::regclass), false), 'Monthly report preserves caller RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.business_report_customer_sales'::regclass), false), 'Customer report preserves caller RLS');
select ok(not (select prosecdef from pg_proc where oid='public.get_business_hub_access(uuid)'::regprocedure), 'Business Hub access never elevates privileges');

select ok(has_function_privilege('authenticated','public.get_business_hub_access(uuid)','EXECUTE'), 'Authenticated users can resolve Business Hub access');
select ok(not has_function_privilege('anon','public.get_business_hub_access(uuid)','EXECUTE'), 'Anonymous users cannot resolve Business Hub access');
select ok(has_table_privilege('authenticated','public.business_hub_operational_metrics','SELECT'), 'Authenticated users can read operational metrics through RLS');
select ok(has_table_privilege('authenticated','public.business_hub_currency_metrics','SELECT'), 'Authenticated users can read currency metrics through RLS');
select ok(has_table_privilege('authenticated','public.business_hub_attention','SELECT'), 'Authenticated users can read attention through RLS');
select ok(has_table_privilege('authenticated','public.business_hub_recent_activity','SELECT'), 'Authenticated users can read activity through RLS');
select ok(has_table_privilege('authenticated','public.business_report_monthly_sales','SELECT'), 'Authenticated users can read monthly reports through RLS');
select ok(has_table_privilege('authenticated','public.business_report_customer_sales','SELECT'), 'Authenticated users can read Customer reports through RLS');
select ok(not has_table_privilege('anon','public.business_hub_currency_metrics','SELECT'), 'Anonymous users cannot read Business Hub financial metrics');

select ok(position('group by' in lower(pg_get_viewdef('public.business_hub_currency_metrics'::regclass, true))) > 0
  and position('currency' in lower(pg_get_viewdef('public.business_hub_currency_metrics'::regclass, true))) > 0,
  'Financial metrics remain grouped by currency');
select ok(position('exchange' in lower(pg_get_viewdef('public.business_hub_currency_metrics'::regclass, true))) = 0,
  'Business Hub does not infer exchange rates');
select ok(position('/accounts?tab=invoices&invoiceid=' in lower(pg_get_viewdef('public.business_hub_attention'::regclass, true))) > 0,
  'Invoice attention deep-links to the exact Invoice');
select ok(position('/communications?threadid=' in lower(pg_get_viewdef('public.business_hub_attention'::regclass, true))) > 0,
  'Communication attention deep-links to the exact thread');
select ok(position('/calendar?appointment=' in lower(pg_get_viewdef('public.business_hub_attention'::regclass, true))) > 0,
  'Appointment attention deep-links to the exact Appointment');
select ok(position('/inventory?productid=' in lower(pg_get_viewdef('public.business_hub_attention'::regclass, true))) > 0,
  'Inventory attention deep-links to the exact Product');
select ok(position('customer_360_activity' in lower(pg_get_viewdef('public.business_hub_recent_activity'::regclass, true))) > 0,
  'Business Hub reuses Customer 360 activity');
select ok(position('activity_items' in lower(pg_get_viewdef('public.business_hub_recent_activity'::regclass, true))) > 0,
  'Business Hub includes non-customer operational activity');
select ok(position("status = 'completed'" in lower(pg_get_viewdef('public.business_report_monthly_sales'::regclass, true))) > 0,
  'Monthly Sales reporting includes only completed Sales');
select ok(position("status = 'completed'" in lower(pg_get_viewdef('public.business_report_customer_sales'::regclass, true))) > 0,
  'Customer Sales reporting includes only completed Sales');
select ok(position('private.has_workspace_permission' in lower(pg_get_functiondef('public.get_business_hub_access(uuid)'::regprocedure))) > 0,
  'Business Hub access uses workspace permissions');
select ok(position("'reports'" in lower(pg_get_functiondef('public.get_business_hub_access(uuid)'::regprocedure))) > 0,
  'Business Hub access includes Reports permission');
select ok(position('attention_count' in lower(pg_get_viewdef('public.business_hub_operational_metrics'::regclass, true))) > 0,
  'Operational metrics expose one attention count');
select ok(position('low_stock_product_count' in lower(pg_get_viewdef('public.business_hub_operational_metrics'::regclass, true))) > 0,
  'Operational metrics include Stock attention');
select ok(position('supplier_payable_balances' in lower(pg_get_viewdef('public.business_hub_currency_metrics'::regclass, true))) > 0,
  'Currency metrics include authoritative Supplier Payables');

select * from finish();
rollback;
