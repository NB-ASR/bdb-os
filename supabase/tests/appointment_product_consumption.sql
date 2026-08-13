begin;

select plan(37);

select has_column('public', 'inventory_movements', 'appointment_id', 'Inventory movements expose a canonical Appointment link');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.inventory_movements'::regclass
    and contype = 'f'
    and confrelid = 'public.bookings'::regclass
    and conname = 'inventory_movements_workspace_appointment_fkey'
), 'Appointment Product usage references canonical Appointments');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.inventory_movements'::regclass
    and conname = 'inventory_movements_appointment_shape'
), 'Appointment movement source shape is constrained');
select ok(exists(
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'inventory_movements'
    and indexname = 'inventory_movements_workspace_appointment_time_idx'
), 'Appointment movement lookups have a covering index');
select has_function(
  'public',
  'post_appointment_product_consumption',
  array['uuid','uuid','uuid','uuid','uuid','numeric','text','uuid','uuid','timestamp with time zone','text'],
  'trusted Appointment Product consumption post command exists'
);
select has_function(
  'public',
  'reverse_appointment_product_consumption',
  array['uuid','uuid','uuid','text','uuid','uuid','text','timestamp with time zone'],
  'trusted Appointment Product consumption reversal exists'
);
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.inventory_movements'::regclass
    and tgname = 'inventory_movements_enforce_appointment_consumption'
    and not tgisinternal
), 'Appointment consumption movement trigger is active');
select ok((
  select prosecdef from pg_proc
  where oid = 'public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure
), 'Appointment consumption post command is security definer');
select ok((
  select prosecdef from pg_proc
  where oid = 'public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure
), 'Appointment consumption reversal is security definer');
select ok(not has_function_privilege(
  'anon',
  'public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)',
  'EXECUTE'
), 'anonymous users cannot post Appointment consumption');
select ok(not has_function_privilege(
  'authenticated',
  'public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)',
  'EXECUTE'
), 'browser clients cannot execute the trusted consumption post command');
select ok(has_function_privilege(
  'service_role',
  'public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)',
  'EXECUTE'
), 'service role can execute the consumption post command');
select ok(not has_function_privilege(
  'anon',
  'public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)',
  'EXECUTE'
), 'anonymous users cannot reverse Appointment consumption');
select ok(not has_function_privilege(
  'authenticated',
  'public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)',
  'EXECUTE'
), 'browser clients cannot execute the trusted consumption reversal');
select ok(has_function_privilege(
  'service_role',
  'public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)',
  'EXECUTE'
), 'service role can execute the consumption reversal');
select ok(position(
  'actor_has_workspace_permission' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption post uses shared workspace permissions');
select ok(position(
  '''inventory''' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption post is owned by Inventory permissions');
select ok(position(
  'Only completed Service Appointments can record Product consumption' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption requires a completed Service Appointment');
select ok(position(
  'purpose <> ''supply''' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption accepts supply Products only');
select ok(position(
  '''internal_consumption''' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'Appointment supplies use internal-consumption movements');
select ok(position(
  'appointment_id' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption inserts the canonical Appointment link');
select ok(position(
  'inventory_command_receipts' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption post stores idempotency receipts');
select ok(position(
  'activity_items' in
  pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure)
) > 0, 'consumption post writes Activity history');
select ok(position(
  'insert into public.sales' in lower(pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure))
) = 0, 'consumption post never creates a Sale');
select ok(position(
  'insert into public.invoices' in lower(pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure))
) = 0, 'consumption post never creates an invoice');
select ok(position(
  'insert into public.bank_transactions' in lower(pg_get_functiondef('public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone,text)'::regprocedure))
) = 0, 'consumption post never creates Banking activity');
select ok(position(
  'actor_has_workspace_permission' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'consumption reversal uses shared workspace permissions');
select ok(position(
  'Inventory movement is not Appointment Product consumption' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'reversal accepts only Appointment consumption movements');
select ok(position(
  'already been reversed' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'consumption can be reversed only once');
select ok(position(
  '''reversal''' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'corrections create immutable reversal movements');
select ok(position(
  'appointment_id' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'reversals preserve the canonical Appointment link');
select ok(position(
  'inventory_command_receipts' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'consumption reversal stores idempotency receipts');
select ok(position(
  'activity_items' in
  pg_get_functiondef('public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure)
) > 0, 'consumption reversal writes Activity history');
select ok(position(
  'Appointment Product use must be recorded as internal consumption' in
  pg_get_functiondef('private.enforce_appointment_inventory_movement()'::regprocedure)
) > 0, 'legacy Appointment movement types are rejected');
select ok(position(
  'canonical Appointment link' in
  pg_get_functiondef('private.enforce_appointment_inventory_movement()'::regprocedure)
) > 0, 'reserved Appointment sources require the canonical foreign key');
select ok(position(
  'post_appointment_consumption' in
  pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.inventory_command_receipts'::regclass and conname = 'inventory_command_receipts_action_check'))
) > 0, 'Inventory receipts accept Appointment consumption posts');
select ok(position(
  'reverse_appointment_consumption' in
  pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.inventory_command_receipts'::regclass and conname = 'inventory_command_receipts_action_check'))
) > 0, 'Inventory receipts accept Appointment consumption reversals');

select * from finish();
rollback;
