begin;

select plan(13);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.platform_support_sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%read_only%test_write%'
  ),
  'support sessions distinguish read-only and guarded test-write access'
);

select has_function(
  'private',
  'has_test_write_support_session',
  array['uuid','uuid'],
  'actor-scoped test-write support helper exists'
);

select has_function(
  'private',
  'actor_has_workspace_permission',
  array['uuid','uuid','text','text'],
  'actor-scoped permission helper exists'
);

select ok(
  position('has_test_write_support_session' in lower(pg_get_functiondef(
    'private.has_workspace_permission(uuid,text,text)'::regprocedure
  ))) > 0,
  'browser workspace permissions recognise test-write sessions'
);

select ok(
  position('has_active_support_session' in lower(pg_get_functiondef(
    'private.has_workspace_permission(uuid,text,text)'::regprocedure
  ))) > 0,
  'normal support sessions remain read-only'
);

select ok(
  position('has_test_write_support_session' in lower(pg_get_functiondef(
    'private.can_write_workspace(uuid)'::regprocedure
  ))) > 0,
  'legacy workspace writes recognise guarded Founder testing'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.product_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Product commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.supplier_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Supplier commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.product_supplier_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Product-Supplier commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.supplier_document_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Purchasing commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.inventory_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Inventory commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.service_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Service commands use the shared actor permission boundary'
);

select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.sales_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Sales commands use the shared actor permission boundary'
);

select * from finish();
rollback;
