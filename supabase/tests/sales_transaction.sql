begin;

select plan(26);
select has_table('public','sales','Sales table exists');
select has_table('public','sale_lines','Sale lines table exists');
select has_table('public','sale_command_receipts','Sale command receipts table exists');
select has_function('public','complete_sale',array['uuid','uuid','text','uuid','uuid','jsonb','text','text','uuid','uuid','numeric','timestamp with time zone','text'],'trusted Sale completion command exists');
select has_function('public','reverse_sale',array['uuid','uuid','text','uuid','uuid','text'],'trusted Sale reversal command exists');
select ok(exists(select 1 from pg_class where oid='public.sales'::regclass and relrowsecurity),'Sales use RLS');
select ok(exists(select 1 from pg_class where oid='public.sale_lines'::regclass and relrowsecurity),'Sale lines use RLS');
select ok(exists(select 1 from pg_class where oid='public.sale_command_receipts'::regclass and relrowsecurity),'Sale receipts use RLS');
select ok(not has_table_privilege('anon','public.sales','SELECT'),'anonymous users cannot read Sales');
select ok(not has_table_privilege('anon','public.sale_lines','SELECT'),'anonymous users cannot read Sale lines');
select ok(has_table_privilege('authenticated','public.sales','SELECT'),'authenticated users retain RLS-scoped Sale reads');
select ok(has_table_privilege('authenticated','public.sale_lines','SELECT'),'authenticated users retain RLS-scoped Sale-line reads');
select ok(not has_table_privilege('authenticated','public.sales','INSERT'),'browser clients cannot insert Sales directly');
select ok(not has_table_privilege('authenticated','public.sales','UPDATE'),'browser clients cannot update Sales directly');
select ok(not has_table_privilege('authenticated','public.sales','DELETE'),'browser clients cannot delete Sales');
select ok(not has_table_privilege('authenticated','public.sale_lines','INSERT'),'browser clients cannot insert Sale lines directly');
select ok(not has_table_privilege('authenticated','public.sale_command_receipts','SELECT'),'browser clients cannot read Sale receipts');
select ok(exists(select 1 from pg_trigger where tgrelid='public.sale_lines'::regclass and tgname='sale_lines_immutable' and not tgisinternal),'Sale lines are immutable');
select ok(exists(select 1 from pg_trigger where tgrelid='public.sales'::regclass and tgname='sales_immutable_except_reversal' and not tgisinternal),'Sale headers only allow controlled reversal');
select ok(exists(select 1 from pg_trigger where tgrelid='public.sales'::regclass and tgname='sales_prepare_reference' and not tgisinternal),'Sale references use the hardened deterministic trigger');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='inventory_movements_single_sale_line_idx'),'one stock movement per Product Sale line is enforced');
select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.sales_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Sales use the shared support-aware permission boundary'
);
select ok(position('inventory_movements' in pg_get_functiondef('public.complete_sale(uuid,uuid,text,uuid,uuid,jsonb,text,text,uuid,uuid,numeric,timestamptz,text)'::regprocedure))>0,'Product Sale completion posts Inventory movements');
select ok(position('settlement_status' in pg_get_functiondef('public.complete_sale(uuid,uuid,text,uuid,uuid,jsonb,text,text,uuid,uuid,numeric,timestamptz,text)'::regprocedure))>0,'Sale completion preserves settlement boundary');
select ok(position('sale_command_receipts' in pg_get_functiondef('public.complete_sale(uuid,uuid,text,uuid,uuid,jsonb,text,text,uuid,uuid,numeric,timestamptz,text)'::regprocedure))>0,'Sale completion stores idempotency receipts');
select ok(to_regclass('public.payments') is null,'Sales does not introduce a duplicate Payment ledger');
select * from finish();
rollback;
