begin;

select plan(33);

select has_table('public', 'bookings', 'Appointments use the canonical bookings table');
select has_table('public', 'appointment_command_receipts', 'Appointment command receipts table exists');
select has_function(
  'public',
  'apply_appointment_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','uuid','uuid','uuid','date','time without time zone','text','text','text','text','text'],
  'trusted Appointment command exists'
);
select ok(
  exists (select 1 from pg_class where oid='public.bookings'::regclass and relrowsecurity),
  'Appointments use RLS'
);
select ok(
  exists (select 1 from pg_class where oid='public.appointment_command_receipts'::regclass and relrowsecurity),
  'Appointment receipts use RLS'
);
select ok(not has_table_privilege('anon','public.bookings','SELECT'), 'anonymous users cannot read Appointments');
select ok(has_table_privilege('authenticated','public.bookings','SELECT'), 'authenticated users retain RLS-scoped Appointment reads');
select ok(not has_table_privilege('authenticated','public.bookings','INSERT'), 'browser clients cannot insert Appointments directly');
select ok(not has_table_privilege('authenticated','public.bookings','UPDATE'), 'browser clients cannot update Appointments directly');
select ok(not has_table_privilege('authenticated','public.bookings','DELETE'), 'browser clients cannot delete Appointments directly');
select ok(not has_table_privilege('authenticated','public.appointment_command_receipts','SELECT'), 'browser clients cannot read Appointment receipts');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='bookings'
      and cmd='SELECT' and qual ilike '%calendar%view%'
  ),
  'Appointment reads require Calendar visibility'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%unique (workspace_id, id)%'
  ),
  'Appointments expose a workspace-safe composite identity'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) ilike '%foreign key (workspace_id, service_id)%services(workspace_id, id)%'
  ),
  'Appointments reference the canonical workspace Service'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and contype='x'
      and conname='bookings_staff_effective_time_exclusion'
  ),
  'Appointments enforce effective staff time overlap atomically'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname='bookings_staff_effective_time_exclusion'
      and lower(pg_get_constraintdef(oid)) like '%preparation_buffer_minutes%'
      and lower(pg_get_constraintdef(oid)) like '%recovery_buffer_minutes%'
  ),
  'effective staff time overlap includes preparation and recovery buffers'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname='bookings_staff_effective_time_exclusion'
      and lower(pg_get_constraintdef(oid)) like '%status <> ''cancelled''%'
  ),
  'cancelled Appointments release the staff overlap constraint'
);
select ok(
  position('actor_has_workspace_permission' in lower(pg_get_functiondef(
    'private.appointment_actor_can_write(uuid,uuid,text)'::regprocedure
  ))) > 0,
  'Appointment writes use the shared support-aware permission boundary'
);
select ok(
  position('changed on another device' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment command rejects stale versions'
);
select ok(
  position('appointment_command_receipts' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment command stores idempotency receipts'
);
select ok(
  position('activity_items' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment command writes Activity history'
);
select ok(
  position('Archived Customers cannot receive new Appointments' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment creation rejects archived Customers'
);
select ok(
  position('Archived Services cannot be booked' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment creation rejects archived Services'
);
select ok(
  position('not active in this workspace' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment creation requires active workspace staff'
);
select ok(
  position('Only pending Appointments can be confirmed' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment confirmation uses an explicit lifecycle transition'
);
select ok(
  position('Only confirmed Appointments can be completed' in pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  )) > 0,
  'Appointment completion uses an explicit lifecycle transition'
);
select ok(
  position('insert into public.sales' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) = 0,
  'Appointment completion does not post Sales, invoices, Payments or Inventory: no Sale is created'
);
select ok(
  position('insert into public.invoices' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) = 0,
  'Appointment completion does not post Sales, invoices, Payments or Inventory: no invoice is created'
);
select ok(
  position('insert into public.inventory_movements' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) = 0,
  'Appointment completion does not post Sales, invoices, Payments or Inventory: no Inventory movement is created'
);
select ok(
  position('insert into public.bank_transactions' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) = 0,
  'Appointment completion does not post Sales, invoices, Payments or Inventory: no cash record is created'
);
select ok(
  position('right(replace(p_booking_id::text' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) > 0,
  'Appointment references use the final 64 UUID bits'
);
select ok(
  position('workspace_settings' in lower(pg_get_functiondef(
    'public.apply_appointment_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,uuid,date,time without time zone,text,text,text,text,text)'::regprocedure
  ))) > 0,
  'Appointment commands snapshot the workspace timezone'
);
select ok(
  exists (
    select 1
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid=enum_value.enumtypid
    join pg_namespace namespace on namespace.oid=enum_type.typnamespace
    where namespace.nspname='public'
      and enum_type.typname='booking_status'
      and enum_value.enumlabel='cancelled'
  ),
  'Appointment status supports cancellation'
);

select * from finish();
rollback;
