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
