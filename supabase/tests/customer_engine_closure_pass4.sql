begin;

select plan(40);

select has_table('public', 'customer_command_claims', 'Customer command claim ledger exists');
select ok((select relrowsecurity from pg_class where oid='public.customer_command_claims'::regclass), 'Customer command claims use RLS');
select ok(not has_table_privilege('authenticated','public.customer_command_claims','SELECT'), 'Browser clients cannot read Customer command claims');
select ok(not has_table_privilege('service_role','public.customer_command_claims','SELECT'), 'Service clients cannot bypass the Customer claim boundary directly');

select has_function(
  'private', 'claim_customer_command', array['uuid','text','text','uuid','jsonb'],
  'Internal Customer command claim helper exists'
);
select ok(
  not has_function_privilege('service_role','private.claim_customer_command(uuid,text,text,uuid,jsonb)','EXECUTE'),
  'Service clients cannot call the internal Customer claim helper directly'
);
select has_function(
  'public', 'execute_customer_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','text','text','text','text','text','text','text','jsonb','boolean','text'],
  'Hardened Customer lifecycle command exists'
);
select has_function(
  'public', 'execute_vanita_customer_import',
  array['uuid','uuid','text','uuid','uuid','text','jsonb'],
  'Hardened Vanita Customer import command exists'
);
select ok(
  not has_function_privilege('service_role','public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)','EXECUTE'),
  'Legacy Customer lifecycle RPC is retired from runtime service traffic'
);
select ok(
  not has_function_privilege('service_role','public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)','EXECUTE'),
  'Legacy Customer import RPC is retired from runtime service traffic'
);
select ok(
  has_function_privilege('service_role','public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)','EXECUTE'),
  'Service role can execute the hardened Customer lifecycle command'
);
select ok(
  not has_function_privilege('authenticated','public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)','EXECUTE'),
  'Browser clients cannot execute the hardened Customer lifecycle command directly'
);
select ok(
  has_function_privilege('service_role','public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)','EXECUTE'),
  'Service role can execute the hardened Customer import command'
);
select ok(
  not has_function_privilege('authenticated','public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)','EXECUTE'),
  'Browser clients cannot execute the hardened Customer import command directly'
);

select ok(
  position('customer_actor_can_write' in lower(pg_get_functiondef('public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure)))
    < position('claim_customer_command' in lower(pg_get_functiondef('public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))),
  'Customer lifecycle authorization occurs before replay claim lookup'
);
select ok(
  position('pg_advisory_xact_lock_shared' in lower(pg_get_functiondef('public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0,
  'Live Customer lifecycle work participates in the shared workspace Customer lock'
);
select ok(
  position('customer-email:' in lower(pg_get_functiondef('public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0,
  'Concurrent Customer email duplicate review is serialized'
);
select ok(
  position('customer-phone:' in lower(pg_get_functiondef('public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure))) > 0,
  'Concurrent Customer phone duplicate review is serialized'
);
select ok(
  position('pg_advisory_xact_lock' in lower(pg_get_functiondef('public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0
  and position('customer-master:' in lower(pg_get_functiondef('public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure))) > 0,
  'Customer imports take the exclusive workspace Customer reconciliation lock'
);
select ok(
  position('sha256' in lower(pg_get_functiondef('private.claim_customer_command(uuid,text,text,uuid,jsonb)'::regprocedure))) > 0
  and position('request_hash' in lower(pg_get_functiondef('private.claim_customer_command(uuid,text,text,uuid,jsonb)'::regprocedure))) > 0,
  'Customer idempotency claims bind keys to a SHA-256 request identity'
);

insert into auth.users(id,email)
values
  ('71000000-0000-4000-8000-000000000001'::uuid,'customer-pass4-owner@bdb.invalid'),
  ('71000000-0000-4000-8000-000000000002'::uuid,'customer-pass4-outsider@bdb.invalid');

update public.profiles
set full_name='Customer Pass 4 Owner', is_active=true
where id='71000000-0000-4000-8000-000000000001'::uuid;
update public.profiles
set full_name='Customer Pass 4 Outsider', is_active=true
where id='71000000-0000-4000-8000-000000000002'::uuid;

insert into public.workspaces(id,slug,name)
values
  ('71000000-0000-4000-8000-000000000011'::uuid,'customer-pass4-a','Customer Pass 4 A'),
  ('71000000-0000-4000-8000-000000000012'::uuid,'customer-pass4-b','Customer Pass 4 B');
update public.workspaces
set status='active', plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id in (
  '71000000-0000-4000-8000-000000000011'::uuid,
  '71000000-0000-4000-8000-000000000012'::uuid
);
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values
  ('71000000-0000-4000-8000-000000000011'::uuid,'71000000-0000-4000-8000-000000000001'::uuid,'owner','active','owner',now()),
  ('71000000-0000-4000-8000-000000000012'::uuid,'71000000-0000-4000-8000-000000000001'::uuid,'owner','active','owner',now());

select lives_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000021'::uuid,
    'create','customer-pass4-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000031'::uuid,
    null,'P4-CUST-1','Customer Pass 4 One','',
    'one@pass4.invalid','+356 9900 0001',null,null,'{}'::jsonb,false,null
  )
$sql$, 'A Customer lifecycle command can be claimed and committed');

select lives_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000021'::uuid,
    'create','customer-pass4-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000032'::uuid,
    null,'P4-CUST-1','Customer Pass 4 One','',
    'one@pass4.invalid','+356 9900 0001',null,null,'{}'::jsonb,false,null
  )
$sql$, 'An exact Customer retry safely replays the original result');

select is(
  (select count(*) from public.customers where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and id='71000000-0000-4000-8000-000000000021'::uuid),
  1::bigint,
  'Exact Customer replay creates one Customer only'
);
select is(
  (select count(*) from public.customer_command_receipts where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-create'),
  1::bigint,
  'Exact Customer replay stores one lifecycle receipt only'
);
select is(
  (select count(*) from public.customer_command_claims where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-create'),
  1::bigint,
  'Exact Customer replay stores one request claim only'
);
select is(
  (select count(*) from public.activity_items where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and entity_type='customer' and entity_id='71000000-0000-4000-8000-000000000021'),
  1::bigint,
  'Exact Customer replay emits one business activity event only'
);
select is(
  (select command_type from public.customer_command_claims where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-create'),
  'lifecycle',
  'Customer lifecycle claim records its command domain'
);

select throws_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000021'::uuid,
    'create','customer-pass4-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000033'::uuid,
    null,'P4-CUST-1','DIFFERENT INPUT','',
    'one@pass4.invalid','+356 9900 0001',null,null,'{}'::jsonb,false,null
  )
$sql$, 'P0001', 'Customer idempotency key was reused with different input', 'A Customer retry key cannot be reused for different lifecycle input');
select is(
  (select name from public.customers where id='71000000-0000-4000-8000-000000000021'::uuid),
  'Customer Pass 4 One',
  'Rejected idempotency reuse cannot mutate the original Customer'
);

select throws_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000021'::uuid,
    'create','customer-pass4-create',
    '71000000-0000-4000-8000-000000000002'::uuid,
    '71000000-0000-4000-8000-000000000034'::uuid,
    null,'P4-CUST-1','Customer Pass 4 One','',
    'one@pass4.invalid','+356 9900 0001',null,null,'{}'::jsonb,false,null
  )
$sql$, 'P0001', 'Customer write access denied', 'An unauthorized actor cannot replay a known Customer idempotency key');

select throws_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000021'::uuid,
    'update','customer-pass4-stale',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000035'::uuid,
    999,'P4-CUST-1','Stale Update','',
    'one@pass4.invalid','+356 9900 0001',null,null,'{}'::jsonb,false,null
  )
$sql$, 'P0001', 'Customer changed on another device; refresh before saving', 'A stale Customer edit is rejected after claim validation');
select is(
  (select count(*) from public.customer_command_claims where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-stale'),
  0::bigint,
  'A failed Customer command rolls back its request claim so a corrected retry may proceed'
);

select lives_ok($sql$
  select public.execute_customer_command(
    '71000000-0000-4000-8000-000000000012'::uuid,
    '71000000-0000-4000-8000-000000000022'::uuid,
    'create','customer-pass4-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000036'::uuid,
    null,'P4-CUST-2','Customer Pass 4 Two','',
    'two@pass4.invalid','+356 9900 0002',null,null,'{}'::jsonb,false,null
  )
$sql$, 'The same idempotency key is safely reusable in another workspace');
select is(
  (select count(*) from public.customer_command_claims where idempotency_key='customer-pass4-create'),
  2::bigint,
  'Customer request claims remain workspace-scoped'
);

select lives_ok($sql$
  select public.execute_vanita_customer_import(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000041'::uuid,
    'customer-pass4-import',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000051'::uuid,
    'snapshot-pass4-a',
    '[{"id":"legacy-pass4-1","name":"Imported Pass 4","email":"imported@pass4.invalid"}]'::jsonb
  )
$sql$, 'A Vanita Customer import can be claimed and committed');
select lives_ok($sql$
  select public.execute_vanita_customer_import(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000041'::uuid,
    'customer-pass4-import',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000052'::uuid,
    'snapshot-pass4-a',
    '[{"id":"legacy-pass4-1","name":"Imported Pass 4","email":"imported@pass4.invalid"}]'::jsonb
  )
$sql$, 'An exact Vanita Customer import retry safely replays the original result');
select is(
  (select count(*) from public.customer_import_batches where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-import'),
  1::bigint,
  'Exact Customer import replay stores one import batch only'
);
select is(
  (select count(*) from public.customer_command_claims where workspace_id='71000000-0000-4000-8000-000000000011'::uuid and idempotency_key='customer-pass4-import' and command_type='vanita_import'),
  1::bigint,
  'Exact Customer import replay stores one import request claim only'
);
select throws_ok($sql$
  select public.execute_vanita_customer_import(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000041'::uuid,
    'customer-pass4-import',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000053'::uuid,
    'snapshot-pass4-a',
    '[{"id":"legacy-pass4-1","name":"CHANGED IMPORT","email":"imported@pass4.invalid"}]'::jsonb
  )
$sql$, 'P0001', 'Customer idempotency key was reused with different input', 'A Customer import retry key cannot be reused for different source input');
select throws_ok($sql$
  select public.execute_vanita_customer_import(
    '71000000-0000-4000-8000-000000000011'::uuid,
    '71000000-0000-4000-8000-000000000042'::uuid,
    'customer-pass4-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000054'::uuid,
    'snapshot-cross-domain',
    '[]'::jsonb
  )
$sql$, 'P0001', 'Customer idempotency key was reused with different input', 'One Customer idempotency key cannot cross lifecycle and import command domains');

select * from finish();
rollback;
