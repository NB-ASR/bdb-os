begin;

alter table public.workspace_memberships
  add column if not exists invitation_delivery_status text,
  add column if not exists invitation_delivery_attempted_at timestamptz,
  add column if not exists invitation_delivery_error_code text;

update public.workspace_memberships
set
  invitation_delivery_status = case
    when status = 'invited' and invitation_last_sent_at is not null then 'sent'
    when status = 'invited' then 'pending'
    else invitation_delivery_status
  end,
  invitation_delivery_attempted_at = coalesce(
    invitation_delivery_attempted_at,
    invitation_last_sent_at
  )
where invitation_delivery_status is null;

alter table public.workspace_memberships
  drop constraint if exists workspace_memberships_invitation_delivery_status_check;

alter table public.workspace_memberships
  add constraint workspace_memberships_invitation_delivery_status_check
  check (
    invitation_delivery_status is null
    or invitation_delivery_status in ('pending', 'sent', 'failed')
  );

comment on column public.workspace_memberships.invitation_delivery_status is
  'Founder-facing delivery outcome for the latest invitation email attempt. Membership acceptance remains governed by status and invitation_expires_at.';
comment on column public.workspace_memberships.invitation_delivery_attempted_at is
  'Timestamp of the latest invitation email attempt, whether sent or failed.';
comment on column public.workspace_memberships.invitation_delivery_error_code is
  'Sanitised product error code for a failed invitation email attempt; never stores provider credentials or raw SMTP responses.';

create or replace function private.enforce_invitation_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_at timestamptz;
  maximum_expiry timestamptz;
begin
  if new.status <> 'invited' then
    return new;
  end if;

  if new.invitation_delivery_status is distinct from 'sent' then
    return new;
  end if;

  sent_at := coalesce(
    new.invitation_last_sent_at,
    new.invitation_delivery_attempted_at,
    now()
  );
  maximum_expiry := sent_at + interval '1 hour';

  new.invitation_last_sent_at := sent_at;
  new.invitation_delivery_attempted_at := coalesce(
    new.invitation_delivery_attempted_at,
    sent_at
  );
  if new.invitation_expires_at is null or new.invitation_expires_at > maximum_expiry then
    new.invitation_expires_at := maximum_expiry;
  end if;

  if new.invitation_expires_at <= sent_at then
    raise exception 'Invitation expiry must be after the invitation was sent';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_invitation_expiry() from public;

drop trigger if exists workspace_memberships_enforce_invitation_expiry
  on public.workspace_memberships;
create trigger workspace_memberships_enforce_invitation_expiry
before insert or update of
  status,
  invitation_delivery_status,
  invitation_delivery_attempted_at,
  invitation_last_sent_at,
  invitation_expires_at
on public.workspace_memberships
for each row execute function private.enforce_invitation_expiry();

create or replace function public.founder_workspace_deletion_preview(
  target_workspace_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  relation_record record;
  relation_count bigint;
  record_counts jsonb := '{}'::jsonb;
  total_records bigint := 0;
  protected_financial_records bigint := 0;
  protected_financial_tables constant text[] := array[
    'bank_accounts',
    'bank_reconciliation_allocations',
    'bank_statement_imports',
    'bank_transactions',
    'credit_note_lines',
    'credit_notes',
    'delivery_note_lines',
    'delivery_notes',
    'invoice_lines',
    'invoices',
    'payment_allocations',
    'payments',
    'sale_lines',
    'sales',
    'supplier_credit_allocations',
    'supplier_documents',
    'supplier_payables',
    'supplier_payment_allocations',
    'supplier_payments'
  ];
  baseline_tables constant text[] := array[
    'audit_logs',
    'business_group_workspaces',
    'operator_policies',
    'workspace_access_profile_permissions',
    'workspace_feature_overrides',
    'workspace_member_permissions',
    'workspace_memberships',
    'workspace_operational_settings',
    'workspace_recovery_receipts',
    'workspace_sector_configs',
    'workspace_settings',
    'workspace_themes',
    'workspace_usage_baselines',
    'workspace_usage_events',
    'workspace_usage_periods'
  ];
begin
  if target_workspace_id is null then
    raise exception 'Workspace is required';
  end if;

  for relation_record in
    select columns.table_name
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
    where columns.table_schema = 'public'
      and columns.column_name = 'workspace_id'
      and tables.table_type = 'BASE TABLE'
      and not (columns.table_name = any (baseline_tables))
    order by columns.table_name
  loop
    execute format(
      'select count(*) from public.%I where workspace_id = $1',
      relation_record.table_name
    )
    into relation_count
    using target_workspace_id;

    if relation_count > 0 then
      record_counts := record_counts || jsonb_build_object(
        relation_record.table_name,
        relation_count
      );
      total_records := total_records + relation_count;
      if relation_record.table_name = any (protected_financial_tables) then
        protected_financial_records := protected_financial_records + relation_count;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'workspace_id', target_workspace_id,
    'record_counts', record_counts,
    'total_records', total_records,
    'protected_financial_records', protected_financial_records,
    'can_delete', total_records = 0
  );
end;
$$;

revoke all on function public.founder_workspace_deletion_preview(uuid) from public, anon, authenticated;
grant execute on function public.founder_workspace_deletion_preview(uuid) to service_role;

comment on function public.founder_workspace_deletion_preview(uuid) is
  'Returns service-role-only operational record counts used by Founder Admin before permanent workspace deletion. Provisioning/configuration rows are deliberately excluded.';

create or replace function public.founder_delete_empty_workspace(
  target_workspace_id uuid,
  target_expected_name text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  workspace_record public.workspaces%rowtype;
  preview jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins platform_admin
    where platform_admin.user_id = target_actor_user_id
      and platform_admin.active
  ) then
    raise exception 'Active platform administrator required';
  end if;

  select *
  into workspace_record
  from public.workspaces workspace
  where workspace.id = target_workspace_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  if workspace_record.name <> trim(coalesce(target_expected_name, '')) then
    return jsonb_build_object('ok', false, 'code', 'CONFIRMATION_MISMATCH');
  end if;

  preview := public.founder_workspace_deletion_preview(target_workspace_id);

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_workspace_id,
    target_actor_user_id,
    case
      when coalesce((preview->>'can_delete')::boolean, false)
        then 'workspace.permanently_deleted'
      else 'workspace.permanent_deletion_blocked'
    end,
    'workspace',
    target_workspace_id::text,
    jsonb_build_object(
      'previous', jsonb_build_object(
        'id', workspace_record.id,
        'name', workspace_record.name,
        'legal_name', workspace_record.legal_name,
        'slug', workspace_record.slug,
        'status', workspace_record.status,
        'plan_id', workspace_record.plan_id
      ),
      'new', null,
      'deletion_preview', preview,
      'requested_at', now()
    )
  );

  if not coalesce((preview->>'can_delete')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DELETION_BLOCKED',
      'preview', preview
    );
  end if;

  delete from public.workspaces
  where id = target_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'workspace_id', target_workspace_id,
    'deleted_name', workspace_record.name,
    'preview', preview
  );
end;
$$;

revoke all on function public.founder_delete_empty_workspace(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.founder_delete_empty_workspace(uuid, text, uuid) to service_role;

comment on function public.founder_delete_empty_workspace(uuid, text, uuid) is
  'Atomically rechecks that a typed-name-confirmed workspace has no operational records, audits the decision, and deletes only an empty workspace.';

create or replace function public.founder_unused_auth_user_preview(
  target_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  reference_record record;
  reference_count bigint;
  membership_count bigint;
  platform_admin_count bigint;
  protected_reference_count bigint := 0;
  record_counts jsonb := '{}'::jsonb;
begin
  if target_user_id is null then
    raise exception 'User is required';
  end if;

  select count(*)
  into membership_count
  from public.workspace_memberships membership
  where membership.user_id = target_user_id;

  select count(*)
  into platform_admin_count
  from public.platform_admins platform_admin
  where platform_admin.user_id = target_user_id;

  for reference_record in
    select distinct
      namespace.nspname as table_schema,
      relation.relname as table_name,
      attribute.attname as column_name
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class relation
      on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral unnest(constraint_record.conkey) as local_key(attribute_number)
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = relation.oid
     and attribute.attnum = local_key.attribute_number
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'auth.users'::regclass
      and namespace.nspname = 'public'
      and relation.relname not in (
        'profiles',
        'workspace_memberships',
        'platform_admins',
        'push_subscriptions',
        'notification_deliveries'
      )
    order by relation.relname, attribute.attname
  loop
    execute format(
      'select count(*) from %I.%I where %I = $1',
      reference_record.table_schema,
      reference_record.table_name,
      reference_record.column_name
    )
    into reference_count
    using target_user_id;

    if reference_count > 0 then
      record_counts := record_counts || jsonb_build_object(
        reference_record.table_name || '.' || reference_record.column_name,
        reference_count
      );
      protected_reference_count := protected_reference_count + reference_count;
    end if;
  end loop;

  return jsonb_build_object(
    'user_id', target_user_id,
    'membership_count', membership_count,
    'platform_admin_count', platform_admin_count,
    'protected_reference_count', protected_reference_count,
    'record_counts', record_counts,
    'can_delete', membership_count = 0
      and platform_admin_count = 0
      and protected_reference_count = 0
  );
end;
$$;

revoke all on function public.founder_unused_auth_user_preview(uuid) from public, anon, authenticated;
grant execute on function public.founder_unused_auth_user_preview(uuid) to service_role;

comment on function public.founder_unused_auth_user_preview(uuid) is
  'Service-role-only safety check for deleting an unused Auth identity while preserving business access and historical actor attribution.';

commit;
