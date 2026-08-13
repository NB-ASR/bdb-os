begin;

create table if not exists public.workspace_recovery_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  action text not null check (action in ('update_configuration', 'set_logo', 'restore_snapshot')),
  request_hash text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.workspace_recovery_receipts enable row level security;
revoke all on public.workspace_recovery_receipts from anon, authenticated;
grant all on public.workspace_recovery_receipts to service_role;

create or replace function private.actor_has_workspace_admin_access(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_level text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
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
  )
  select case
    when not exists (select 1 from membership) then false
    when target_level = 'view' then true
    when target_level = 'manage'
      then (select access_profile from membership) in ('owner', 'manager')
    when target_level = 'recover'
      then (select access_profile from membership) = 'owner'
    else false
  end;
$function$;

create or replace function private.workspace_restorable_tables()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'workspace_settings',
    'workspace_themes',
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
    if target_table in ('workspace_settings', 'workspace_themes') then
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

create or replace function public.get_workspace_settings_access(
  target_workspace_id uuid
)
returns table (
  can_view boolean,
  can_manage boolean,
  can_recover boolean,
  support_read_only boolean,
  restorable_record_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'view'
    ),
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'manage'
    ),
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'recover'
    ),
    false,
    private.workspace_restorable_record_count(
      target_workspace_id,
      (select auth.uid())
    );
$function$;

revoke all on function public.get_workspace_settings_access(uuid) from public, anon;
grant execute on function public.get_workspace_settings_access(uuid) to authenticated;

revoke insert, update, delete, truncate on public.workspace_settings from authenticated;
revoke insert, update, delete, truncate on public.workspace_themes from authenticated;
revoke update, delete, truncate on public.workspaces from authenticated;

drop policy if exists "Managers can update settings" on public.workspace_settings;
drop policy if exists "Managers can create themes" on public.workspace_themes;
drop policy if exists "Managers can update themes" on public.workspace_themes;
drop policy if exists "Managers can update workspaces" on public.workspaces;
drop policy if exists "Managers can upload workspace assets" on storage.objects;
drop policy if exists "Managers can update workspace assets" on storage.objects;
drop policy if exists "Managers can delete workspace assets" on storage.objects;

commit;
