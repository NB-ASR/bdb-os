begin;

select plan(32);

select has_table('public', 'sale_drafts', 'Appointment Sale drafts table exists');
select has_table('public', 'sale_draft_command_receipts', 'Appointment Sale draft receipts table exists');
select has_function(
  'public',
  'apply_appointment_sale_draft_command',
  array['uuid','uuid','text','text','uuid','uuid','integer','uuid','uuid','numeric','numeric','timestamp with time zone','text','text'],
  'trusted Appointment Sale draft command exists'
);
select ok(exists(
  select 1 from pg_class where oid = 'public.sale_drafts'::regclass and relrowsecurity
), 'Appointment Sale drafts use RLS');
select ok(exists(
  select 1 from pg_class where oid = 'public.sale_draft_command_receipts'::regclass and relrowsecurity
), 'Appointment Sale draft receipts use RLS');
select ok(not has_table_privilege('anon', 'public.sale_drafts', 'SELECT'), 'anonymous users cannot read Appointment Sale drafts');
select ok(has_table_privilege('authenticated', 'public.sale_drafts', 'SELECT'), 'authenticated users receive Appointment Sale draft read privilege');
select ok(not has_table_privilege('authenticated', 'public.sale_drafts', 'INSERT'), 'browser clients cannot insert Appointment Sale drafts directly');
select ok(not has_table_privilege('authenticated', 'public.sale_drafts', 'UPDATE'), 'browser clients cannot update Appointment Sale drafts directly');
select ok(not has_table_privilege('authenticated', 'public.sale_drafts', 'DELETE'), 'browser clients cannot delete Appointment Sale drafts directly');
select ok(not has_table_privilege('authenticated', 'public.sale_draft_command_receipts', 'SELECT'), 'browser clients cannot read Appointment Sale draft receipts');
select ok(not has_function_privilege(
  'authenticated',
  'public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)',
  'EXECUTE'
), 'browser clients cannot execute the trusted Appointment Sale draft command');
select ok(has_function_privilege(
  'service_role',
  'public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)',
  'EXECUTE'
), 'service role can execute the trusted Appointment Sale draft command');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%workspace_id, source_appointment_id%'
), 'one draft per workspace Appointment is enforced');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and contype = 'f'
    and confrelid = 'public.bookings'::regclass
), 'Appointment Sale drafts reference canonical Appointments');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and contype = 'f'
    and confrelid = 'public.customers'::regclass
), 'Appointment Sale drafts reference canonical Customers');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and contype = 'f'
    and confrelid = 'public.services'::regclass
), 'Appointment Sale drafts reference canonical Services');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and contype = 'f'
    and confrelid = 'public.sales'::regclass
), 'converted Appointment Sale drafts reference canonical Sales');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.sale_drafts'::regclass
    and conname = 'sale_drafts_status_shape'
), 'Appointment Sale draft lifecycle shape is enforced');
select ok((
  select prosecdef from pg_proc
  where oid = 'public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure
), 'Appointment Sale draft command is security definer');
select ok(position(
  'Only completed Appointments can create Sale drafts' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft creation requires a completed Appointment');
select ok(position(
  'sale_draft_command_receipts' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft command stores idempotency receipts');
select ok(position(
  'changed on another device' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft command enforces optimistic versions');
select ok(position(
  'sales_actor_can_write' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft command uses Sales permissions');
select ok(position(
  'insert into public.sales' in lower(pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure))
) > 0, 'draft completion inserts one canonical Sale');
select ok(position(
  '''appointment''' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft completion records the Appointment channel');
select ok(position(
  'insert into public.sale_lines' in lower(pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure))
) > 0, 'draft completion inserts one Sale line');
select ok(position(
  '''service''' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft completion creates a Service line');
select ok(position(
  'inventory_movements' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) = 0, 'Appointment Sale draft completion never moves Inventory');
select ok(position(
  'activity_items' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft command writes Activity history');
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'public'
    and tablename = 'sale_drafts'
    and cmd = 'SELECT'
), 'Appointment Sale drafts have an RLS read policy');
select ok(position(
  'settlement_status' in
  pg_get_functiondef('public.apply_appointment_sale_draft_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure)
) > 0, 'draft completion records the settlement boundary in Activity');

select * from finish();
rollback;
