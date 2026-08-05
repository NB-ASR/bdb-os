begin;

insert into public.features (key, name, description, category, route, sort_order, is_active)
values (
  'services',
  'Services',
  'Reusable service definitions for Calendar, Sales, customer history and invoice lines.',
  'catalogue',
  '/services',
  47,
  true
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    route = excluded.route,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

create table public.services (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code extensions.citext not null check (char_length(trim(code::text)) between 1 and 64),
  name text not null check (char_length(trim(name)) between 2 and 160),
  category text check (category is null or char_length(category) <= 120),
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  preparation_buffer_minutes integer not null default 0 check (preparation_buffer_minutes between 0 and 240),
  recovery_buffer_minutes integer not null default 0 check (recovery_buffer_minutes between 0 and 240),
  price numeric(14,4) check (price is null or price >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  booking_mode text not null default 'customer' check (booking_mode in ('customer', 'staff')),
  description text check (description is null or char_length(description) <= 2000),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

create index services_workspace_status_name_idx
  on public.services(workspace_id, status, name);
create index services_created_by_idx
  on public.services(created_by)
  where created_by is not null;
create index services_updated_by_idx
  on public.services(updated_by)
  where updated_by is not null;

create table public.service_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  service_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete cascade
);

create index service_command_receipts_service_idx
  on public.service_command_receipts(workspace_id, service_id, created_at desc);

drop trigger if exists services_touch_updated_at on public.services;
create trigger services_touch_updated_at
before update on public.services
for each row execute function private.touch_updated_at();

create or replace function private.service_actor_can_write(
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
  with membership as (
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = 'services'
    limit 1
  )
  select not exists (
      select 1
      from public.platform_support_sessions support_session
      where support_session.admin_user_id = target_actor_user_id
        and support_session.workspace_id = target_workspace_id
        and support_session.ended_at is null
        and support_session.expires_at > now()
    )
    and private.has_feature(target_workspace_id, 'services')
    and case
      when not exists (select 1 from membership) then false
      when (select access_profile from membership) = 'owner' then true
      when exists (select 1 from explicit_permission) then case target_action
        when 'create' then (select can_create from explicit_permission)
        when 'edit' then (select can_edit from explicit_permission)
        else false
      end
      when (select access_profile from membership) in ('manager', 'employee')
        then target_action in ('create', 'edit')
      else false
    end;
$$;

create or replace function public.apply_service_command(
  p_workspace_id uuid,
  p_service_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_category text default null,
  p_duration_minutes integer default null,
  p_preparation_buffer_minutes integer default 0,
  p_recovery_buffer_minutes integer default 0,
  p_price numeric default null,
  p_vat_rate numeric default 0,
  p_booking_mode text default 'customer',
  p_description text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_record public.services;
  previous_result jsonb;
  command_result jsonb;
  permission_action text;
  activity_action text;
  activity_tone text;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported Service action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Service idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.service_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.service_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Service write access denied';
  end if;

  if p_action in ('create', 'update') then
    if p_code is null or char_length(trim(p_code)) not between 1 and 64 then
      raise exception 'Service code is invalid';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 2 and 160 then
      raise exception 'Service name is invalid';
    end if;
    if p_category is not null and char_length(p_category) > 120 then
      raise exception 'Service category is invalid';
    end if;
    if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 1440 then
      raise exception 'Service duration is invalid';
    end if;
    if p_preparation_buffer_minutes is null or p_preparation_buffer_minutes < 0 or p_preparation_buffer_minutes > 240 then
      raise exception 'Service preparation buffer is invalid';
    end if;
    if p_recovery_buffer_minutes is null or p_recovery_buffer_minutes < 0 or p_recovery_buffer_minutes > 240 then
      raise exception 'Service recovery buffer is invalid';
    end if;
    if p_price is not null and p_price < 0 then
      raise exception 'Service price is invalid';
    end if;
    if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
      raise exception 'Service VAT rate is invalid';
    end if;
    if p_booking_mode not in ('customer', 'staff') then
      raise exception 'Service booking mode is invalid';
    end if;
    if p_description is not null and char_length(p_description) > 2000 then
      raise exception 'Service description is too long';
    end if;
    if p_notes is not null and char_length(p_notes) > 2000 then
      raise exception 'Service notes are too long';
    end if;
  end if;

  if p_action = 'create' then
    if exists (select 1 from public.services where id = p_service_id) then
      raise exception 'Service identity conflict';
    end if;
    insert into public.services (
      id, workspace_id, code, name, category, duration_minutes,
      preparation_buffer_minutes, recovery_buffer_minutes, price, vat_rate,
      booking_mode, description, notes, created_by, updated_by
    ) values (
      p_service_id, p_workspace_id, trim(p_code), trim(p_name),
      nullif(trim(p_category), ''), p_duration_minutes,
      p_preparation_buffer_minutes, p_recovery_buffer_minutes, p_price, p_vat_rate,
      p_booking_mode, nullif(trim(p_description), ''), nullif(trim(p_notes), ''),
      p_actor_user_id, p_actor_user_id
    ) returning * into service_record;
    activity_action := 'Service created';
    activity_tone := 'blue';
  else
    select * into service_record
    from public.services
    where workspace_id = p_workspace_id and id = p_service_id
    for update;
    if service_record.id is null then raise exception 'Service not found'; end if;
    if p_expected_version is null or service_record.version <> p_expected_version then
      raise exception 'Service changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      update public.services
      set code = trim(p_code),
          name = trim(p_name),
          category = nullif(trim(p_category), ''),
          duration_minutes = p_duration_minutes,
          preparation_buffer_minutes = p_preparation_buffer_minutes,
          recovery_buffer_minutes = p_recovery_buffer_minutes,
          price = p_price,
          vat_rate = p_vat_rate,
          booking_mode = p_booking_mode,
          description = nullif(trim(p_description), ''),
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service updated';
      activity_tone := 'blue';
    elsif p_action = 'archive' then
      update public.services
      set status = 'archived', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service archived';
      activity_tone := 'gold';
    else
      update public.services
      set status = 'active', updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_service_id
      returning * into service_record;
      activity_action := 'Service restored';
      activity_tone := 'green';
    end if;
  end if;

  command_result := jsonb_build_object('action', p_action, 'service', to_jsonb(service_record));

  insert into public.service_command_receipts (
    workspace_id, idempotency_key, service_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), service_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    service_record.name || ' · ' || service_record.code::text,
    activity_tone, 'service', service_record.id::text, p_command_id,
    jsonb_build_object(
      'service_id', service_record.id,
      'code', service_record.code::text,
      'status', service_record.status,
      'version', service_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function private.service_actor_can_write(uuid, uuid, text) from public;
revoke all on function public.apply_service_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) from public, anon, authenticated;

grant execute on function private.service_actor_can_write(uuid, uuid, text) to service_role;
grant execute on function public.apply_service_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) to service_role;

revoke all on table public.services, public.service_command_receipts from anon, authenticated;
grant select on table public.services to authenticated;

alter table public.services enable row level security;
alter table public.service_command_receipts enable row level security;

create policy "Services permission read"
on public.services for select to authenticated
using (private.has_workspace_permission(workspace_id, 'services', 'view'));

comment on table public.services is
  'Workspace-owned reusable service definitions. Staff availability, appointments, Sales and payments remain separate records.';
comment on column public.services.version is
  'Optimistic concurrency version used to reject stale offline edits.';
comment on table public.service_command_receipts is
  'Service-role-only idempotency receipts for stable retry of Service catalogue commands.';

commit;
