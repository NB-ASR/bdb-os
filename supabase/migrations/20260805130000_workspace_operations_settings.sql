begin;

create table if not exists public.workspace_operational_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  default_export_format text not null default 'csv'
    check (default_export_format in ('csv', 'json')),
  archived_records_default text not null default 'hide'
    check (archived_records_default in ('hide', 'show')),
  appointment_reminders_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_operational_settings_updated_by_idx
  on public.workspace_operational_settings(updated_by);

alter table public.workspace_operational_settings enable row level security;

drop policy if exists "Members view workspace operational settings"
  on public.workspace_operational_settings;
create policy "Members view workspace operational settings"
  on public.workspace_operational_settings
  for select
  to authenticated
  using (private.can_read_workspace(workspace_id));

grant select on public.workspace_operational_settings to authenticated;
revoke insert, update, delete, truncate on public.workspace_operational_settings from authenticated;
grant all on public.workspace_operational_settings to service_role;

insert into public.workspace_operational_settings (workspace_id)
select workspace.id
from public.workspaces workspace
on conflict (workspace_id) do nothing;

alter table public.workspace_recovery_receipts
  drop constraint if exists workspace_recovery_receipts_action_check;
alter table public.workspace_recovery_receipts
  add constraint workspace_recovery_receipts_action_check
  check (action in ('update_configuration', 'update_operations', 'set_logo', 'restore_snapshot'));

create or replace function public.update_workspace_operational_settings(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_fiscal_year_start_month integer,
  target_default_export_format text,
  target_archived_records_default text,
  target_appointment_reminders_enabled boolean,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  normalized_export_format text := lower(btrim(coalesce(target_default_export_format, '')));
  normalized_archive_default text := lower(btrim(coalesce(target_archived_records_default, '')));
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace settings management is not permitted';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'update_operations'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with different operational settings input';
    end if;
    return existing_receipt.result;
  end if;

  if target_fiscal_year_start_month is null
    or target_fiscal_year_start_month not between 1 and 12
  then
    raise exception 'Fiscal year start month must be between 1 and 12';
  end if;

  if normalized_export_format not in ('csv', 'json') then
    raise exception 'Default export format must be CSV or JSON';
  end if;

  if normalized_archive_default not in ('hide', 'show') then
    raise exception 'Archived record visibility must be hide or show';
  end if;

  insert into public.workspace_operational_settings (
    workspace_id,
    fiscal_year_start_month,
    default_export_format,
    archived_records_default,
    appointment_reminders_enabled,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    target_fiscal_year_start_month,
    normalized_export_format,
    normalized_archive_default,
    coalesce(target_appointment_reminders_enabled, true),
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    fiscal_year_start_month = excluded.fiscal_year_start_month,
    default_export_format = excluded.default_export_format,
    archived_records_default = excluded.archived_records_default,
    appointment_reminders_enabled = excluded.appointment_reminders_enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Operational settings updated',
    'Reporting, archive and reminder preferences',
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object(
      'fiscal_year_start_month', target_fiscal_year_start_month,
      'default_export_format', normalized_export_format,
      'archived_records_default', normalized_archive_default,
      'appointment_reminders_enabled', coalesce(target_appointment_reminders_enabled, true)
    )
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.operational_settings_updated',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('command_id', target_command_id),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'fiscalYearStartMonth', target_fiscal_year_start_month,
    'defaultExportFormat', normalized_export_format,
    'archivedRecordsDefault', normalized_archive_default,
    'appointmentRemindersEnabled', coalesce(target_appointment_reminders_enabled, true),
    'updatedAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'update_operations',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

revoke all on function public.update_workspace_operational_settings(
  uuid, uuid, text, text, integer, text, text, boolean, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_workspace_operational_settings(
  uuid, uuid, text, text, integer, text, text, boolean, uuid, timestamptz
) to service_role;

create or replace function private.workspace_restorable_tables()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'workspace_settings',
    'workspace_themes',
    'workspace_operational_settings',
    'customers',
    'products',
    'suppliers',
    'services',
    'inventory_locations',
    'calendar_rooms',
    'bank_accounts',
    'automations',
    'product_suppliers',
    'calendar_staff_working_hours',
    'calendar_staff_breaks',
    'calendar_staff_leave',
    'calendar_staff_service_eligibility',
    'communication_threads',
    'messages',
    'bookings',
    'sales',
    'sale_lines',
    'sale_drafts',
    'invoices',
    'invoice_lines',
    'payments',
    'supplier_documents',
    'supplier_document_lines',
    'supplier_document_extraction_runs',
    'supplier_payables',
    'supplier_payments',
    'inventory_movements',
    'payment_allocations',
    'supplier_payment_allocations',
    'supplier_credit_allocations',
    'bank_statement_imports',
    'bank_transactions',
    'bank_reconciliation_allocations',
    'customer_notes',
    'documents',
    'document_links'
  ]::text[];
$function$;

create or replace function private.workspace_restorable_record_count(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_table text;
  total_count bigint := 0;
  table_count bigint;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'view'
  ) then
    return 0;
  end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    if target_table in (
      'workspace_settings',
      'workspace_themes',
      'workspace_operational_settings'
    ) then
      continue;
    end if;
    execute format(
      'select count(*) from public.%I where workspace_id = $1',
      target_table
    )
    into table_count
    using target_workspace_id;
    total_count := total_count + table_count;
  end loop;

  return total_count;
end;
$function$;

create or replace function public.due_appointment_reminders()
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  workspace_id uuid,
  user_id uuid,
  booking_id uuid,
  title text,
  starts_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    booking.workspace_id,
    subscription.user_id,
    booking.id,
    booking.title,
    (booking.booking_date + booking.booking_time)
      at time zone coalesce(settings.timezone, 'Europe/London')
  from public.bookings booking
  join public.workspace_settings settings
    on settings.workspace_id = booking.workspace_id
  left join public.workspace_operational_settings operations
    on operations.workspace_id = booking.workspace_id
  join public.push_subscriptions subscription
    on subscription.workspace_id = booking.workspace_id
  join public.workspace_memberships membership
    on membership.workspace_id = booking.workspace_id
    and membership.user_id = subscription.user_id
    and membership.status = 'active'
  where booking.status in ('confirmed', 'pending')
    and coalesce(operations.appointment_reminders_enabled, true)
    and (booking.booking_date + booking.booking_time)
      at time zone coalesce(settings.timezone, 'Europe/London')
      between now() + interval '55 minutes' and now() + interval '65 minutes'
    and not exists (
      select 1
      from public.notification_deliveries delivery
      where delivery.user_id = subscription.user_id
        and delivery.booking_id = booking.id
        and delivery.notification_type = 'appointment_reminder'
    );
$function$;

revoke all on function public.due_appointment_reminders()
  from public, anon, authenticated;
grant execute on function public.due_appointment_reminders()
  to service_role;

commit;
