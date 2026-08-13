begin;

select plan(37);

select has_table('public', 'calendar_rooms', 'Calendar rooms table exists');
select has_table('public', 'calendar_staff_working_hours', 'Staff working hours table exists');
select has_table('public', 'calendar_staff_breaks', 'Staff breaks table exists');
select has_table('public', 'calendar_staff_leave', 'Staff leave table exists');
select has_table('public', 'calendar_availability_command_receipts', 'Availability receipts table exists');
select has_column('public', 'bookings', 'room_id', 'Appointments have a canonical room reference');
select has_function(
  'public',
  'apply_calendar_availability_command',
  array[
    'uuid','text','text','text','uuid','uuid','uuid','integer','uuid','smallint',
    'time without time zone','time without time zone','timestamp without time zone',
    'timestamp without time zone','text','text','text','text','boolean'
  ],
  'trusted Calendar availability command exists'
);
select has_function('private', 'enforce_booking_availability', array[]::text[], 'Appointment availability trigger function exists');
select has_function('private', 'booking_effective_range', array['public.bookings'], 'effective Appointment range helper exists');
select ok(exists(select 1 from pg_class where oid='public.calendar_rooms'::regclass and relrowsecurity), 'Rooms use RLS');
select ok(exists(select 1 from pg_class where oid='public.calendar_staff_working_hours'::regclass and relrowsecurity), 'Working hours use RLS');
select ok(exists(select 1 from pg_class where oid='public.calendar_staff_breaks'::regclass and relrowsecurity), 'Breaks use RLS');
select ok(exists(select 1 from pg_class where oid='public.calendar_staff_leave'::regclass and relrowsecurity), 'Leave uses RLS');
select ok(exists(select 1 from pg_class where oid='public.calendar_availability_command_receipts'::regclass and relrowsecurity), 'Availability receipts use RLS');
select ok(not has_table_privilege('anon','public.calendar_rooms','SELECT'), 'anonymous users cannot read rooms');
select ok(not has_table_privilege('authenticated','public.calendar_rooms','INSERT'), 'browser clients cannot insert rooms directly');
select ok(not has_table_privilege('authenticated','public.calendar_rooms','UPDATE'), 'browser clients cannot update rooms directly');
select ok(not has_table_privilege('authenticated','public.calendar_staff_working_hours','INSERT'), 'browser clients cannot insert working hours directly');
select ok(not has_table_privilege('authenticated','public.calendar_staff_breaks','INSERT'), 'browser clients cannot insert breaks directly');
select ok(not has_table_privilege('authenticated','public.calendar_staff_leave','INSERT'), 'browser clients cannot insert leave directly');
select ok(not has_table_privilege('authenticated','public.calendar_availability_command_receipts','SELECT'), 'browser clients cannot read availability receipts');
select ok(exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='bookings_enforce_availability' and not tgisinternal), 'Appointment availability trigger is active');
select ok(exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass and conname='bookings_room_effective_time_exclusion' and contype='x'), 'room overlap uses an exclusion constraint');
select ok(exists(select 1 from pg_constraint where conrelid='public.calendar_staff_leave'::regclass and conname='calendar_staff_leave_overlap_exclusion' and contype='x'), 'staff leave overlap uses an exclusion constraint');
select ok(exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass and conname='bookings_workspace_room_fkey' and contype='f'), 'Appointment room is workspace scoped');
select ok(position('actor_has_workspace_permission' in pg_get_functiondef('private.calendar_availability_actor_can_manage(uuid,uuid)'::regprocedure)) > 0, 'availability management uses shared support-aware permission checks');
select ok(position('''approve''' in pg_get_functiondef('private.calendar_availability_actor_can_manage(uuid,uuid)'::regprocedure)) > 0, 'availability management requires Calendar approval permission');
select ok(position('outside the staff member working hours' in pg_get_functiondef('private.enforce_booking_availability()'::regprocedure)) > 0, 'Appointment trigger checks working hours');
select ok(position('overlaps a staff break' in pg_get_functiondef('private.enforce_booking_availability()'::regprocedure)) > 0, 'Appointment trigger checks breaks');
select ok(position('overlaps staff leave' in pg_get_functiondef('private.enforce_booking_availability()'::regprocedure)) > 0, 'Appointment trigger checks leave');
select ok(position('active configured room' in pg_get_functiondef('private.enforce_booking_availability()'::regprocedure)) > 0, 'Appointment trigger resolves active rooms');
select ok(position('conflicts with another booking for this room' in pg_get_functiondef('private.enforce_booking_availability()'::regprocedure)) > 0, 'Appointment trigger reports room conflicts distinctly');
select ok(position('calendar_availability_command_receipts' in pg_get_functiondef('public.apply_calendar_availability_command(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)'::regprocedure)) > 0, 'availability command stores idempotency receipts');
select ok(position('activity_items' in pg_get_functiondef('public.apply_calendar_availability_command(uuid,text,text,text,uuid,uuid,uuid,integer,uuid,smallint,time without time zone,time without time zone,timestamp without time zone,timestamp without time zone,text,text,text,text,boolean)'::regprocedure)) > 0, 'availability command writes Activity history');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='calendar_rooms' and cmd='SELECT'), 'rooms have an RLS read policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='calendar_staff_working_hours' and cmd='SELECT'), 'working hours have an RLS read policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='calendar_staff_leave' and cmd='SELECT'), 'leave has an RLS read policy');

select * from finish();
rollback;
