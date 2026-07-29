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
    timezone = coalesce(settings.timezone, 'Europe/London')
from public.customers customer
left join public.workspace_settings settings on settings.workspace_id = booking.workspace_id
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
create index bookings_created_by_idx on public.bookings(created_by) where created_by is not null;
create index bookings_updated_by_idx on public.bookings(updated_by) where updated_by is not null;

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
  if previous_result is not null then return previous_result; end if;

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
    where workspace_id = p_workspace_id and id = p_booking_id
    for update;
    if current_record.id is null then raise exception 'Appointment not found'; end if;
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
    where workspace_id = p_workspace_id and id = p_customer_id;
    if customer_record.id is null then raise exception 'Appointment Customer not found'; end if;
    if customer_record.status <> 'active'
      and (p_action = 'create' or p_customer_id is distinct from current_record.customer_id) then
      raise exception 'Archived Customers cannot receive new Appointments';
    end if;

    select * into service_record
    from public.services
    where workspace_id = p_workspace_id and id = p_service_id;
    if service_record.id is null then raise exception 'Appointment Service not found'; end if;
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
    if staff_name_value is null then raise exception 'Appointment staff member is not active in this workspace'; end if;

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
    where workspace_id = p_workspace_id and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment rescheduled';
    activity_tone := 'blue';
  elsif p_action = 'confirm' then
    if current_record.status::text <> 'pending' then
      raise exception 'Only pending Appointments can be confirmed';
    end if;
    update public.bookings
    set status = 'confirmed', updated_by = p_actor_user_id, version = version + 1
    where workspace_id = p_workspace_id and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment confirmed';
    activity_tone := 'green';
  elsif p_action = 'cancel' then
    if current_record.status::text not in ('pending', 'confirmed') then
      raise exception 'Only pending or confirmed Appointments can be cancelled';
    end if;
    if p_cancellation_reason is null or char_length(trim(p_cancellation_reason)) < 2 or char_length(trim(p_cancellation_reason)) > 500 then
      raise exception 'Appointment cancellation reason is required';
    end if;
    update public.bookings
    set status = 'cancelled',
        cancellation_reason = trim(p_cancellation_reason),
        cancelled_at = now(),
        updated_by = p_actor_user_id,
        version = version + 1
    where workspace_id = p_workspace_id and id = p_booking_id
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
    where workspace_id = p_workspace_id and id = p_booking_id
    returning * into booking_record;
    activity_action := 'Appointment completed';
    activity_tone := 'green';
  end if;

  command_result := jsonb_build_object('action', p_action, 'appointment', to_jsonb(booking_record));

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
