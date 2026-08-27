begin;

select plan(24);

select has_table('public', 'calendar_staff_service_eligibility', 'Staff-to-Service eligibility table exists');
select has_table('public', 'calendar_service_eligibility_command_receipts', 'Eligibility command receipts table exists');
select has_function(
  'public',
  'apply_calendar_service_eligibility_command',
  array['uuid','uuid','uuid','boolean','text','uuid','uuid','integer'],
  'trusted eligibility command exists'
);
select has_function('private', 'enforce_booking_service_eligibility', array[]::text[], 'Appointment eligibility trigger function exists');
select ok(exists(
  select 1 from pg_class
  where oid = 'public.calendar_staff_service_eligibility'::regclass and relrowsecurity
), 'Eligibility assignments use RLS');
select ok(exists(
  select 1 from pg_class
  where oid = 'public.calendar_service_eligibility_command_receipts'::regclass and relrowsecurity
), 'Eligibility receipts use RLS');
select ok(not has_table_privilege('anon', 'public.calendar_staff_service_eligibility', 'SELECT'), 'anonymous users cannot read eligibility assignments');
select ok(has_table_privilege('authenticated', 'public.calendar_staff_service_eligibility', 'SELECT'), 'authenticated users receive eligibility read privilege');
select ok(not has_table_privilege('authenticated', 'public.calendar_staff_service_eligibility', 'INSERT'), 'browser clients cannot insert eligibility assignments directly');
select ok(not has_table_privilege('authenticated', 'public.calendar_staff_service_eligibility', 'UPDATE'), 'browser clients cannot update eligibility assignments directly');
select ok(not has_table_privilege('authenticated', 'public.calendar_staff_service_eligibility', 'DELETE'), 'browser clients cannot delete eligibility assignments directly');
select ok(not has_table_privilege('authenticated', 'public.calendar_service_eligibility_command_receipts', 'SELECT'), 'browser clients cannot read eligibility receipts');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.bookings'::regclass
    and tgname = 'bookings_enforce_service_eligibility'
    and not tgisinternal
), 'Appointment eligibility trigger is active');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.calendar_staff_service_eligibility'::regclass
    and conname = 'calendar_staff_service_eligibility_pkey'
    and contype = 'p'
), 'Eligibility uses a composite primary key');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.calendar_staff_service_eligibility'::regclass
    and contype = 'f'
    and confrelid = 'public.workspace_memberships'::regclass
), 'Eligibility references the canonical workspace membership');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.calendar_staff_service_eligibility'::regclass
    and contype = 'f'
    and confrelid = 'public.services'::regclass
), 'Eligibility references the canonical Service');
select ok(position(
  'actor_has_workspace_permission' in
  pg_get_functiondef('private.calendar_service_eligibility_actor_can_manage(uuid,uuid)'::regprocedure)
) > 0, 'eligibility management uses shared support-aware permission checks');
select ok(position(
  '''approve''' in
  pg_get_functiondef('private.calendar_service_eligibility_actor_can_manage(uuid,uuid)'::regprocedure)
) > 0, 'eligibility management requires Calendar approval permission');
select ok(position(
  'calendar_staff_service_eligibility' in
  pg_get_functiondef('private.enforce_booking_service_eligibility()'::regprocedure)
) > 0, 'Appointment writes consult eligibility assignments');
select ok(position(
  'not eligible for this Service' in
  pg_get_functiondef('private.enforce_booking_service_eligibility()'::regprocedure)
) > 0, 'Appointment writes report an explicit eligibility failure');
select ok(position(
  'calendar_service_eligibility_command_receipts' in
  pg_get_functiondef('public.apply_calendar_service_eligibility_command_legacy(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)'::regprocedure)
) > 0, 'eligibility business rules store idempotency receipts');
select ok(position(
  'activity_items' in
  pg_get_functiondef('public.apply_calendar_service_eligibility_command_legacy(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)'::regprocedure)
) > 0, 'eligibility business rules write Activity history');
select ok(position(
  'Reschedule or cancel existing Appointments' in
  pg_get_functiondef('public.apply_calendar_service_eligibility_command_legacy(uuid,uuid,uuid,boolean,text,uuid,uuid,integer)'::regprocedure)
) > 0, 'eligibility removal protects dependent Appointments');
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'public'
    and tablename = 'calendar_staff_service_eligibility'
    and cmd = 'SELECT'
), 'eligibility assignments have an RLS read policy');

select * from finish();
rollback;
