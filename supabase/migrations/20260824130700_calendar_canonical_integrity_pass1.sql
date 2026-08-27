begin;

-- Calendar Engine V1 Pass 1 — Canonical Integrity & Command Hardening.
-- Keep the existing Appointment / availability / eligibility business rules intact,
-- but put one hardened runtime command boundary in front of each legacy function.
-- The wrappers authorize before replay, bind every idempotency key to one actor and
-- canonical request payload, and preserve richer Appointment reschedule history.

create table public.calendar_command_claims (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  command_domain text not null check (
    command_domain in (
      'appointment',
      'availability',
      'service_eligibility',
      'legacy_appointment',
      'legacy_availability',
      'legacy_service_eligibility'
    )
  ),
  actor_user_id uuid,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.calendar_command_claims enable row level security;
revoke all on table public.calendar_command_claims from public, anon, authenticated, service_role;

comment on table public.calendar_command_claims is
  'Internal Calendar command claim ledger. One workspace-scoped idempotency key is bound to one Calendar command domain, actor and canonical request hash.';

-- Old receipts predate request hashing. If an old key exists in more than one
-- Calendar receipt ledger we refuse to guess which command owned it.
do $migration$
begin
  if exists (
    select 1
    from (
      select workspace_id, idempotency_key, 'appointment'::text as domain
      from public.appointment_command_receipts
      union all
      select workspace_id, idempotency_key, 'availability'::text
      from public.calendar_availability_command_receipts
      union all
      select workspace_id, idempotency_key, 'service_eligibility'::text
      from public.calendar_service_eligibility_command_receipts
    ) receipt
    group by workspace_id, idempotency_key
    having count(distinct domain) > 1
  ) then
    raise exception 'Existing Calendar idempotency collision blocks Pass 1';
  end if;
end;
$migration$;

insert into public.calendar_command_claims (
  workspace_id, idempotency_key, command_domain, actor_user_id, request_hash, created_at
)
select receipt.workspace_id,
       receipt.idempotency_key,
       'legacy_appointment',
       null,
       encode(extensions.digest(convert_to(receipt.result::text, 'UTF8'), 'sha256'), 'hex'),
       receipt.created_at
from public.appointment_command_receipts receipt
on conflict (workspace_id, idempotency_key) do nothing;

insert into public.calendar_command_claims (
  workspace_id, idempotency_key, command_domain, actor_user_id, request_hash, created_at
)
select receipt.workspace_id,
       receipt.idempotency_key,
       'legacy_availability',
       null,
       encode(extensions.digest(convert_to(receipt.result::text, 'UTF8'), 'sha256'), 'hex'),
       receipt.created_at
from public.calendar_availability_command_receipts receipt
on conflict (workspace_id, idempotency_key) do nothing;

insert into public.calendar_command_claims (
  workspace_id, idempotency_key, command_domain, actor_user_id, request_hash, created_at
)
select receipt.workspace_id,
       receipt.idempotency_key,
       'legacy_service_eligibility',
       null,
       encode(extensions.digest(convert_to(receipt.result::text, 'UTF8'), 'sha256'), 'hex'),
       receipt.created_at
from public.calendar_service_eligibility_command_receipts receipt
on conflict (workspace_id, idempotency_key) do nothing;

create or replace function private.claim_calendar_command(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_command_domain text,
  p_actor_user_id uuid,
  p_request jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_key text := trim(coalesce(p_idempotency_key, ''));
  calculated_hash text;
  existing_domain text;
  existing_actor uuid;
  existing_hash text;
begin
  if char_length(normalized_key) not between 1 and 128 then
    raise exception 'Calendar idempotency key is invalid';
  end if;
  if p_command_domain not in ('appointment', 'availability', 'service_eligibility') then
    raise exception 'Calendar command domain is invalid';
  end if;
  if p_actor_user_id is null then
    raise exception 'Calendar command actor is invalid';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Calendar command claim payload is invalid';
  end if;

  calculated_hash := encode(
    extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.calendar_command_claims (
    workspace_id, idempotency_key, command_domain, actor_user_id, request_hash
  ) values (
    p_workspace_id, normalized_key, p_command_domain, p_actor_user_id, calculated_hash
  )
  on conflict (workspace_id, idempotency_key) do nothing;

  select claim.command_domain, claim.actor_user_id, claim.request_hash
    into existing_domain, existing_actor, existing_hash
    from public.calendar_command_claims claim
   where claim.workspace_id = p_workspace_id
     and claim.idempotency_key = normalized_key;

  if existing_domain is distinct from p_command_domain
     or existing_actor is distinct from p_actor_user_id
     or existing_hash is distinct from calculated_hash then
    raise exception 'Calendar idempotency key was reused with different input';
  end if;

  return calculated_hash;
end;
$function$;

revoke all on function private.claim_calendar_command(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

-- Preserve the already-tested business-rule implementations under explicit legacy
-- names. Runtime service traffic is switched to the hardened wrappers below.
alter function public.apply_appointment_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid,
  date, time, text, text, text, text, text
) rename to apply_appointment_command_legacy;

alter function public.apply_calendar_availability_command(
  uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint,
  time, time, timestamp, timestamp, text, text, text, text, boolean
) rename to apply_calendar_availability_command_legacy;

alter function public.apply_calendar_service_eligibility_command(
  uuid, uuid, uuid, boolean, text, uuid, uuid, integer
) rename to apply_calendar_service_eligibility_command_legacy;

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
as $function$
declare
  permission_action text;
  claim_payload jsonb;
  previous_result jsonb;
  command_result jsonb;
  before_booking public.bookings;
  after_booking public.bookings;
begin
  if p_action not in ('create', 'update', 'confirm', 'cancel', 'complete') then
    raise exception 'Unsupported Appointment action';
  end if;

  -- Authorization deliberately precedes replay/claim lookup so knowledge of an
  -- old idempotency key cannot expose another actor's Appointment result.
  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.appointment_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Appointment write access denied';
  end if;

  claim_payload := jsonb_build_object(
    'bookingId', p_booking_id,
    'action', p_action,
    'expectedVersion', p_expected_version,
    'customerId', p_customer_id,
    'serviceId', p_service_id,
    'staffUserId', p_staff_user_id,
    'bookingDate', p_booking_date,
    'bookingTime', p_booking_time,
    'channel', nullif(trim(coalesce(p_channel, '')), ''),
    'roomName', nullif(trim(coalesce(p_room_name, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'initialStatus', nullif(trim(coalesce(p_initial_status, '')), ''),
    'cancellationReason', nullif(trim(coalesce(p_cancellation_reason, '')), '')
  );

  perform private.claim_calendar_command(
    p_workspace_id,
    p_idempotency_key,
    'appointment',
    p_actor_user_id,
    claim_payload
  );

  select receipt.result into previous_result
  from public.appointment_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if p_action = 'update' then
    select * into before_booking
    from public.bookings booking
    where booking.workspace_id = p_workspace_id
      and booking.id = p_booking_id
    for update;
  end if;

  command_result := public.apply_appointment_command_legacy(
    p_workspace_id,
    p_booking_id,
    p_action,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_expected_version,
    p_customer_id,
    p_service_id,
    p_staff_user_id,
    p_booking_date,
    p_booking_time,
    p_channel,
    p_room_name,
    p_notes,
    p_initial_status,
    p_cancellation_reason
  );

  if p_action = 'update' and before_booking.id is not null then
    select * into after_booking
    from public.bookings booking
    where booking.workspace_id = p_workspace_id
      and booking.id = p_booking_id;

    update public.activity_items activity
    set metadata = coalesce(activity.metadata, '{}'::jsonb) || jsonb_build_object(
      'schedule_before', jsonb_build_object(
        'customer_id', before_booking.customer_id,
        'service_id', before_booking.service_id,
        'staff_user_id', before_booking.staff_user_id,
        'booking_date', before_booking.booking_date,
        'booking_time', before_booking.booking_time,
        'room_id', before_booking.room_id,
        'room_name', before_booking.room_name,
        'status', before_booking.status,
        'version', before_booking.version
      ),
      'schedule_after', jsonb_build_object(
        'customer_id', after_booking.customer_id,
        'service_id', after_booking.service_id,
        'staff_user_id', after_booking.staff_user_id,
        'booking_date', after_booking.booking_date,
        'booking_time', after_booking.booking_time,
        'room_id', after_booking.room_id,
        'room_name', after_booking.room_name,
        'status', after_booking.status,
        'version', after_booking.version
      )
    )
    where activity.workspace_id = p_workspace_id
      and activity.entity_type = 'appointment'
      and activity.entity_id = p_booking_id::text
      and activity.command_id is not distinct from p_command_id;
  end if;

  return command_result;
end;
$function$;

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
as $function$
declare
  claim_payload jsonb;
  previous_result jsonb;
begin
  if not private.calendar_availability_actor_can_manage(p_workspace_id, p_actor_user_id) then
    raise exception 'Calendar availability management access denied';
  end if;

  claim_payload := jsonb_build_object(
    'entityType', nullif(trim(coalesce(p_entity_type, '')), ''),
    'action', nullif(trim(coalesce(p_action, '')), ''),
    'entityId', p_entity_id,
    'expectedVersion', p_expected_version,
    'staffUserId', p_staff_user_id,
    'weekday', p_weekday,
    'startTime', p_start_time,
    'endTime', p_end_time,
    'startsAt', p_starts_at,
    'endsAt', p_ends_at,
    'code', nullif(trim(coalesce(p_code, '')), ''),
    'name', nullif(trim(coalesce(p_name, '')), ''),
    'description', nullif(trim(coalesce(p_description, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'isWorking', p_is_working
  );

  perform private.claim_calendar_command(
    p_workspace_id,
    p_idempotency_key,
    'availability',
    p_actor_user_id,
    claim_payload
  );

  select receipt.result into previous_result
  from public.calendar_availability_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  return public.apply_calendar_availability_command_legacy(
    p_workspace_id,
    p_entity_type,
    p_action,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_entity_id,
    p_expected_version,
    p_staff_user_id,
    p_weekday,
    p_start_time,
    p_end_time,
    p_starts_at,
    p_ends_at,
    p_code,
    p_name,
    p_description,
    p_reason,
    p_is_working
  );
end;
$function$;

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
as $function$
declare
  claim_payload jsonb;
  previous_result jsonb;
begin
  if not private.calendar_service_eligibility_actor_can_manage(p_workspace_id, p_actor_user_id) then
    raise exception 'Calendar Service eligibility management access denied';
  end if;

  claim_payload := jsonb_build_object(
    'staffUserId', p_staff_user_id,
    'serviceId', p_service_id,
    'isEligible', p_is_eligible,
    'expectedVersion', p_expected_version
  );

  perform private.claim_calendar_command(
    p_workspace_id,
    p_idempotency_key,
    'service_eligibility',
    p_actor_user_id,
    claim_payload
  );

  select receipt.result into previous_result
  from public.calendar_service_eligibility_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  return public.apply_calendar_service_eligibility_command_legacy(
    p_workspace_id,
    p_staff_user_id,
    p_service_id,
    p_is_eligible,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_expected_version
  );
end;
$function$;

-- The renamed functions remain for schema history and wrapper delegation only.
-- Runtime service traffic may execute only the hardened public names.
revoke all on function public.apply_appointment_command_legacy(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid,
  date, time, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.apply_calendar_availability_command_legacy(
  uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint,
  time, time, timestamp, timestamp, text, text, text, text, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.apply_calendar_service_eligibility_command_legacy(
  uuid, uuid, uuid, boolean, text, uuid, uuid, integer
) from public, anon, authenticated, service_role;

revoke all on function public.apply_appointment_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid,
  date, time, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_appointment_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid,
  date, time, text, text, text, text, text
) to service_role;

revoke all on function public.apply_calendar_availability_command(
  uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint,
  time, time, timestamp, timestamp, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.apply_calendar_availability_command(
  uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint,
  time, time, timestamp, timestamp, text, text, text, text, boolean
) to service_role;

revoke all on function public.apply_calendar_service_eligibility_command(
  uuid, uuid, uuid, boolean, text, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.apply_calendar_service_eligibility_command(
  uuid, uuid, uuid, boolean, text, uuid, uuid, integer
) to service_role;

comment on function public.apply_appointment_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, uuid,
  date, time, text, text, text, text, text
) is 'Canonical Calendar V1 Appointment command. Authorizes before replay and binds every idempotency key to one actor/request.';

comment on function public.apply_calendar_availability_command(
  uuid, text, text, text, uuid, uuid, uuid, integer, uuid, smallint,
  time, time, timestamp, timestamp, text, text, text, text, boolean
) is 'Canonical Calendar V1 availability command. Authorizes before replay and binds every idempotency key to one actor/request.';

comment on function public.apply_calendar_service_eligibility_command(
  uuid, uuid, uuid, boolean, text, uuid, uuid, integer
) is 'Canonical Calendar V1 staff-to-Service eligibility command. Authorizes before replay and binds every idempotency key to one actor/request.';

commit;

