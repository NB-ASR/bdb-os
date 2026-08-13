-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133425_vanita_release_appointments_and_calendar.sql.
-- Sources: 20260729110000_appointment_status_values.sql through 20260729150000_appointment_product_consumption.sql.
alter type public.booking_status add value if not exists 'cancelled';


begin;

create extension if not exists btree_gist with schema extensions;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'calendar',
  'Calendar',
  'Customer appointments connected to Services, assigned staff and audited lifecycle commands.',
  'operations',
  '/calendar',
  30,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

alter table public.bookings
  add column reference text,
  add column service_id uuid,
  add column staff_user_id uuid references public.profiles(id) on delete set null,
  add column customer_name_snapshot text,
  add column service_code_snapshot text,
  add column preparation_buffer_minutes integer not null default 0,
  add column recovery_buffer_minutes integer not null default 0,
  add column channel text not null default 'staff',
  add column room_name text,
  add column price_snapshot numeric(14,4),
  add column vat_rate_snapshot numeric(5,2) not null default 0,
  add column timezone text not null default 'Europe/London',
  add column notes text,
  add column cancellation_reason text,
  add column version integer not null default 1,
  add column created_by uuid references auth.users(id) on delete set null,
  add column updated_by uuid references auth.users(id) on delete set null,
  add column cancelled_at timestamptz,
  add column completed_at timestamptz;

update public.bookings booking
set reference = 'APT-' || upper(right(replace(booking.id::text, '-', ''), 16)),
    customer_name_snapshot = customer.name,
    timezone = coalesce(
      (
        select settings.timezone
        from public.workspace_settings settings
        where settings.workspace_id = booking.workspace_id
      ),
      'Europe/London'
    )
from public.customers customer
where customer.workspace_id = booking.workspace_id
  and customer.id = booking.customer_id;

update public.bookings
set reference = 'APT-' || upper(right(replace(id::text, '-', ''), 16))
where reference is null;

alter table public.bookings
  alter column reference set not null,
  add constraint bookings_reference_length_check check (char_length(trim(reference)) between 5 and 32),
  add constraint bookings_customer_snapshot_length_check check (customer_name_snapshot is null or char_length(customer_name_snapshot) <= 200),
  add constraint bookings_service_code_snapshot_length_check check (service_code_snapshot is null or char_length(service_code_snapshot) <= 64),
  add constraint bookings_preparation_buffer_check check (preparation_buffer_minutes between 0 and 240),
  add constraint bookings_recovery_buffer_check check (recovery_buffer_minutes between 0 and 240),
  add constraint bookings_channel_check check (channel in ('staff', 'phone', 'walk_in', 'online')),
  add constraint bookings_room_name_length_check check (room_name is null or char_length(room_name) <= 120),
  add constraint bookings_price_snapshot_check check (price_snapshot is null or price_snapshot >= 0),
  add constraint bookings_vat_rate_snapshot_check check (vat_rate_snapshot between 0 and 100),
  add constraint bookings_timezone_length_check check (char_length(trim(timezone)) between 1 and 100),
  add constraint bookings_notes_length_check check (notes is null or char_length(notes) <= 4000),
  add constraint bookings_cancellation_reason_length_check check (cancellation_reason is null or char_length(cancellation_reason) <= 500),
  add constraint bookings_version_check check (version > 0),
  add constraint bookings_workspace_id_id_key unique (workspace_id, id),
  add constraint bookings_workspace_service_fkey foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete restrict;

create unique index bookings_workspace_reference_ci_idx
  on public.bookings(workspace_id, lower(reference));
create index bookings_workspace_date_time_idx
  on public.bookings(workspace_id, booking_date, booking_time);
create index bookings_workspace_customer_time_idx
  on public.bookings(workspace_id, customer_id, booking_date desc, booking_time desc);
create index bookings_workspace_service_time_idx
  on public.bookings(workspace_id, service_id, booking_date desc, booking_time desc)
  where service_id is not null;
create index bookings_workspace_staff_time_idx
  on public.bookings(workspace_id, staff_user_id, booking_date, booking_time)
  where staff_user_id is not null;
create index bookings_created_by_idx
  on public.bookings(created_by)
  where created_by is not null;
create index bookings_updated_by_idx
  on public.bookings(updated_by)
  where updated_by is not null;

alter table public.bookings
  add constraint bookings_staff_effective_time_exclusion
  exclude using gist (
    workspace_id with =,
    staff_user_id with =,
    tsrange(
      booking_date + booking_time - make_interval(mins => preparation_buffer_minutes),
      booking_date + booking_time + make_interval(mins => duration_minutes + recovery_buffer_minutes),
      '[)'
    ) with &&
  )
  where (staff_user_id is not null and status <> 'cancelled'::public.booking_status);

create table public.appointment_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  booking_id uuid not null,
  action text not null check (action in ('create', 'update', 'confirm', 'cancel', 'complete')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, booking_id)
    references public.bookings(workspace_id, id) on delete cascade
);

create index appointment_command_receipts_booking_idx
  on public.appointment_command_receipts(workspace_id, booking_id, created_at desc);

drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
before update on public.bookings
for each row execute function private.touch_updated_at();

create or replace function private.appointment_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'calendar',
    target_action
  );
$$;

create or replace function public.apply_appointment_command(
  p_workspace_id uuid,
  p_booking_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_customer_id uuid default null,
  p_service_id uuid default null,
  p_staff_user_id uuid default null,
  p_booking_date date default null,
  p_booking_time time default null,
  p_channel text default 'staff',
  p_room_name text default null,
  p_notes text default null,
  p_initial_status text default 'pending',
  p_cancellation_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_record public.bookings;
  current_record public.bookings;
  customer_record public.customers;
  service_record public.services;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
  staff_name_value text;
  timezone_value text;
  title_value text;
  customer_snapshot_value text;
  service_code_value text;
  duration_value integer;
  preparation_value integer;
  recovery_value integer;
  price_value numeric;
  vat_rate_value numeric;
  effective_start timestamp;
  effective_end timestamp;
begin
  if p_action not in ('create', 'update', 'confirm', 'cancel', 'complete') then
    raise exception 'Unsupported Appointment action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.appointment_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.appointment_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Appointment write access denied';
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.bookings where id = p_booking_id) then
      raise exception 'Appointment identity conflict';
    end if;
  else
    select * into current_record
    from public.bookings
    where workspace_id = p_workspace_id
      and id = p_booking_id
    for update;

    if current_record.id is null then
      raise exception 'Appointment not found';
    end if;
    if p_expected_version is null or current_record.version <> p_expected_version then
      raise exception 'Appointment changed on another device; refresh before saving';
    end if;
  end if;

  if p_action in ('create', 'update') then
    if p_customer_id is null or p_service_id is null or p_staff_user_id is null then
      raise exception 'Appointment Customer, Service and staff are required';
    end if;
    if p_booking_date is null or p_booking_time is null then
      raise exception 'Appointment date and time are required';
    end if;
    if p_channel not in ('staff', 'phone', 'walk_in', 'online') then
      raise exception 'Appointment booking source is invalid';
    end if;
    if p_room_name is not null and char_length(trim(p_room_name)) > 120 then
      raise exception 'Appointment room is too long';
    end if;
    if p_notes is not null and char_length(p_notes) > 4000 then
      raise exception 'Appointment notes are too long';
    end if;
    if p_action = 'create' and p_initial_status not in ('pending', 'confirmed') then
      raise exception 'Appointment initial status is invalid';
    end if;
    if p_action = 'update' and current_record.status::text not in ('pending', 'confirmed') then
      raise exception 'Only pending or confirmed Appointments can be rescheduled';
    end if;

    select * into customer_record
    from public.customers
    where workspace_id = p_workspace_id
      and id = p_customer_id;

    if customer_record.id is null then
      raise exception 'Appointment Customer not found';
    end if;
    if customer_record.status <> 'active'
      and (p_action = 'create' or p_customer_id is distinct from current_record.customer_id) then
      raise exception 'Archived Customers cannot receive new Appointments';
    end if;

    select * into service_record
    from public.services
    where workspace_id = p_workspace_id
      and id = p_service_id;

    if service_record.id is null then
      raise exception 'Appointment Service not found';
    end if;
    if service_record.status <> 'active'
      and (p_action = 'create' or p_service_id is distinct from current_record.service_id) then
      raise exception 'Archived Services cannot be booked';
    end if;

    select profile.full_name into staff_name_value
    from public.workspace_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.workspace_id = p_workspace_id
      and membership.user_id = p_staff_user_id
      and membership.status = 'active'
      and profile.is_active
    limit 1;

    if staff_name_value is null then
      raise exception 'Appointment staff member is not active in this workspace';
    end if;

    select settings.timezone into timezone_value
    from public.workspace_settings settings
    where settings.workspace_id = p_workspace_id;
    timezone_value := coalesce(nullif(trim(timezone_value), ''), 'Europe/London');

    if p_action = 'update' and p_service_id = current_record.service_id then
      title_value := current_record.title;
      service_code_value := current_record.service_code_snapshot;
      duration_value := current_record.duration_minutes;
      preparation_value := current_record.preparation_buffer_minutes;
      recovery_value := current_record.recovery_buffer_minutes;
      price_value := current_record.price_snapshot;
      vat_rate_value := current_record.vat_rate_snapshot;
    else
      title_value := service_record.name;
      service_code_value := service_record.code::text;
      duration_value := service_record.duration_minutes;
      preparation_value := service_record.preparation_buffer_minutes;
      recovery_value := service_record.recovery_buffer_minutes;
      price_value := service_record.price;
      vat_rate_value := service_record.vat_rate;
    end if;

    customer_snapshot_value := case
      when p_action = 'update' and p_customer_id = current_record.customer_id
        then coalesce(current_record.customer_name_snapshot, customer_record.name)
      else customer_record.name
    end;

    effective_start := p_booking_date + p_booking_time - make_interval(mins => preparation_value);
    effective_end := p_booking_date + p_booking_time + make_interval(mins => duration_value + recovery_value);

    if exists (
      select 1
      from public.bookings existing
      where existing.workspace_id = p_workspace_id
        and existing.staff_user_id = p_staff_user_id
        and existing.id <> p_booking_id
        and existing.status <> 'cancelled'::public.booking_status
        and tsrange(
          existing.booking_date + existing.booking_time - make_interval(mins => existing.preparation_buffer_minutes),
          existing.booking_date + existing.booking_time + make_interval(mins => existing.duration_minutes + existing.recovery_buffer_minutes),
          '[)'
        ) && tsrange(effective_start, effective_end, '[)')
    ) then
      raise exception 'Appointment conflicts with another booking for this staff member';
    end if;
  end if;

  if p_action = 'create' then
    insert into public.bookings (
      id, workspace_id, reference, customer_id, customer_name_snapshot,
      service_id, service_code_snapshot, title, booking_date, booking_time,
      duration_minutes, preparation_buffer_minutes, recovery_buffer_minutes,
      staff_user_id, staff_name, status, channel, room_name, price_snapshot,
      vat_rate_snapshot, timezone, notes, created_by, updated_by
    ) values (
      p_booking_id, p_workspace_id,
      'APT-' || upper(right(replace(p_booking_id::text, '-', ''), 16)),
      p_customer_id, customer_snapshot_value,
      p_service_id, service_code_value, title_value, p_booking_date, p_booking_time,
      duration_value, preparation_value, recovery_value,
      p_staff_user_id, staff_name_value, p_initial_status::public.booking_status,
      p_channel, nullif(trim(p_room_name), ''), price_value,
      vat_rate_value, timezone_value, nullif(trim(p_notes), ''),
      p_actor_user_id, p_actor_user_id
    ) returning * into booking_record;
    activity_action := 'Appointment created';
    activity_tone := 'blue';
  elsif p_action = 'update' then
    update public.bookings
    set customer_id = p_customer_id,
        customer_name_snapshot = customer_snapshot_value,
        service_id = p_service_id,
        service_code_snapshot = service_code_value,
        title = title_value,
        booking_date = p_booking_date,
        booking_time = p_booking_time,
        duration_minutes = duration_value,
        preparation_buffer_minutes = preparation_value,
        recovery_buffer_minutes = recovery_value,
        staff_user_id = p_staff_user_id,
        staff_name = staff_name_value,
        channel = p_channel,
        room_name = nullif(trim(p_room_name), ''),
        price_snapshot = price_value,
        vat_rate_snapshot = vat_rate_value,
        timezone = timezone_value,
        notes = nullif(trim(p_notes), ''),
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id
      and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment rescheduled';
    activity_tone := 'blue';
  elsif p_action = 'confirm' then
    if current_record.status::text <> 'pending' then
      raise exception 'Only pending Appointments can be confirmed';
    end if;
    update public.bookings
    set status = 'confirmed',
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id
      and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment confirmed';
    activity_tone := 'green';
  elsif p_action = 'cancel' then
    if current_record.status::text not in ('pending', 'confirmed') then
      raise exception 'Only pending or confirmed Appointments can be cancelled';
    end if;
    if p_cancellation_reason is null
      or char_length(trim(p_cancellation_reason)) < 2
      or char_length(trim(p_cancellation_reason)) > 500 then
      raise exception 'Appointment cancellation reason is required';
    end if;
    update public.bookings
    set status = 'cancelled',
        cancellation_reason = trim(p_cancellation_reason),
        cancelled_at = now(),
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id
      and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment cancelled';
    activity_tone := 'gold';
  else
    if current_record.status::text <> 'confirmed' then
      raise exception 'Only confirmed Appointments can be completed';
    end if;
    update public.bookings
    set status = 'completed',
        completed_at = now(),
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id
      and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment completed';
    activity_tone := 'green';
  end if;

  command_result := jsonb_build_object(
    'action', p_action,
    'appointment', to_jsonb(booking_record)
  );

  insert into public.appointment_command_receipts (
    workspace_id, idempotency_key, booking_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), booking_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    booking_record.reference || ' · ' || coalesce(booking_record.customer_name_snapshot, 'Customer') || ' · ' || booking_record.title,
    activity_tone, 'appointment', booking_record.id::text, p_command_id,
    jsonb_build_object(
      'appointment_id', booking_record.id,
      'reference', booking_record.reference,
      'customer_id', booking_record.customer_id,
      'service_id', booking_record.service_id,
      'staff_user_id', booking_record.staff_user_id,
      'status', booking_record.status,
      'version', booking_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
exception
  when exclusion_violation then
    raise exception 'Appointment conflicts with another booking for this staff member';
end;
$$;

revoke all on function private.appointment_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_appointment_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid, date, time, text, text, text, text, text) from public, anon, authenticated;
grant execute on function private.appointment_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_appointment_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid, date, time, text, text, text, text, text) to service_role;

revoke insert, update, delete on table public.bookings from anon, authenticated;
revoke all on table public.appointment_command_receipts from anon, authenticated;
grant select on table public.bookings to authenticated;

alter table public.appointment_command_receipts enable row level security;

drop policy if exists "Calendar permission insert" on public.bookings;
drop policy if exists "Calendar permission update" on public.bookings;
drop policy if exists "Calendar permission delete" on public.bookings;

comment on table public.bookings is
  'Canonical workspace Appointment records. Date and time are local to the stored workspace timezone snapshot; Service timing and value are historical snapshots.';
comment on table public.appointment_command_receipts is
  'Service-role-only idempotency receipts for Appointment lifecycle commands.';
comment on function public.apply_appointment_command(uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid, date, time, text, text, text, text, text) is
  'Creates, reschedules, confirms, cancels or completes one Appointment without creating Sales, invoices, Payments or Inventory movements.';

commit;


revoke all on table public.bookings from anon;
revoke all on table public.appointment_command_receipts from anon, authenticated;

comment on table public.bookings is
  'Canonical workspace Appointment records. Authenticated reads remain RLS-scoped; anonymous access is denied; mutations use trusted commands only.';


drop index if exists public.bookings_workspace_date_time_idx;

create index if not exists bookings_staff_user_idx
  on public.bookings(staff_user_id)
  where staff_user_id is not null;

comment on index public.bookings_staff_user_idx is
  'Covers the Appointment staff profile foreign key and staff lifecycle lookups.';


begin;

create table public.calendar_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null,
  name text not null,
  description text,
  status text not null default 'active',
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code),
  constraint calendar_rooms_code_check check (code::text ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$'),
  constraint calendar_rooms_name_check check (char_length(trim(name)) between 2 and 120),
  constraint calendar_rooms_description_check check (description is null or char_length(description) <= 1000),
  constraint calendar_rooms_status_check check (status in ('active', 'archived')),
  constraint calendar_rooms_version_check check (version > 0)
);

create unique index calendar_rooms_workspace_name_ci_idx
  on public.calendar_rooms(workspace_id, lower(name));
create index calendar_rooms_workspace_status_idx
  on public.calendar_rooms(workspace_id, status, name);
create index calendar_rooms_created_by_idx on public.calendar_rooms(created_by) where created_by is not null;
create index calendar_rooms_updated_by_idx on public.calendar_rooms(updated_by) where updated_by is not null;

create table public.calendar_staff_working_hours (
  workspace_id uuid not null,
  staff_user_id uuid not null,
  weekday smallint not null,
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  is_working boolean not null default true,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, staff_user_id, weekday),
  foreign key (workspace_id, staff_user_id)
    references public.workspace_memberships(workspace_id, user_id) on delete cascade,
  constraint calendar_staff_working_hours_weekday_check check (weekday between 0 and 6),
  constraint calendar_staff_working_hours_time_check check (start_time < end_time),
  constraint calendar_staff_working_hours_version_check check (version > 0)
);

create index calendar_staff_working_hours_staff_idx
  on public.calendar_staff_working_hours(staff_user_id, workspace_id, weekday);

create table public.calendar_staff_breaks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  staff_user_id uuid not null,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  label text not null default 'Break',
  status text not null default 'active',
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, staff_user_id)
    references public.workspace_memberships(workspace_id, user_id) on delete cascade,
  constraint calendar_staff_breaks_weekday_check check (weekday between 0 and 6),
  constraint calendar_staff_breaks_time_check check (start_time < end_time),
  constraint calendar_staff_breaks_label_check check (char_length(trim(label)) between 2 and 120),
  constraint calendar_staff_breaks_status_check check (status in ('active', 'archived')),
  constraint calendar_staff_breaks_version_check check (version > 0)
);

create index calendar_staff_breaks_staff_day_idx
  on public.calendar_staff_breaks(workspace_id, staff_user_id, weekday, start_time)
  where status = 'active';
create index calendar_staff_breaks_created_by_idx on public.calendar_staff_breaks(created_by) where created_by is not null;
create index calendar_staff_breaks_updated_by_idx on public.calendar_staff_breaks(updated_by) where updated_by is not null;

create table public.calendar_staff_leave (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  staff_user_id uuid not null,
  starts_at timestamp not null,
  ends_at timestamp not null,
  reason text not null,
  status text not null default 'active',
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, staff_user_id)
    references public.workspace_memberships(workspace_id, user_id) on delete cascade,
  constraint calendar_staff_leave_time_check check (starts_at < ends_at),
  constraint calendar_staff_leave_reason_check check (char_length(trim(reason)) between 2 and 500),
  constraint calendar_staff_leave_status_check check (status in ('active', 'cancelled')),
  constraint calendar_staff_leave_version_check check (version > 0)
);

create index calendar_staff_leave_staff_time_idx
  on public.calendar_staff_leave using gist (
    workspace_id,
    staff_user_id,
    tsrange(starts_at, ends_at, '[)')
  )
  where status = 'active';
create index calendar_staff_leave_created_by_idx on public.calendar_staff_leave(created_by) where created_by is not null;
create index calendar_staff_leave_updated_by_idx on public.calendar_staff_leave(updated_by) where updated_by is not null;

alter table public.calendar_staff_leave
  add constraint calendar_staff_leave_overlap_exclusion
  exclude using gist (
    workspace_id with =,
    staff_user_id with =,
    tsrange(starts_at, ends_at, '[)') with &&
  )
  where (status = 'active');

create table public.calendar_availability_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  entity_type text not null check (entity_type in ('working_hours', 'break', 'leave', 'room')),
  entity_id text not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.bookings
  add column room_id uuid,
  add constraint bookings_workspace_room_fkey foreign key (workspace_id, room_id)
    references public.calendar_rooms(workspace_id, id) on delete restrict;

create index bookings_workspace_room_time_idx
  on public.bookings(workspace_id, room_id, booking_date, booking_time)
  where room_id is not null;

alter table public.bookings
  add constraint bookings_room_effective_time_exclusion
  exclude using gist (
    workspace_id with =,
    room_id with =,
    tsrange(
      booking_date + booking_time - make_interval(mins => preparation_buffer_minutes),
      booking_date + booking_time + make_interval(mins => duration_minutes + recovery_buffer_minutes),
      '[)'
    ) with &&
  )
  where (room_id is not null and status <> 'cancelled'::public.booking_status);

create trigger calendar_rooms_touch_updated_at
before update on public.calendar_rooms
for each row execute function private.touch_updated_at();
create trigger calendar_staff_working_hours_touch_updated_at
before update on public.calendar_staff_working_hours
for each row execute function private.touch_updated_at();
create trigger calendar_staff_breaks_touch_updated_at
before update on public.calendar_staff_breaks
for each row execute function private.touch_updated_at();
create trigger calendar_staff_leave_touch_updated_at
before update on public.calendar_staff_leave
for each row execute function private.touch_updated_at();

create or replace function private.calendar_availability_actor_can_manage(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'calendar',
    'approve'
  );
$$;

create or replace function private.booking_effective_range(booking public.bookings)
returns tsrange
language sql
immutable
set search_path = ''
as $$
  select tsrange(
    booking.booking_date + booking.booking_time - make_interval(mins => booking.preparation_buffer_minutes),
    booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + booking.recovery_buffer_minutes),
    '[)'
  );
$$;

create or replace function private.enforce_booking_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_start timestamp;
  effective_end timestamp;
  weekday_value smallint;
  room_record public.calendar_rooms;
begin
  if new.status::text in ('cancelled', 'completed') then
    return new;
  end if;

  effective_start := new.booking_date + new.booking_time - make_interval(mins => new.preparation_buffer_minutes);
  effective_end := new.booking_date + new.booking_time + make_interval(mins => new.duration_minutes + new.recovery_buffer_minutes);
  weekday_value := extract(dow from new.booking_date)::smallint;

  if effective_start::date <> new.booking_date or effective_end::date <> new.booking_date then
    raise exception 'Appointment effective time must remain within one working day';
  end if;

  if not exists (
    select 1
    from public.calendar_staff_working_hours hours
    where hours.workspace_id = new.workspace_id
      and hours.staff_user_id = new.staff_user_id
      and hours.weekday = weekday_value
      and hours.is_working
      and effective_start::time >= hours.start_time
      and effective_end::time <= hours.end_time
  ) then
    raise exception 'Appointment is outside the staff member working hours';
  end if;

  if exists (
    select 1
    from public.calendar_staff_breaks break_record
    where break_record.workspace_id = new.workspace_id
      and break_record.staff_user_id = new.staff_user_id
      and break_record.weekday = weekday_value
      and break_record.status = 'active'
      and tsrange(
        new.booking_date + break_record.start_time,
        new.booking_date + break_record.end_time,
        '[)'
      ) && tsrange(effective_start, effective_end, '[)')
  ) then
    raise exception 'Appointment overlaps a staff break';
  end if;

  if exists (
    select 1
    from public.calendar_staff_leave leave_record
    where leave_record.workspace_id = new.workspace_id
      and leave_record.staff_user_id = new.staff_user_id
      and leave_record.status = 'active'
      and tsrange(leave_record.starts_at, leave_record.ends_at, '[)')
        && tsrange(effective_start, effective_end, '[)')
  ) then
    raise exception 'Appointment overlaps staff leave';
  end if;

  if new.room_name is null or trim(new.room_name) = '' then
    new.room_id := null;
    new.room_name := null;
  else
    select * into room_record
    from public.calendar_rooms room
    where room.workspace_id = new.workspace_id
      and room.status = 'active'
      and (lower(room.name) = lower(trim(new.room_name)) or lower(room.code::text) = lower(trim(new.room_name)))
    limit 1;

    if room_record.id is null then
      raise exception 'Appointment room is not an active configured room';
    end if;

    new.room_id := room_record.id;
    new.room_name := room_record.name;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_availability on public.bookings;
create trigger bookings_enforce_availability
before insert or update of booking_date, booking_time, duration_minutes,
  preparation_buffer_minutes, recovery_buffer_minutes, staff_user_id,
  status, room_name
on public.bookings
for each row execute function private.enforce_booking_availability();

create or replace function public.apply_calendar_availability_command(
  p_workspace_id uuid,
  p_entity_type text,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_entity_id uuid default null,
  p_expected_version integer default null,
  p_staff_user_id uuid default null,
  p_weekday smallint default null,
  p_start_time time default null,
  p_end_time time default null,
  p_starts_at timestamp default null,
  p_ends_at timestamp default null,
  p_code text default null,
  p_name text default null,
  p_description text default null,
  p_reason text default null,
  p_is_working boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  room_record public.calendar_rooms;
  break_record public.calendar_staff_breaks;
  leave_record public.calendar_staff_leave;
  hours_record public.calendar_staff_working_hours;
  resulting_id text;
  activity_action text;
  activity_detail text;
  active_appointment_count integer;
begin
  if p_entity_type not in ('working_hours', 'break', 'leave', 'room') then
    raise exception 'Unsupported Calendar availability entity';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Calendar availability idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.calendar_availability_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if not private.calendar_availability_actor_can_manage(p_workspace_id, p_actor_user_id) then
    raise exception 'Calendar availability management access denied';
  end if;

  if p_entity_type = 'working_hours' then
    if p_action <> 'set' then raise exception 'Unsupported working hours action'; end if;
    if p_staff_user_id is null or p_weekday not between 0 and 6 then
      raise exception 'Working hours staff and weekday are required';
    end if;
    if coalesce(p_is_working, false) and (p_start_time is null or p_end_time is null or p_start_time >= p_end_time) then
      raise exception 'Working hours start and end are invalid';
    end if;
    if not exists (
      select 1 from public.workspace_memberships membership
      join public.profiles profile on profile.id = membership.user_id
      where membership.workspace_id = p_workspace_id
        and membership.user_id = p_staff_user_id
        and membership.status = 'active'
        and profile.is_active
    ) then
      raise exception 'Working hours staff member is not active';
    end if;

    select * into hours_record
    from public.calendar_staff_working_hours hours
    where hours.workspace_id = p_workspace_id
      and hours.staff_user_id = p_staff_user_id
      and hours.weekday = p_weekday
    for update;

    if hours_record.workspace_id is not null and (p_expected_version is null or hours_record.version <> p_expected_version) then
      raise exception 'Working hours changed on another device; refresh before saving';
    end if;

    select count(*) into active_appointment_count
    from public.bookings booking
    where booking.workspace_id = p_workspace_id
      and booking.staff_user_id = p_staff_user_id
      and booking.status::text in ('pending', 'confirmed')
      and extract(dow from booking.booking_date)::smallint = p_weekday
      and (
        not coalesce(p_is_working, false)
        or not (private.booking_effective_range(booking) <@ tsrange(
          booking.booking_date + p_start_time,
          booking.booking_date + p_end_time,
          '[)'
        ))
      );
    if active_appointment_count > 0 then
      raise exception 'Reschedule or cancel existing Appointments before changing these working hours';
    end if;

    insert into public.calendar_staff_working_hours (
      workspace_id, staff_user_id, weekday, start_time, end_time, is_working,
      version, created_by, updated_by
    ) values (
      p_workspace_id, p_staff_user_id, p_weekday,
      coalesce(p_start_time, '09:00'::time), coalesce(p_end_time, '17:00'::time),
      coalesce(p_is_working, false), 1, p_actor_user_id, p_actor_user_id
    )
    on conflict (workspace_id, staff_user_id, weekday) do update
    set start_time = excluded.start_time,
        end_time = excluded.end_time,
        is_working = excluded.is_working,
        updated_by = excluded.updated_by,
        version = public.calendar_staff_working_hours.version + 1
    returning * into hours_record;

    resulting_id := p_staff_user_id::text || ':' || p_weekday::text;
    activity_action := 'Staff working hours updated';
    activity_detail := resulting_id || ' · ' || case when hours_record.is_working then hours_record.start_time::text || '–' || hours_record.end_time::text else 'Not working' end;
    command_result := jsonb_build_object('entityType', 'working_hours', 'workingHours', to_jsonb(hours_record));

  elsif p_entity_type = 'break' then
    if p_action not in ('create', 'update', 'archive') then raise exception 'Unsupported staff break action'; end if;
    if p_entity_id is null then raise exception 'Staff break identity is required'; end if;

    if p_action = 'create' then
      if p_staff_user_id is null or p_weekday not between 0 and 6 or p_start_time is null or p_end_time is null or p_start_time >= p_end_time then
        raise exception 'Staff break details are invalid';
      end if;
      if p_name is null or char_length(trim(p_name)) not between 2 and 120 then raise exception 'Staff break label is invalid'; end if;
      if exists (
        select 1 from public.calendar_staff_breaks existing_break
        where existing_break.workspace_id = p_workspace_id
          and existing_break.staff_user_id = p_staff_user_id
          and existing_break.weekday = p_weekday
          and existing_break.status = 'active'
          and existing_break.id <> p_entity_id
          and int4range(
            extract(hour from existing_break.start_time)::integer * 60 + extract(minute from existing_break.start_time)::integer,
            extract(hour from existing_break.end_time)::integer * 60 + extract(minute from existing_break.end_time)::integer,
            '[)'
          ) && int4range(
            extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer,
            extract(hour from p_end_time)::integer * 60 + extract(minute from p_end_time)::integer,
            '[)'
          )
      ) then raise exception 'Staff break overlaps another active break'; end if;
      select count(*) into active_appointment_count
      from public.bookings booking
      where booking.workspace_id = p_workspace_id
        and booking.staff_user_id = p_staff_user_id
        and booking.status::text in ('pending', 'confirmed')
        and extract(dow from booking.booking_date)::smallint = p_weekday
        and private.booking_effective_range(booking) && tsrange(booking.booking_date + p_start_time, booking.booking_date + p_end_time, '[)');
      if active_appointment_count > 0 then raise exception 'Reschedule or cancel existing Appointments before adding this break'; end if;

      insert into public.calendar_staff_breaks (
        id, workspace_id, staff_user_id, weekday, start_time, end_time,
        label, created_by, updated_by
      ) values (
        p_entity_id, p_workspace_id, p_staff_user_id, p_weekday, p_start_time, p_end_time,
        trim(p_name), p_actor_user_id, p_actor_user_id
      ) returning * into break_record;
      activity_action := 'Staff break created';
    else
      select * into break_record from public.calendar_staff_breaks
      where workspace_id = p_workspace_id and id = p_entity_id for update;
      if break_record.id is null then raise exception 'Staff break not found'; end if;
      if p_expected_version is null or break_record.version <> p_expected_version then raise exception 'Staff break changed on another device; refresh before saving'; end if;

      if p_action = 'archive' then
        update public.calendar_staff_breaks
        set status = 'archived', updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into break_record;
        activity_action := 'Staff break archived';
      else
        if p_staff_user_id is null or p_weekday not between 0 and 6 or p_start_time is null or p_end_time is null or p_start_time >= p_end_time then
          raise exception 'Staff break details are invalid';
        end if;
        if p_name is null or char_length(trim(p_name)) not between 2 and 120 then raise exception 'Staff break label is invalid'; end if;
        if exists (
          select 1 from public.calendar_staff_breaks existing_break
          where existing_break.workspace_id = p_workspace_id
            and existing_break.staff_user_id = p_staff_user_id
            and existing_break.weekday = p_weekday
            and existing_break.status = 'active'
            and existing_break.id <> p_entity_id
            and int4range(
              extract(hour from existing_break.start_time)::integer * 60 + extract(minute from existing_break.start_time)::integer,
              extract(hour from existing_break.end_time)::integer * 60 + extract(minute from existing_break.end_time)::integer,
              '[)'
            ) && int4range(
              extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer,
              extract(hour from p_end_time)::integer * 60 + extract(minute from p_end_time)::integer,
              '[)'
            )
        ) then raise exception 'Staff break overlaps another active break'; end if;
        select count(*) into active_appointment_count
        from public.bookings booking
        where booking.workspace_id = p_workspace_id
          and booking.staff_user_id = p_staff_user_id
          and booking.status::text in ('pending', 'confirmed')
          and extract(dow from booking.booking_date)::smallint = p_weekday
          and private.booking_effective_range(booking) && tsrange(booking.booking_date + p_start_time, booking.booking_date + p_end_time, '[)');
        if active_appointment_count > 0 then raise exception 'Reschedule or cancel existing Appointments before changing this break'; end if;

        update public.calendar_staff_breaks
        set staff_user_id = p_staff_user_id, weekday = p_weekday,
            start_time = p_start_time, end_time = p_end_time,
            label = trim(p_name), status = 'active', updated_by = p_actor_user_id,
            version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into break_record;
        activity_action := 'Staff break updated';
      end if;
    end if;
    resulting_id := break_record.id::text;
    activity_detail := break_record.label || ' · weekday ' || break_record.weekday::text;
    command_result := jsonb_build_object('entityType', 'break', 'break', to_jsonb(break_record));

  elsif p_entity_type = 'leave' then
    if p_action not in ('create', 'update', 'cancel') then raise exception 'Unsupported staff leave action'; end if;
    if p_entity_id is null then raise exception 'Staff leave identity is required'; end if;

    if p_action = 'create' then
      if p_staff_user_id is null or p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then raise exception 'Staff leave timing is invalid'; end if;
      if p_reason is null or char_length(trim(p_reason)) not between 2 and 500 then raise exception 'Staff leave reason is invalid'; end if;
      select count(*) into active_appointment_count
      from public.bookings booking
      where booking.workspace_id = p_workspace_id
        and booking.staff_user_id = p_staff_user_id
        and booking.status::text in ('pending', 'confirmed')
        and private.booking_effective_range(booking) && tsrange(p_starts_at, p_ends_at, '[)');
      if active_appointment_count > 0 then raise exception 'Reschedule or cancel existing Appointments before recording this leave'; end if;

      insert into public.calendar_staff_leave (
        id, workspace_id, staff_user_id, starts_at, ends_at, reason,
        created_by, updated_by
      ) values (
        p_entity_id, p_workspace_id, p_staff_user_id, p_starts_at, p_ends_at,
        trim(p_reason), p_actor_user_id, p_actor_user_id
      ) returning * into leave_record;
      activity_action := 'Staff leave created';
    else
      select * into leave_record from public.calendar_staff_leave
      where workspace_id = p_workspace_id and id = p_entity_id for update;
      if leave_record.id is null then raise exception 'Staff leave not found'; end if;
      if p_expected_version is null or leave_record.version <> p_expected_version then raise exception 'Staff leave changed on another device; refresh before saving'; end if;

      if p_action = 'cancel' then
        update public.calendar_staff_leave
        set status = 'cancelled', updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into leave_record;
        activity_action := 'Staff leave cancelled';
      else
        if p_staff_user_id is null or p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then raise exception 'Staff leave timing is invalid'; end if;
        if p_reason is null or char_length(trim(p_reason)) not between 2 and 500 then raise exception 'Staff leave reason is invalid'; end if;
        select count(*) into active_appointment_count
        from public.bookings booking
        where booking.workspace_id = p_workspace_id
          and booking.staff_user_id = p_staff_user_id
          and booking.status::text in ('pending', 'confirmed')
          and private.booking_effective_range(booking) && tsrange(p_starts_at, p_ends_at, '[)');
        if active_appointment_count > 0 then raise exception 'Reschedule or cancel existing Appointments before changing this leave'; end if;

        update public.calendar_staff_leave
        set staff_user_id = p_staff_user_id, starts_at = p_starts_at, ends_at = p_ends_at,
            reason = trim(p_reason), status = 'active', updated_by = p_actor_user_id,
            version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into leave_record;
        activity_action := 'Staff leave updated';
      end if;
    end if;
    resulting_id := leave_record.id::text;
    activity_detail := leave_record.reason || ' · ' || leave_record.starts_at::text || '–' || leave_record.ends_at::text;
    command_result := jsonb_build_object('entityType', 'leave', 'leave', to_jsonb(leave_record));

  else
    if p_action not in ('create', 'update', 'archive', 'restore') then raise exception 'Unsupported room action'; end if;
    if p_entity_id is null then raise exception 'Room identity is required'; end if;

    if p_action = 'create' then
      if p_code is null or trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$' then raise exception 'Room code is invalid'; end if;
      if p_name is null or char_length(trim(p_name)) not between 2 and 120 then raise exception 'Room name is invalid'; end if;
      insert into public.calendar_rooms (
        id, workspace_id, code, name, description, created_by, updated_by
      ) values (
        p_entity_id, p_workspace_id, trim(p_code), trim(p_name), nullif(trim(p_description), ''), p_actor_user_id, p_actor_user_id
      ) returning * into room_record;
      activity_action := 'Calendar room created';
    else
      select * into room_record from public.calendar_rooms
      where workspace_id = p_workspace_id and id = p_entity_id for update;
      if room_record.id is null then raise exception 'Calendar room not found'; end if;
      if p_expected_version is null or room_record.version <> p_expected_version then raise exception 'Calendar room changed on another device; refresh before saving'; end if;

      if p_action = 'archive' then
        if exists (
          select 1 from public.bookings booking
          where booking.workspace_id = p_workspace_id and booking.room_id = p_entity_id
            and booking.status::text in ('pending', 'confirmed') and booking.booking_date >= current_date
        ) then raise exception 'Reschedule or cancel future Appointments before archiving this room'; end if;
        update public.calendar_rooms
        set status = 'archived', updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into room_record;
        activity_action := 'Calendar room archived';
      elsif p_action = 'restore' then
        update public.calendar_rooms
        set status = 'active', updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into room_record;
        activity_action := 'Calendar room restored';
      else
        if p_code is null or trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$' then raise exception 'Room code is invalid'; end if;
        if p_name is null or char_length(trim(p_name)) not between 2 and 120 then raise exception 'Room name is invalid'; end if;
        update public.calendar_rooms
        set code = trim(p_code), name = trim(p_name), description = nullif(trim(p_description), ''),
            updated_by = p_actor_user_id, version = version + 1
        where workspace_id = p_workspace_id and id = p_entity_id returning * into room_record;
        activity_action := 'Calendar room updated';
      end if;
    end if;
    resulting_id := room_record.id::text;
    activity_detail := room_record.code::text || ' · ' || room_record.name;
    command_result := jsonb_build_object('entityType', 'room', 'room', to_jsonb(room_record));
  end if;

  insert into public.calendar_availability_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), p_entity_type, resulting_id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action, activity_detail, 'blue',
    'calendar_' || p_entity_type, resulting_id, p_command_id,
    jsonb_build_object('entity_type', p_entity_type, 'action', p_action, 'idempotency_key', p_idempotency_key)
  );

  return command_result;
exception
  when unique_violation then
    if p_entity_type = 'room' then raise exception 'Room code or name already exists in this workspace'; end if;
    raise;
end;
$$;

revoke all on function private.calendar_availability_actor_can_manage(uuid, uuid) from public;
revoke all on function private.booking_effective_range(public.bookings) from public;
revoke all on function private.enforce_booking_availability() from public;
revoke all on function public.apply_calendar_availability_command(uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint, time, time, timestamp, timestamp, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function private.calendar_availability_actor_can_manage(uuid, uuid) to service_role;
grant execute on function private.booking_effective_range(public.bookings) to service_role;
grant execute on function private.enforce_booking_availability() to service_role;
grant execute on function public.apply_calendar_availability_command(uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint, time, time, timestamp, timestamp, text, text, text, text, boolean) to service_role;

alter table public.calendar_rooms enable row level security;
alter table public.calendar_staff_working_hours enable row level security;
alter table public.calendar_staff_breaks enable row level security;
alter table public.calendar_staff_leave enable row level security;
alter table public.calendar_availability_command_receipts enable row level security;

grant select on public.calendar_rooms, public.calendar_staff_working_hours,
  public.calendar_staff_breaks, public.calendar_staff_leave to authenticated;
revoke insert, update, delete on public.calendar_rooms, public.calendar_staff_working_hours,
  public.calendar_staff_breaks, public.calendar_staff_leave from anon, authenticated;
revoke all on public.calendar_availability_command_receipts from anon, authenticated;

create policy "Calendar rooms view"
on public.calendar_rooms for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));
create policy "Calendar working hours view"
on public.calendar_staff_working_hours for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));
create policy "Calendar breaks view"
on public.calendar_staff_breaks for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));
create policy "Calendar leave view"
on public.calendar_staff_leave for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));

comment on table public.calendar_rooms is 'Workspace-owned rooms and resources available for Appointment assignment.';
comment on table public.calendar_staff_working_hours is 'One authoritative recurring working interval per staff member and weekday.';
comment on table public.calendar_staff_breaks is 'Recurring unavailable break intervals owned by Calendar.';
comment on table public.calendar_staff_leave is 'Date-specific unavailable staff intervals stored in the workspace local timezone.';
comment on function public.apply_calendar_availability_command(uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint, time, time, timestamp, timestamp, text, text, text, text, boolean) is 'Trusted idempotent manager command for Calendar working hours, breaks, leave and rooms.';
comment on trigger bookings_enforce_availability on public.bookings is 'Enforces configured staff working hours, breaks, leave and active room resolution before Appointment writes.';

commit;


begin;

create or replace function private.enforce_booking_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_start timestamp;
  effective_end timestamp;
  weekday_value smallint;
  room_record public.calendar_rooms;
begin
  if new.status::text in ('cancelled', 'completed') then
    return new;
  end if;

  effective_start := new.booking_date + new.booking_time - make_interval(mins => new.preparation_buffer_minutes);
  effective_end := new.booking_date + new.booking_time + make_interval(mins => new.duration_minutes + new.recovery_buffer_minutes);
  weekday_value := extract(dow from new.booking_date)::smallint;

  if effective_start::date <> new.booking_date or effective_end::date <> new.booking_date then
    raise exception 'Appointment effective time must remain within one working day';
  end if;

  if not exists (
    select 1
    from public.calendar_staff_working_hours hours
    where hours.workspace_id = new.workspace_id
      and hours.staff_user_id = new.staff_user_id
      and hours.weekday = weekday_value
      and hours.is_working
      and effective_start::time >= hours.start_time
      and effective_end::time <= hours.end_time
  ) then
    raise exception 'Appointment is outside the staff member working hours';
  end if;

  if exists (
    select 1
    from public.calendar_staff_breaks break_record
    where break_record.workspace_id = new.workspace_id
      and break_record.staff_user_id = new.staff_user_id
      and break_record.weekday = weekday_value
      and break_record.status = 'active'
      and tsrange(
        new.booking_date + break_record.start_time,
        new.booking_date + break_record.end_time,
        '[)'
      ) && tsrange(effective_start, effective_end, '[)')
  ) then
    raise exception 'Appointment overlaps a staff break';
  end if;

  if exists (
    select 1
    from public.calendar_staff_leave leave_record
    where leave_record.workspace_id = new.workspace_id
      and leave_record.staff_user_id = new.staff_user_id
      and leave_record.status = 'active'
      and tsrange(leave_record.starts_at, leave_record.ends_at, '[)')
        && tsrange(effective_start, effective_end, '[)')
  ) then
    raise exception 'Appointment overlaps staff leave';
  end if;

  if new.room_name is null or trim(new.room_name) = '' then
    new.room_id := null;
    new.room_name := null;
  else
    select * into room_record
    from public.calendar_rooms room
    where room.workspace_id = new.workspace_id
      and room.status = 'active'
      and (lower(room.name) = lower(trim(new.room_name)) or lower(room.code::text) = lower(trim(new.room_name)))
    limit 1;

    if room_record.id is null then
      raise exception 'Appointment room is not an active configured room';
    end if;

    if exists (
      select 1
      from public.bookings existing
      where existing.workspace_id = new.workspace_id
        and existing.room_id = room_record.id
        and existing.id <> new.id
        and existing.status <> 'cancelled'::public.booking_status
        and private.booking_effective_range(existing)
          && tsrange(effective_start, effective_end, '[)')
    ) then
      raise exception 'Appointment conflicts with another booking for this room';
    end if;

    new.room_id := room_record.id;
    new.room_name := room_record.name;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_booking_availability() from public;
grant execute on function private.enforce_booking_availability() to service_role;

comment on function private.enforce_booking_availability() is
  'Enforces working hours, recurring breaks, leave, active room resolution and distinct room conflict errors before Appointment constraints run.';

commit;


begin;

create index calendar_staff_working_hours_created_by_idx
  on public.calendar_staff_working_hours(created_by)
  where created_by is not null;

create index calendar_staff_working_hours_updated_by_idx
  on public.calendar_staff_working_hours(updated_by)
  where updated_by is not null;

drop index if exists public.calendar_staff_leave_staff_time_idx;

commit;


begin;

revoke all on table public.calendar_rooms from anon;
revoke all on table public.calendar_staff_working_hours from anon;
revoke all on table public.calendar_staff_breaks from anon;
revoke all on table public.calendar_staff_leave from anon;
revoke all on table public.calendar_availability_command_receipts from anon;

commit;


begin;

create table public.calendar_staff_service_eligibility (
  workspace_id uuid not null,
  staff_user_id uuid not null,
  service_id uuid not null,
  status text not null default 'active',
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, staff_user_id, service_id),
  foreign key (workspace_id, staff_user_id)
    references public.workspace_memberships(workspace_id, user_id) on delete cascade,
  foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete cascade,
  constraint calendar_staff_service_eligibility_status_check check (status in ('active', 'archived')),
  constraint calendar_staff_service_eligibility_version_check check (version > 0)
);

create index calendar_staff_service_eligibility_service_idx
  on public.calendar_staff_service_eligibility(workspace_id, service_id, status, staff_user_id);
create index calendar_staff_service_eligibility_staff_idx
  on public.calendar_staff_service_eligibility(workspace_id, staff_user_id, status, service_id);
create index calendar_staff_service_eligibility_created_by_idx
  on public.calendar_staff_service_eligibility(created_by) where created_by is not null;
create index calendar_staff_service_eligibility_updated_by_idx
  on public.calendar_staff_service_eligibility(updated_by) where updated_by is not null;

create table public.calendar_service_eligibility_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  staff_user_id uuid not null,
  service_id uuid not null,
  action text not null check (action = 'set'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index calendar_service_eligibility_receipts_pair_idx
  on public.calendar_service_eligibility_command_receipts(workspace_id, service_id, staff_user_id, created_at desc);

create trigger calendar_staff_service_eligibility_touch_updated_at
before update on public.calendar_staff_service_eligibility
for each row execute function private.touch_updated_at();

create or replace function private.calendar_service_eligibility_actor_can_manage(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'calendar',
    'approve'
  );
$$;

create or replace function private.enforce_booking_service_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text not in ('pending', 'confirmed') then
    return new;
  end if;

  if new.service_id is null or new.staff_user_id is null then
    raise exception 'Appointment Service and staff eligibility are required';
  end if;

  if not exists (
    select 1
    from public.calendar_staff_service_eligibility eligibility
    where eligibility.workspace_id = new.workspace_id
      and eligibility.service_id = new.service_id
      and eligibility.staff_user_id = new.staff_user_id
      and eligibility.status = 'active'
  ) then
    raise exception 'Appointment staff member is not eligible for this Service';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_service_eligibility on public.bookings;
create trigger bookings_enforce_service_eligibility
before insert or update of service_id, staff_user_id, status
on public.bookings
for each row execute function private.enforce_booking_service_eligibility();

create or replace function public.apply_calendar_service_eligibility_command(
  p_workspace_id uuid,
  p_staff_user_id uuid,
  p_service_id uuid,
  p_is_eligible boolean,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  eligibility_record public.calendar_staff_service_eligibility;
  staff_exists boolean;
  staff_active boolean;
  service_exists boolean;
  service_active boolean;
  changed boolean := false;
  dependent_appointment_count integer := 0;
  staff_name_value text;
  service_name_value text;
begin
  if p_workspace_id is null or p_staff_user_id is null or p_service_id is null or p_is_eligible is null then
    raise exception 'Calendar Service eligibility details are required';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Calendar Service eligibility idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.calendar_service_eligibility_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.calendar_service_eligibility_actor_can_manage(p_workspace_id, p_actor_user_id) then
    raise exception 'Calendar Service eligibility management access denied';
  end if;

  select true,
         membership.status = 'active' and profile.is_active,
         coalesce(profile.full_name, 'Workspace staff member')
    into staff_exists, staff_active, staff_name_value
  from public.workspace_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  where membership.workspace_id = p_workspace_id
    and membership.user_id = p_staff_user_id
  limit 1;

  select true, service.status = 'active', service.name
    into service_exists, service_active, service_name_value
  from public.services service
  where service.workspace_id = p_workspace_id
    and service.id = p_service_id
  limit 1;

  if not coalesce(staff_exists, false) then raise exception 'Calendar eligibility staff member not found'; end if;
  if not coalesce(service_exists, false) then raise exception 'Calendar eligibility Service not found'; end if;
  if p_is_eligible and not coalesce(staff_active, false) then raise exception 'Only active staff members can be assigned to Services'; end if;
  if p_is_eligible and not coalesce(service_active, false) then raise exception 'Only active Services can receive staff assignments'; end if;

  select * into eligibility_record
  from public.calendar_staff_service_eligibility eligibility
  where eligibility.workspace_id = p_workspace_id
    and eligibility.staff_user_id = p_staff_user_id
    and eligibility.service_id = p_service_id
  for update;

  if eligibility_record.workspace_id is null then
    if p_expected_version is not null then
      raise exception 'Calendar Service eligibility changed on another device; refresh before saving';
    end if;

    if p_is_eligible then
      insert into public.calendar_staff_service_eligibility (
        workspace_id, staff_user_id, service_id, status, version, created_by, updated_by
      ) values (
        p_workspace_id, p_staff_user_id, p_service_id, 'active', 1, p_actor_user_id, p_actor_user_id
      ) returning * into eligibility_record;
      changed := true;
    end if;
  else
    if p_expected_version is null or eligibility_record.version <> p_expected_version then
      raise exception 'Calendar Service eligibility changed on another device; refresh before saving';
    end if;

    if p_is_eligible and eligibility_record.status <> 'active' then
      update public.calendar_staff_service_eligibility
      set status = 'active', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id
        and staff_user_id = p_staff_user_id
        and service_id = p_service_id
      returning * into eligibility_record;
      changed := true;
    elsif not p_is_eligible and eligibility_record.status = 'active' then
      select count(*) into dependent_appointment_count
      from public.bookings booking
      where booking.workspace_id = p_workspace_id
        and booking.staff_user_id = p_staff_user_id
        and booking.service_id = p_service_id
        and booking.status::text in ('pending', 'confirmed');

      if dependent_appointment_count > 0 then
        raise exception 'Reschedule or cancel existing Appointments before removing this Service eligibility';
      end if;

      update public.calendar_staff_service_eligibility
      set status = 'archived', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id
        and staff_user_id = p_staff_user_id
        and service_id = p_service_id
      returning * into eligibility_record;
      changed := true;
    end if;
  end if;

  command_result := jsonb_build_object(
    'action', 'set',
    'changed', changed,
    'isEligible', p_is_eligible,
    'staffUserId', p_staff_user_id,
    'serviceId', p_service_id,
    'eligibility', case when eligibility_record.workspace_id is null then null else to_jsonb(eligibility_record) end
  );

  insert into public.calendar_service_eligibility_command_receipts (
    workspace_id, idempotency_key, staff_user_id, service_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), p_staff_user_id, p_service_id, 'set', command_result
  );

  if changed then
    insert into public.activity_items (
      workspace_id, actor_user_id, action, detail, tone,
      entity_type, entity_id, command_id, metadata
    ) values (
      p_workspace_id,
      p_actor_user_id,
      case when p_is_eligible then 'Service eligibility assigned' else 'Service eligibility removed' end,
      staff_name_value || ' · ' || service_name_value,
      case when p_is_eligible then 'green' else 'gold' end,
      'calendar_service_eligibility',
      p_staff_user_id::text || ':' || p_service_id::text,
      p_command_id,
      jsonb_build_object(
        'staff_user_id', p_staff_user_id,
        'service_id', p_service_id,
        'is_eligible', p_is_eligible,
        'version', eligibility_record.version,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  return command_result;
end;
$$;

revoke all on function private.calendar_service_eligibility_actor_can_manage(uuid, uuid) from public;
revoke all on function private.enforce_booking_service_eligibility() from public;
revoke all on function public.apply_calendar_service_eligibility_command(uuid, uuid, uuid, boolean, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function private.calendar_service_eligibility_actor_can_manage(uuid, uuid) to service_role;
grant execute on function private.enforce_booking_service_eligibility() to service_role;
grant execute on function public.apply_calendar_service_eligibility_command(uuid, uuid, uuid, boolean, text, uuid, uuid, integer) to service_role;

revoke all on table public.calendar_staff_service_eligibility, public.calendar_service_eligibility_command_receipts from anon, authenticated;
grant select on table public.calendar_staff_service_eligibility to authenticated;

alter table public.calendar_staff_service_eligibility enable row level security;
alter table public.calendar_service_eligibility_command_receipts enable row level security;

create policy "Calendar Service eligibility permission read"
on public.calendar_staff_service_eligibility for select to authenticated
using (private.has_workspace_permission(workspace_id, 'calendar', 'view'));

comment on table public.calendar_staff_service_eligibility is
  'Calendar-owned relationship assigning active workspace staff members to the Services they may perform.';
comment on table public.calendar_service_eligibility_command_receipts is
  'Service-role-only idempotency receipts for staff-to-Service eligibility changes.';
comment on function public.apply_calendar_service_eligibility_command(uuid, uuid, uuid, boolean, text, uuid, uuid, integer) is
  'Assigns or removes one staff-to-Service eligibility relationship without duplicating staff or Service records.';

commit;


begin;

create table public.sale_drafts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(trim(reference)) between 8 and 64),
  source_appointment_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  customer_name_snapshot text not null check (char_length(trim(customer_name_snapshot)) between 1 and 200),
  service_code_snapshot text not null check (char_length(trim(service_code_snapshot)) between 1 and 64),
  service_name_snapshot text not null check (char_length(trim(service_name_snapshot)) between 1 and 240),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  discount_amount numeric(16,4) not null default 0 check (discount_amount >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  occurred_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'open' check (status in ('open', 'discarded', 'converted')),
  version integer not null default 1 check (version > 0),
  converted_sale_id uuid,
  converted_at timestamptz,
  converted_by uuid references auth.users(id) on delete restrict,
  discarded_at timestamptz,
  discarded_by uuid references auth.users(id) on delete restrict,
  discard_reason text check (discard_reason is null or char_length(discard_reason) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  unique (workspace_id, source_appointment_id),
  foreign key (workspace_id, source_appointment_id)
    references public.bookings(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete restrict,
  foreign key (workspace_id, converted_sale_id)
    references public.sales(workspace_id, id) on delete restrict,
  constraint sale_drafts_discount_check check (
    unit_price is null or discount_amount <= round(quantity * unit_price, 4)
  ),
  constraint sale_drafts_status_shape check (
    (
      status = 'open'
      and converted_sale_id is null and converted_at is null and converted_by is null
      and discarded_at is null and discarded_by is null and discard_reason is null
    )
    or (
      status = 'discarded'
      and converted_sale_id is null and converted_at is null and converted_by is null
      and discarded_at is not null and discarded_by is not null and discard_reason is not null
    )
    or (
      status = 'converted'
      and converted_sale_id is not null and converted_at is not null and converted_by is not null
      and discarded_at is null and discarded_by is null and discard_reason is null
    )
  )
);

create index sale_drafts_workspace_status_time_idx
  on public.sale_drafts(workspace_id, status, occurred_at desc, id desc);
create index sale_drafts_workspace_customer_idx
  on public.sale_drafts(workspace_id, customer_id, occurred_at desc);
create index sale_drafts_workspace_service_idx
  on public.sale_drafts(workspace_id, service_id, occurred_at desc);
create unique index sale_drafts_converted_sale_idx
  on public.sale_drafts(workspace_id, converted_sale_id)
  where converted_sale_id is not null;
create index sale_drafts_created_by_idx on public.sale_drafts(created_by);
create index sale_drafts_updated_by_idx on public.sale_drafts(updated_by);
create index sale_drafts_converted_by_idx on public.sale_drafts(converted_by) where converted_by is not null;
create index sale_drafts_discarded_by_idx on public.sale_drafts(discarded_by) where discarded_by is not null;

create table public.sale_draft_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  draft_id uuid not null,
  action text not null check (action in ('create', 'update', 'discard', 'restore', 'complete')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, draft_id)
    references public.sale_drafts(workspace_id, id) on delete cascade
);

create index sale_draft_command_receipts_draft_idx
  on public.sale_draft_command_receipts(workspace_id, draft_id, created_at desc);

create trigger sale_drafts_touch_updated_at
before update on public.sale_drafts
for each row execute function private.touch_updated_at();

create or replace function public.apply_appointment_sale_draft_command(
  p_workspace_id uuid,
  p_draft_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_appointment_id uuid default null,
  p_sale_id uuid default null,
  p_unit_price numeric default null,
  p_discount_amount numeric default 0,
  p_occurred_at timestamptz default null,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  draft_record public.sale_drafts;
  appointment_record public.bookings;
  sale_record public.sales;
  currency_value text;
  gross_value numeric;
  discount_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  activity_action text;
  activity_tone text;
  sale_line_id uuid;
begin
  if p_action not in ('create', 'update', 'discard', 'restore', 'complete') then
    raise exception 'Unsupported Appointment Sale draft action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment Sale draft idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.sale_draft_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.sales_actor_can_write(p_workspace_id, p_actor_user_id, 'complete') then
    raise exception 'Appointment Sale draft access denied';
  end if;

  if p_action = 'create' then
    if p_appointment_id is null then raise exception 'Completed Appointment is required'; end if;

    select * into draft_record
    from public.sale_drafts draft
    where draft.workspace_id = p_workspace_id
      and draft.source_appointment_id = p_appointment_id
    for update;

    if draft_record.id is not null then
      command_result := jsonb_build_object('action', 'create', 'draft', to_jsonb(draft_record), 'existing', true);
      insert into public.sale_draft_command_receipts (workspace_id, idempotency_key, draft_id, action, result)
      values (p_workspace_id, trim(p_idempotency_key), draft_record.id, 'create', command_result);
      return command_result;
    end if;

    select * into appointment_record
    from public.bookings booking
    where booking.workspace_id = p_workspace_id
      and booking.id = p_appointment_id
    for update;

    if appointment_record.id is null then raise exception 'Appointment not found'; end if;
    if appointment_record.status::text <> 'completed' or appointment_record.completed_at is null then
      raise exception 'Only completed Appointments can create Sale drafts';
    end if;
    if appointment_record.customer_id is null or appointment_record.service_id is null then
      raise exception 'Appointment Customer and Service are required for a Sale draft';
    end if;

    select upper(trim(settings.currency)) into currency_value
    from public.workspace_settings settings
    where settings.workspace_id = p_workspace_id;
    if currency_value is null or currency_value !~ '^[A-Z]{3}$' then
      raise exception 'Workspace currency is unavailable';
    end if;

    insert into public.sale_drafts (
      id, workspace_id, reference, source_appointment_id, customer_id, service_id,
      customer_name_snapshot, service_code_snapshot, service_name_snapshot,
      currency, quantity, unit_price, discount_amount, vat_rate, occurred_at,
      notes, created_by, updated_by
    ) values (
      p_draft_id, p_workspace_id,
      'SD-' || upper(right(replace(p_draft_id::text, '-', ''), 16)),
      appointment_record.id, appointment_record.customer_id, appointment_record.service_id,
      coalesce(nullif(trim(appointment_record.customer_name_snapshot), ''), 'Customer'),
      coalesce(nullif(trim(appointment_record.service_code_snapshot), ''), 'SERVICE'),
      appointment_record.title,
      currency_value, 1, appointment_record.price_snapshot, 0,
      appointment_record.vat_rate_snapshot, appointment_record.completed_at,
      'Created from Appointment ' || appointment_record.reference,
      p_actor_user_id, p_actor_user_id
    ) returning * into draft_record;

    activity_action := 'Appointment Sale draft created';
    activity_tone := 'blue';

  else
    select * into draft_record
    from public.sale_drafts draft
    where draft.workspace_id = p_workspace_id
      and draft.id = p_draft_id
    for update;

    if draft_record.id is null then raise exception 'Appointment Sale draft not found'; end if;

    if p_action = 'complete' and draft_record.status = 'converted' then
      select * into sale_record
      from public.sales sale
      where sale.workspace_id = p_workspace_id
        and sale.id = draft_record.converted_sale_id;
      command_result := jsonb_build_object(
        'action', 'complete',
        'draft', to_jsonb(draft_record),
        'sale', to_jsonb(sale_record),
        'existing', true,
        'inventoryMovementCount', 0
      );
      insert into public.sale_draft_command_receipts (workspace_id, idempotency_key, draft_id, action, result)
      values (p_workspace_id, trim(p_idempotency_key), draft_record.id, 'complete', command_result);
      return command_result;
    end if;

    if p_expected_version is null or draft_record.version <> p_expected_version then
      raise exception 'Appointment Sale draft changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be edited'; end if;
      if p_unit_price is null or p_unit_price < 0 then raise exception 'Appointment Sale draft price is required'; end if;
      if p_discount_amount is null or p_discount_amount < 0
        or p_discount_amount > round(draft_record.quantity * p_unit_price, 4) then
        raise exception 'Appointment Sale draft discount is invalid';
      end if;
      if p_occurred_at is null then raise exception 'Appointment Sale date and time are required'; end if;
      if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Appointment Sale notes are too long'; end if;

      update public.sale_drafts
      set unit_price = round(p_unit_price, 4),
          discount_amount = round(p_discount_amount, 4),
          occurred_at = p_occurred_at,
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft updated';
      activity_tone := 'blue';

    elsif p_action = 'discard' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be discarded'; end if;
      if p_reason is null or char_length(trim(p_reason)) not between 2 and 500 then
        raise exception 'Appointment Sale draft discard reason is required';
      end if;
      update public.sale_drafts
      set status = 'discarded',
          discarded_at = now(),
          discarded_by = p_actor_user_id,
          discard_reason = trim(p_reason),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft discarded';
      activity_tone := 'gold';

    elsif p_action = 'restore' then
      if draft_record.status <> 'discarded' then raise exception 'Only discarded Appointment Sale drafts can be restored'; end if;
      update public.sale_drafts
      set status = 'open',
          discarded_at = null,
          discarded_by = null,
          discard_reason = null,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft restored';
      activity_tone := 'green';

    elsif p_action = 'complete' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be completed'; end if;
      if p_sale_id is null then raise exception 'Sale identity is required'; end if;
      if draft_record.unit_price is null then raise exception 'Review and set the Appointment Sale price before completion'; end if;
      if exists (select 1 from public.sales where id = p_sale_id) then raise exception 'Sale identity conflict'; end if;

      gross_value := round(draft_record.quantity * draft_record.unit_price, 4);
      discount_value := round(draft_record.discount_amount, 4);
      if discount_value > gross_value then raise exception 'Appointment Sale draft discount is invalid'; end if;
      total_value := round(gross_value - discount_value, 4);
      vat_value := case
        when draft_record.vat_rate = 0 then 0
        else round(total_value * draft_record.vat_rate / (100 + draft_record.vat_rate), 4)
      end;
      net_value := round(total_value - vat_value, 4);
      sale_line_id := gen_random_uuid();

      insert into public.sales (
        id, workspace_id, reference, customer_id, channel, currency,
        gross_amount, discount_amount, net_amount, vat_amount, total_amount,
        inventory_location_id, notes, occurred_at, completed_by
      ) values (
        p_sale_id, p_workspace_id, 'SALE-PENDING', draft_record.customer_id,
        'appointment', draft_record.currency,
        gross_value, discount_value, net_value, vat_value, total_value,
        null, draft_record.notes, draft_record.occurred_at, p_actor_user_id
      ) returning * into sale_record;

      insert into public.sale_lines (
        id, workspace_id, sale_id, line_number, line_type,
        product_id, service_id, code_snapshot, description_snapshot,
        quantity, unit_price, unit_cost_snapshot, gross_amount,
        discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        sale_line_id, p_workspace_id, sale_record.id, 1, 'service',
        null, draft_record.service_id, draft_record.service_code_snapshot,
        draft_record.service_name_snapshot, draft_record.quantity,
        draft_record.unit_price, null, gross_value, discount_value,
        net_value, draft_record.vat_rate, vat_value, total_value
      );

      update public.sale_drafts
      set status = 'converted',
          converted_sale_id = sale_record.id,
          converted_at = now(),
          converted_by = p_actor_user_id,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;

      insert into public.activity_items (
        workspace_id, actor_user_id, action, detail, tone,
        entity_type, entity_id, command_id, metadata
      ) values (
        p_workspace_id, p_actor_user_id, 'Sale completed from Appointment',
        sale_record.reference || ' · ' || draft_record.service_name_snapshot || ' · ' || draft_record.currency || ' ' || total_value::text,
        'green', 'sale', sale_record.id::text, p_command_id,
        jsonb_build_object(
          'sale_id', sale_record.id,
          'sale_reference', sale_record.reference,
          'sale_draft_id', draft_record.id,
          'appointment_id', draft_record.source_appointment_id,
          'customer_id', draft_record.customer_id,
          'service_id', draft_record.service_id,
          'line_count', 1,
          'inventory_movement_count', 0,
          'total_amount', total_value,
          'settlement_status', 'not_recorded',
          'idempotency_key', p_idempotency_key
        )
      );

      activity_action := 'Appointment Sale draft converted';
      activity_tone := 'green';
    else
      raise exception 'Unsupported Appointment Sale draft action';
    end if;
  end if;

  command_result := case
    when p_action = 'complete' then jsonb_build_object(
      'action', p_action,
      'draft', to_jsonb(draft_record),
      'sale', to_jsonb(sale_record),
      'inventoryMovementCount', 0
    )
    else jsonb_build_object('action', p_action, 'draft', to_jsonb(draft_record))
  end;

  insert into public.sale_draft_command_receipts (
    workspace_id, idempotency_key, draft_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), draft_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    draft_record.reference || ' · ' || draft_record.customer_name_snapshot || ' · ' || draft_record.service_name_snapshot,
    activity_tone, 'sale_draft', draft_record.id::text, p_command_id,
    jsonb_build_object(
      'sale_draft_id', draft_record.id,
      'appointment_id', draft_record.source_appointment_id,
      'sale_id', draft_record.converted_sale_id,
      'status', draft_record.status,
      'version', draft_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) to service_role;

revoke all on table public.sale_drafts, public.sale_draft_command_receipts from anon, authenticated;
grant select on table public.sale_drafts to authenticated;

alter table public.sale_drafts enable row level security;
alter table public.sale_draft_command_receipts enable row level security;

create policy "Sales permission read Appointment Sale drafts"
on public.sale_drafts for select to authenticated
using (private.has_workspace_permission(workspace_id, 'sales', 'view'));

comment on table public.sale_drafts is
  'Sales-owned review drafts created one-to-one from completed Appointments. Draft creation has no Inventory, Payment, invoice or Banking side effects.';
comment on table public.sale_draft_command_receipts is
  'Service-role-only idempotency receipts for Appointment-to-Sale draft commands.';
comment on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) is
  'Creates, reviews, discards, restores or completes one Sales-owned draft from a completed Appointment. Completion creates one immutable service-only Sale with no settlement or Inventory movement.';

commit;

begin;

alter table public.inventory_movements
  add column appointment_id uuid,
  add constraint inventory_movements_workspace_appointment_fkey
    foreign key (workspace_id, appointment_id)
    references public.bookings(workspace_id, id) on delete restrict,
  add constraint inventory_movements_appointment_shape check (
    appointment_id is null
    or (
      source_type = 'appointment_consumption'
      and source_id = appointment_id::text
      and movement_type in ('internal_consumption', 'reversal')
    )
  );

create index inventory_movements_workspace_appointment_time_idx
  on public.inventory_movements(workspace_id, appointment_id, occurred_at desc, id desc)
  where appointment_id is not null;

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_action_check,
  add constraint inventory_command_receipts_action_check check (
    action in (
      'create_location',
      'update_location',
      'archive_location',
      'restore_location',
      'post_movement',
      'reverse_movement',
      'transfer_stock',
      'post_supplier_document',
      'reverse_supplier_document',
      'post_appointment_consumption',
      'reverse_appointment_consumption'
    )
  );

create or replace function private.enforce_appointment_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  appointment_record public.bookings;
  product_record public.products;
  original_record public.inventory_movements;
begin
  if new.movement_type = 'appointment_consumption' then
    raise exception 'Appointment Product use must be recorded as internal consumption';
  end if;

  if new.reversal_of_id is not null then
    select * into original_record
    from public.inventory_movements movement
    where movement.workspace_id = new.workspace_id
      and movement.id = new.reversal_of_id;

    if original_record.appointment_id is not null then
      new.appointment_id := original_record.appointment_id;
      new.source_type := 'appointment_consumption';
      new.source_id := original_record.appointment_id::text;
    end if;
  end if;

  if new.source_type = 'appointment_consumption' and new.appointment_id is null then
    raise exception 'Appointment consumption requires a canonical Appointment link';
  end if;

  if new.appointment_id is null then
    return new;
  end if;

  if new.source_type is distinct from 'appointment_consumption'
     or new.source_id is distinct from new.appointment_id::text then
    raise exception 'Appointment consumption source link is invalid';
  end if;

  if new.movement_type = 'internal_consumption' then
    if new.reversal_of_id is not null or new.quantity_delta >= 0 then
      raise exception 'Appointment consumption must be an outbound internal-consumption movement';
    end if;

    select * into appointment_record
    from public.bookings appointment
    where appointment.workspace_id = new.workspace_id
      and appointment.id = new.appointment_id
      and appointment.status::text = 'completed'
      and appointment.service_id is not null;

    if appointment_record.id is null then
      raise exception 'Only completed Service Appointments can record Product consumption';
    end if;

    select * into product_record
    from public.products product
    where product.workspace_id = new.workspace_id
      and product.id = new.product_id
      and product.status = 'active';

    if product_record.id is null then
      raise exception 'Appointment consumption Product is unavailable';
    end if;
    if product_record.purpose <> 'supply' then
      raise exception 'Resale Products must leave Inventory through a completed Sale';
    end if;
  elsif new.movement_type = 'reversal' then
    if new.reversal_of_id is null or new.quantity_delta <= 0 then
      raise exception 'Appointment consumption reversal shape is invalid';
    end if;
    if original_record.id is null
       or original_record.appointment_id is distinct from new.appointment_id
       or original_record.movement_type <> 'internal_consumption'
       or original_record.source_type <> 'appointment_consumption' then
      raise exception 'Appointment consumption reversal source is invalid';
    end if;
  else
    raise exception 'Appointment-linked Inventory movements must be internal consumption or reversal';
  end if;

  return new;
end;
$$;

create trigger inventory_movements_enforce_appointment_consumption
before insert on public.inventory_movements
for each row execute function private.enforce_appointment_inventory_movement();

create or replace function public.post_appointment_product_consumption(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_appointment_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  appointment_record public.bookings;
  product_record public.products;
  location_record public.inventory_locations;
  movement_record public.inventory_movements;
  workspace_currency text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment consumption idempotency key is invalid';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000 then
    raise exception 'Appointment consumption quantity is invalid';
  end if;
  if p_note is not null and char_length(trim(p_note)) > 500 then
    raise exception 'Appointment consumption note is too long';
  end if;

  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'inventory',
    'create'
  ) then
    raise exception 'Appointment consumption access denied';
  end if;

  select * into appointment_record
  from public.bookings appointment
  where appointment.workspace_id = p_workspace_id
    and appointment.id = p_appointment_id
  for update;
  if appointment_record.id is null then raise exception 'Appointment not found'; end if;
  if appointment_record.status::text <> 'completed' or appointment_record.service_id is null then
    raise exception 'Only completed Service Appointments can record Product consumption';
  end if;

  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id
    and product.id = p_product_id
    and product.status = 'active';
  if product_record.id is null then raise exception 'Appointment consumption Product is unavailable'; end if;
  if product_record.purpose <> 'supply' then
    raise exception 'Resale Products must leave Inventory through a completed Sale';
  end if;

  select * into location_record
  from public.inventory_locations location
  where location.workspace_id = p_workspace_id
    and location.id = p_location_id
    and location.status = 'active';
  if location_record.id is null then raise exception 'Appointment consumption Inventory location is unavailable'; end if;

  select coalesce(settings.currency, 'GBP') into workspace_currency
  from public.workspace_settings settings
  where settings.workspace_id = p_workspace_id;
  workspace_currency := coalesce(workspace_currency, 'GBP');

  insert into public.inventory_movements (
    id,
    workspace_id,
    product_id,
    location_id,
    appointment_id,
    movement_type,
    quantity_delta,
    unit_cost,
    currency,
    source_type,
    source_id,
    idempotency_key,
    command_id,
    actor_user_id,
    note,
    metadata,
    occurred_at
  ) values (
    p_movement_id,
    p_workspace_id,
    p_product_id,
    p_location_id,
    p_appointment_id,
    'internal_consumption',
    -abs(p_quantity),
    product_record.unit_cost,
    upper(workspace_currency),
    'appointment_consumption',
    p_appointment_id::text,
    trim(p_idempotency_key),
    p_command_id,
    p_actor_user_id,
    nullif(trim(p_note), ''),
    jsonb_build_object(
      'appointment_id', appointment_record.id,
      'appointment_reference', appointment_record.reference,
      'customer_id', appointment_record.customer_id,
      'customer_name', appointment_record.customer_name_snapshot,
      'service_id', appointment_record.service_id,
      'service_code', appointment_record.service_code_snapshot,
      'service_name', appointment_record.title,
      'product_sku', product_record.sku::text,
      'product_name', product_record.name,
      'unit_label', product_record.unit_label,
      'location_code', location_record.code::text,
      'location_name', location_record.name
    ),
    coalesce(p_occurred_at, appointment_record.completed_at, now())
  ) returning * into movement_record;

  command_result := jsonb_build_object(
    'action', 'post_appointment_consumption',
    'movement', to_jsonb(movement_record),
    'appointment', jsonb_build_object(
      'id', appointment_record.id,
      'reference', appointment_record.reference
    )
  );

  insert into public.inventory_command_receipts (
    workspace_id,
    idempotency_key,
    action,
    entity_type,
    entity_id,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    'post_appointment_consumption',
    'inventory_movement',
    movement_record.id,
    command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Appointment Product consumption posted',
    appointment_record.reference || ' · ' || product_record.name || ' · ' || abs(p_quantity)::text || ' ' || product_record.unit_label,
    'gold',
    'appointment',
    appointment_record.id::text,
    p_command_id,
    jsonb_build_object(
      'appointment_id', appointment_record.id,
      'movement_id', movement_record.id,
      'product_id', product_record.id,
      'location_id', location_record.id,
      'quantity', abs(p_quantity),
      'unit_cost', product_record.unit_cost,
      'currency', upper(workspace_currency),
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_appointment_product_consumption(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_movement_id uuid,
  p_idempotency_key text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  original_record public.inventory_movements;
  reversal_record public.inventory_movements;
  appointment_record public.bookings;
  product_record public.products;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment consumption reversal idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Appointment consumption reversal reason is required';
  end if;

  select receipt.result into previous_result
  from public.inventory_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'inventory',
    'edit'
  ) then
    raise exception 'Appointment consumption reversal access denied';
  end if;

  select * into original_record
  from public.inventory_movements movement
  where movement.workspace_id = p_workspace_id
    and movement.id = p_movement_id
  for update;
  if original_record.id is null then raise exception 'Appointment consumption movement not found'; end if;
  if original_record.appointment_id is null
     or original_record.movement_type <> 'internal_consumption'
     or original_record.source_type <> 'appointment_consumption' then
    raise exception 'Inventory movement is not Appointment Product consumption';
  end if;
  if exists (
    select 1
    from public.inventory_movements movement
    where movement.workspace_id = p_workspace_id
      and movement.reversal_of_id = original_record.id
  ) then
    raise exception 'Appointment Product consumption has already been reversed';
  end if;

  select * into appointment_record
  from public.bookings appointment
  where appointment.workspace_id = p_workspace_id
    and appointment.id = original_record.appointment_id;
  select * into product_record
  from public.products product
  where product.workspace_id = p_workspace_id
    and product.id = original_record.product_id;

  insert into public.inventory_movements (
    id,
    workspace_id,
    product_id,
    location_id,
    appointment_id,
    movement_type,
    quantity_delta,
    unit_cost,
    currency,
    source_type,
    source_id,
    reversal_of_id,
    idempotency_key,
    command_id,
    actor_user_id,
    note,
    metadata,
    occurred_at
  ) values (
    p_reversal_id,
    p_workspace_id,
    original_record.product_id,
    original_record.location_id,
    original_record.appointment_id,
    'reversal',
    -original_record.quantity_delta,
    original_record.unit_cost,
    original_record.currency,
    'appointment_consumption',
    original_record.appointment_id::text,
    original_record.id,
    trim(p_idempotency_key),
    p_command_id,
    p_actor_user_id,
    trim(p_reason),
    coalesce(original_record.metadata, '{}'::jsonb) || jsonb_build_object(
      'reversal_reason', trim(p_reason),
      'original_movement_id', original_record.id
    ),
    coalesce(p_occurred_at, now())
  ) returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_appointment_consumption',
    'movement', to_jsonb(reversal_record),
    'originalMovementId', original_record.id
  );

  insert into public.inventory_command_receipts (
    workspace_id,
    idempotency_key,
    action,
    entity_type,
    entity_id,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    'reverse_appointment_consumption',
    'inventory_movement',
    reversal_record.id,
    command_result
  );

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    entity_type,
    entity_id,
    command_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Appointment Product consumption reversed',
    coalesce(appointment_record.reference, original_record.appointment_id::text) || ' · ' || coalesce(product_record.name, 'Product') || ' · ' || trim(p_reason),
    'blue',
    'appointment',
    original_record.appointment_id::text,
    p_command_id,
    jsonb_build_object(
      'appointment_id', original_record.appointment_id,
      'original_movement_id', original_record.id,
      'reversal_movement_id', reversal_record.id,
      'product_id', original_record.product_id,
      'location_id', original_record.location_id,
      'quantity', abs(original_record.quantity_delta),
      'reason', trim(p_reason),
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.enforce_appointment_inventory_movement() from public;
revoke all on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) to service_role;
grant execute on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) to service_role;

comment on column public.inventory_movements.appointment_id is
  'Canonical Appointment link for explicit internal Product consumption and its reversal.';
comment on function public.post_appointment_product_consumption(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamptz,text) is
  'Posts explicit supply-Product consumption for one completed Appointment without creating a Sale or implying resale.';
comment on function public.reverse_appointment_product_consumption(uuid,uuid,uuid,text,uuid,uuid,text,timestamptz) is
  'Reverses one immutable Appointment Product consumption movement while preserving the Appointment link.';

commit;