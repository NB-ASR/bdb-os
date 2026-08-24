begin;

select plan(29);

select has_table('public', 'calendar_command_claims', 'Calendar command claim ledger exists');
select has_function(
  'private',
  'claim_calendar_command',
  array['uuid','text','text','uuid','jsonb'],
  'Calendar command claim helper exists'
);
select has_function(
  'public',
  'apply_appointment_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','uuid','uuid','uuid','date','time without time zone','text','text','text','text','text'],
  'hardened Appointment runtime command keeps the canonical function name'
);
select has_function(
  'public',
  'apply_calendar_availability_command',
  array['uuid','text','text','text','uuid','uuid','uuid','integer','uuid','smallint','time without time zone','time without time zone','timestamp without time zone','timestamp without time zone','text','text','text','text','boolean'],
  'hardened availability runtime command keeps the canonical function name'
);
select has_function(
  'public',
  'apply_calendar_service_eligibility_command',
  array['uuid','uuid','uuid','boolean','text','uuid','uuid','integer'],
  'hardened Service eligibility runtime command keeps the canonical function name'
);

select ok(
  exists(select 1 from pg_class where oid='public.calendar_command_claims'::regclass and relrowsecurity),
  'Calendar command claims use RLS'
);
select ok(not has_table_privilege('authenticated','public.calendar_command_claims','SELECT'), 'browser clients cannot read Calendar command claims');
select ok(not has_table_privilege('service_role','public.calendar_command_claims','SELECT'), 'service role cannot bypass the Calendar claim helper with direct reads');

select ok(
  has_function_privilege(
    'service_role',
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role executes only the hardened Appointment runtime command'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.apply_appointment_command_legacy(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role cannot execute the legacy Appointment command directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_calendar_availability_command(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)',
    'EXECUTE'
  ),
  'service role executes only the hardened availability runtime command'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.apply_calendar_availability_command_legacy(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)',
    'EXECUTE'
  ),
  'service role cannot execute the legacy availability command directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_calendar_service_eligibility_command(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'service role executes only the hardened eligibility runtime command'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.apply_calendar_service_eligibility_command_legacy(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'service role cannot execute the legacy eligibility command directly'
);

select ok(
  position('appointment_actor_can_write' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) < position('claim_calendar_command' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )),
  'Appointment authorization happens before idempotency claim/replay'
);
select ok(
  position('calendar_availability_actor_can_manage' in pg_get_functiondef(
    'public.apply_calendar_availability_command(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)'::regprocedure
  )) < position('claim_calendar_command' in pg_get_functiondef(
    'public.apply_calendar_availability_command(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)'::regprocedure
  )),
  'availability authorization happens before idempotency claim/replay'
);
select ok(
  position('calendar_service_eligibility_actor_can_manage' in pg_get_functiondef(
    'public.apply_calendar_service_eligibility_command(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)'::regprocedure
  )) < position('claim_calendar_command' in pg_get_functiondef(
    'public.apply_calendar_service_eligibility_command(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)'::regprocedure
  )),
  'eligibility authorization happens before idempotency claim/replay'
);
select ok(
  position('appointment_command_receipts' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > position('claim_calendar_command' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )),
  'Appointment replay is consulted only after the actor/request claim is verified'
);
select ok(
  position('schedule_before' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment reschedules preserve the prior schedule in Activity metadata'
);
select ok(
  position('schedule_after' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment reschedules preserve the resulting schedule in Activity metadata'
);
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid='public.calendar_command_claims'::regclass
      and contype='p'
      and pg_get_constraintdef(oid) ilike '%primary key (workspace_id, idempotency_key)%'
  ),
  'one workspace-scoped idempotency key can own only one Calendar command claim'
);
select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='calendar_command_claims'
      and column_name='request_hash' and is_nullable='NO'
  ),
  'Calendar claims always store a request hash'
);

insert into public.workspaces (id, slug, name)
values ('00000000-0000-4000-8000-00000000ca11', 'calendar-pass1-claim-test', 'Calendar Pass 1 Claim Test');

select lives_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-stable-key',
    'appointment',
    '00000000-0000-4000-8000-00000000a001',
    '{"action":"create","bookingId":"00000000-0000-4000-8000-00000000b001"}'::jsonb
  )$$,
  'first Calendar command claim is accepted'
);
select lives_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-stable-key',
    'appointment',
    '00000000-0000-4000-8000-00000000a001',
    '{"bookingId":"00000000-0000-4000-8000-00000000b001","action":"create"}'::jsonb
  )$$,
  'same actor and canonical JSON payload safely reuses the same key'
);
select throws_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-stable-key',
    'appointment',
    '00000000-0000-4000-8000-00000000a001',
    '{"action":"create","bookingId":"00000000-0000-4000-8000-00000000b002"}'::jsonb
  )$$,
  'Calendar idempotency key was reused with different input',
  'same Calendar key cannot be reused with a different payload'
);
select throws_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-stable-key',
    'appointment',
    '00000000-0000-4000-8000-00000000a002',
    '{"action":"create","bookingId":"00000000-0000-4000-8000-00000000b001"}'::jsonb
  )$$,
  'Calendar idempotency key was reused with different input',
  'same Calendar key cannot be reused by a different actor'
);
select throws_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-stable-key',
    'availability',
    '00000000-0000-4000-8000-00000000a001',
    '{"action":"create","bookingId":"00000000-0000-4000-8000-00000000b001"}'::jsonb
  )$$,
  'Calendar idempotency key was reused with different input',
  'same Calendar key cannot jump between command domains'
);
select throws_ok(
  $$select private.claim_calendar_command(
    '00000000-0000-4000-8000-00000000ca11',
    'pass1-legacy-domain',
    'legacy_appointment',
    '00000000-0000-4000-8000-00000000a001',
    '{}'::jsonb
  )$$,
  'Calendar command domain is invalid',
  'runtime callers cannot create unverifiable legacy claims'
);
select ok(
  exists(
    select 1 from public.calendar_command_claims
    where workspace_id='00000000-0000-4000-8000-00000000ca11'
      and idempotency_key='pass1-stable-key'
      and request_hash ~ '^[0-9a-f]{64}$'
  ),
  'Calendar claim stores a SHA-256 request hash'
);

select * from finish();
rollback;