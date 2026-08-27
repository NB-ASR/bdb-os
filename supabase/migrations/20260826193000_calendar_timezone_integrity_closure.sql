-- Calendar V1 closure: reject invalid timezone snapshots and nonexistent local
-- times (for example Europe/London 01:30 during the spring DST transition).
-- Appointments remain stored as workspace-local date/time plus a timezone
-- snapshot; this guard prevents PostgreSQL from silently normalising a local
-- wall-clock time that never occurred.

begin;

create or replace function private.calendar_local_time_exists(
  target_date date,
  target_time time,
  target_timezone text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  local_value timestamp;
  round_trip timestamp;
begin
  if target_date is null
    or target_time is null
    or target_timezone is null
    or trim(target_timezone) = '' then
    return false;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone
    where timezone.name = trim(target_timezone)
  ) then
    return false;
  end if;

  local_value := target_date + target_time;
  round_trip := (local_value at time zone trim(target_timezone))
    at time zone trim(target_timezone);
  return round_trip = local_value;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

revoke all on function private.calendar_local_time_exists(date, time, text)
  from public, anon, authenticated;

create or replace function private.validate_booking_local_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.calendar_local_time_exists(
    new.booking_date,
    new.booking_time,
    new.timezone
  ) then
    raise exception
      'Appointment local time does not exist in the configured workspace timezone';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_booking_local_time()
  from public, anon, authenticated;

drop trigger if exists bookings_validate_local_time on public.bookings;
create trigger bookings_validate_local_time
before insert or update of booking_date, booking_time, timezone
on public.bookings
for each row execute function private.validate_booking_local_time();

comment on function private.calendar_local_time_exists(date, time, text) is
  'Validates a workspace-local Calendar wall-clock value by timezone round trip, rejecting DST gaps.';

commit;
