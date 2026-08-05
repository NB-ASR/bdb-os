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
