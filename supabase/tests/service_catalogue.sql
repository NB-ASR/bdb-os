begin;

select plan(18);

select has_table('public', 'services', 'Services table exists');
select has_table('public', 'service_command_receipts', 'Service command receipts table exists');
select has_function(
  'public',
  'apply_service_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','text','text','text','integer','integer','integer','numeric','numeric','text','text','text'],
  'trusted Service command exists'
);
select ok(
  exists (select 1 from pg_class where oid='public.services'::regclass and relrowsecurity),
  'Services use RLS'
);
select ok(
  exists (select 1 from pg_class where oid='public.service_command_receipts'::regclass and relrowsecurity),
  'Service receipts use RLS'
);
select ok(not has_table_privilege('anon','public.services','SELECT'), 'anonymous users cannot read Services');
select ok(has_table_privilege('authenticated','public.services','SELECT'), 'authenticated users retain RLS-scoped Service reads');
select ok(not has_table_privilege('authenticated','public.services','INSERT'), 'browser clients cannot insert Services directly');
select ok(not has_table_privilege('authenticated','public.services','UPDATE'), 'browser clients cannot update Services directly');
select ok(not has_table_privilege('authenticated','public.services','DELETE'), 'browser clients cannot delete Services');
select ok(not has_table_privilege('authenticated','public.service_command_receipts','SELECT'), 'browser clients cannot read Service receipts');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.services'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%unique (workspace_id, code)%'
  ),
  'Service codes are workspace-unique'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='services'
      and cmd='SELECT' and qual ilike '%services%view%'
  ),
  'Service reads require Services visibility'
);
select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.service_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Service writes use the shared support-aware permission boundary'
);
select ok(
  position('changed on another device' in pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) > 0,
  'Service command rejects stale versions'
);
select ok(
  position('service_command_receipts' in pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) > 0,
  'Service command stores idempotency receipts'
);
select ok(
  position('activity_items' in pg_get_functiondef('public.apply_service_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,integer,integer,integer,numeric,numeric,text,text,text)'::regprocedure)) > 0,
  'Service command writes Activity history'
);
select ok(to_regclass('public.service_staff') is null, 'Staff eligibility is not duplicated inside the Service foundation');

select * from finish();
rollback;
