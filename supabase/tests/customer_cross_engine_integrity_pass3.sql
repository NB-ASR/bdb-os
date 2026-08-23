begin;

select plan(30);

select has_function(
  'private',
  'enforce_customer_document_link_target',
  array[]::text[],
  'Customer Document typed-link integrity guard exists'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.document_links'::regclass
      and tgname = 'document_links_customer_target_guard'
      and not tgisinternal
  ),
  'Customer Document links are guarded at the table boundary'
);

select ok(
  (select prosecdef from pg_proc where oid = 'private.enforce_customer_document_link_target()'::regprocedure),
  'Customer Document link guard has stable definer access to validate the Customer target'
);

select ok(
  not has_function_privilege('anon', 'private.enforce_customer_document_link_target()', 'EXECUTE'),
  'Anonymous users cannot execute the internal Customer Document link guard'
);

select ok(
  has_function_privilege('service_role', 'private.enforce_customer_document_link_target()', 'EXECUTE'),
  'Trusted service commands can execute the Customer Document link guard'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'communication_threads'
      and indexname = 'communication_threads_workspace_id_customer_uidx'
  ),
  'Communication threads expose a workspace/thread/Customer candidate key'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'messages'
      and indexname = 'messages_workspace_thread_id_uidx'
  ),
  'Communication messages expose a workspace/thread/message candidate key'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_workspace_thread_customer_fkey'
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, thread_id, customer_id) REFERENCES communication_threads(workspace_id, id, customer_id)%'
  ),
  'Every Communication message is constrained to the same workspace and Customer as its thread'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_workspace_thread_reply_fkey'
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, thread_id, reply_to_message_id) REFERENCES messages(workspace_id, thread_id, id)%'
  ),
  'Communication replies cannot cross workspace or thread'
);

select has_view('public', 'customer_360_communication_summary', 'Customer Communication summary exists');
select has_view('public', 'customer_360_operational_summary', 'Customer operational summary exists');

select ok(
  coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_communication_summary'::regclass), false),
  'Customer Communication summary preserves invoker RLS'
);

select ok(
  coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_operational_summary'::regclass), false),
  'Customer operational summary preserves invoker RLS'
);

select ok(
  position('customer_360_communication_summary' in lower(pg_get_viewdef('public.customer_360_operational_summary'::regclass, true))) > 0,
  'Customer operational summary reuses the unified Communication summary'
);

select ok(
  position('from public.messages' in lower(pg_get_viewdef('public.customer_360_operational_summary'::regclass, true))) = 0,
  'Customer operational summary does not recalculate Communication counts from raw messages'
);

select ok(
  exists (
    select 1
    from information_schema.view_table_usage
    where view_schema = 'public'
      and view_name = 'customer_360_communication_summary'
      and table_schema = 'public'
      and table_name = 'communication_threads'
  )
  and exists (
    select 1
    from information_schema.view_table_usage
    where view_schema = 'public'
      and view_name = 'customer_360_communication_summary'
      and table_schema = 'public'
      and table_name = 'messages'
  ),
  'Customer Communication summary structurally composes messages through authoritative Communication threads'
);

select ok(
  position('unified_communication_lifecycle' in lower(pg_get_viewdef('public.customer_360_communication_summary'::regclass, true))) > 0,
  'Customer Communication last activity includes thread lifecycle events'
);

select ok(
  has_table_privilege('authenticated', 'public.customer_360_communication_summary', 'SELECT'),
  'Authenticated users can read the RLS-scoped Customer Communication summary'
);

select ok(
  not has_table_privilege('anon', 'public.customer_360_communication_summary', 'SELECT'),
  'Anonymous users cannot read the Customer Communication summary'
);

select ok(
  position('public.customers' in lower(pg_get_functiondef('private.enforce_customer_document_link_target()'::regprocedure))) > 0
  and position('customer.workspace_id = new.workspace_id' in lower(pg_get_functiondef('private.enforce_customer_document_link_target()'::regprocedure))) > 0
  and position('customer.id = new.target_id' in lower(pg_get_functiondef('private.enforce_customer_document_link_target()'::regprocedure))) > 0,
  'Customer Document typed links validate the exact Customer inside the same workspace'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Appointments enforce workspace-safe Customer identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.sales'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Sales enforce workspace-safe Customer identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Invoices enforce workspace-safe Customer identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Customer Payments enforce workspace-safe Customer identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.communication_threads'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Communication threads enforce workspace-safe Customer identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.credit_notes'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Credit Notes retain the frozen Accounts workspace-safe Customer identity contract'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.delivery_notes'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id)%'
  ),
  'Delivery Notes retain the frozen Accounts workspace-safe Customer identity contract'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.get_customer_360_access(uuid)'::regprocedure),
  'Customer 360 section access remains SECURITY INVOKER'
);

select ok(
  coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_financial_summary'::regclass), false),
  'Customer financial summary remains an invoker-RLS read model over frozen Accounts balances'
);

select ok(
  coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.customer_360_activity'::regclass), false),
  'Customer unified activity remains an invoker-RLS read model'
);

select * from finish();
rollback;
