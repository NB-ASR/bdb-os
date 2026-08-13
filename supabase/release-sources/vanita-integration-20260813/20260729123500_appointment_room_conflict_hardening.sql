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
