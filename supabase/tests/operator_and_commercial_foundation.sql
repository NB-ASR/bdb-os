begin;

select plan(24);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'operator_policies',
        'operator_runs',
        'operator_approvals',
        'operator_exceptions',
        'operator_delivery_attempts',
        'operator_value_events',
        'sales_enquiries'
      )
      and not relation.relrowsecurity
  ),
  'operator and commercial tables have RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.operator_runs', 'INSERT'),
  'browser sessions cannot insert operator runs directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.operator_runs', 'UPDATE'),
  'browser sessions cannot mutate operator runs directly'
);
select ok(
  has_table_privilege('authenticated', 'public.operator_runs', 'SELECT'),
  'members can read RLS-scoped operator runs'
);
select ok(
  has_table_privilege('service_role', 'public.operator_runs', 'INSERT'),
  'trusted worker retains operator write access'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.operator_runs'::regclass
      and confrelid = 'public.operator_policies'::regclass
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (workspace_id, workflow_key) REFERENCES operator_policies(workspace_id, workflow_key)%'
  ),
  'operator policy references cannot cross workspaces'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.operator_approvals'::regclass
      and confrelid = 'public.operator_runs'::regclass
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (run_id, workspace_id) REFERENCES operator_runs(id, workspace_id)%'
  ),
  'operator approval references cannot cross workspaces'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'operator_runs'
      and indexdef like '%UNIQUE%workspace_id%idempotency_key%'
  ),
  'operator run commands are idempotent per workspace'
);
select ok(
  position(
    'FOR UPDATE SKIP LOCKED' in upper(pg_get_functiondef('public.claim_operator_runs(integer,text)'::regprocedure))
  ) > 0,
  'workers claim runs without duplicate concurrent delivery'
);
select ok(
  position(
    'CURRENT_USER' in upper(pg_get_functiondef('public.claim_operator_runs(integer,text)'::regprocedure))
  ) > 0
  and position(
    'OPERATOR WORKER ACCESS DENIED' in upper(pg_get_functiondef('public.claim_operator_runs(integer,text)'::regprocedure))
  ) > 0,
  'worker claims reject non-service roles explicitly'
);
select ok(
  not has_function_privilege('anon', 'public.create_operator_run(uuid,text,text,text,text,jsonb,numeric,text)', 'EXECUTE'),
  'anonymous callers cannot create operator runs'
);
select ok(
  has_function_privilege('authenticated', 'public.create_operator_run(uuid,text,text,text,text,jsonb,numeric,text)', 'EXECUTE'),
  'authenticated members use the permission-checked operator command'
);
select ok(
  to_regprocedure('private.operator_workflow_is_published(uuid,text)') is not null,
  'operator commands are tied to a published Sector Pack workflow'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workspace_sector_configs'::regclass
      and tgname = 'workspace_sector_configs_sync_operator_policies'
      and not tgisinternal
  ),
  'published Sector Packs synchronise operator policy defaults'
);

select ok(
  not has_table_privilege('anon', 'public.sales_enquiries', 'INSERT'),
  'public browsers cannot bypass the sales intake command'
);
select ok(
  not has_table_privilege('authenticated', 'public.sales_enquiries', 'SELECT'),
  'client members cannot read the platform sales pipeline'
);
select ok(
  has_table_privilege('service_role', 'public.sales_enquiries', 'INSERT'),
  'trusted sales intake retains write access'
);
select ok(
  not has_function_privilege('anon', 'public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'),
  'anonymous callers cannot invoke commercial intake directly'
);
select ok(
  has_function_privilege('service_role', 'public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'),
  'commercial intake is service-role only'
);

select ok(
  to_regprocedure('public.plan_due_operator_runs(integer)') is not null,
  'durable Operator planner exists'
);
select ok(
  not has_function_privilege('authenticated', 'public.plan_due_operator_runs(integer)', 'EXECUTE'),
  'browser sessions cannot invoke the global planner'
);
select ok(
  has_function_privilege('service_role', 'public.plan_due_operator_runs(integer)', 'EXECUTE'),
  'trusted cron worker can invoke the planner'
);
select ok(
  position(
    'PG_ADVISORY_XACT_LOCK' in upper(pg_get_functiondef('public.plan_due_operator_runs(integer)'::regprocedure))
  ) > 0,
  'overlapping cron invocations cannot duplicate planning'
);
select ok(
  position(
    'PUBLIC.BOOKINGS' in upper(pg_get_functiondef('public.plan_due_operator_runs(integer)'::regprocedure))
  ) > 0
  and position(
    'PUBLIC.INVOICES' in upper(pg_get_functiondef('public.plan_due_operator_runs(integer)'::regprocedure))
  ) > 0
  and position(
    'PUBLIC.MESSAGES' in upper(pg_get_functiondef('public.plan_due_operator_runs(integer)'::regprocedure))
  ) > 0,
  'planner reads canonical business records'
);

select * from finish();
rollback;
