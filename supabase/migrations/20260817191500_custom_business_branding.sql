begin;

-- Custom Business Branding is a commercial workspace entitlement, not a new
-- operational module. It is disabled by default and can be enabled explicitly
-- for an individual client from Founder Admin.
insert into public.features (
  key,
  name,
  description,
  category,
  route,
  sort_order
)
values (
  'custom_branding',
  'Custom Business Branding',
  'Founder-managed client logo shown inside the BDB OS workspace.',
  'personalisation',
  null,
  111
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, 'custom_branding', false
from public.plans plan
on conflict (plan_id, feature_key) do nothing;

-- Existing workspace settings used to allow Owner/Manager logo changes. Keep
-- the trusted function for compatibility, but move authority to an active
-- platform administrator so customer-side calls fail closed.
create or replace function public.set_workspace_logo(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_logo_path text,
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
  previous_logo_path text;
  result_payload jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = target_actor_user_id
      and administrator.active = true
  ) then
    raise exception 'Workspace logo management is controlled by BDB OS Founder Admin';
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
    if existing_receipt.action <> 'set_logo'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different logo';
    end if;
    return existing_receipt.result;
  end if;

  if target_logo_path !~ ('^' || target_workspace_id::text || '/branding/[a-zA-Z0-9._-]+$') then
    raise exception 'Logo path is outside the workspace branding area';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'workspace-assets'
      and name = target_logo_path
  ) then
    raise exception 'Uploaded logo object does not exist';
  end if;

  select client_logo_path
  into previous_logo_path
  from public.workspace_themes
  where workspace_id = target_workspace_id;

  insert into public.workspace_themes (
    workspace_id,
    client_logo_path,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    target_logo_path,
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    client_logo_path = excluded.client_logo_path,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'logoPath', target_logo_path,
    'previousLogoPath', previous_logo_path,
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
    'set_logo',
    target_request_hash,
    result_payload,
    target_occurred_at
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
    'admin.custom_branding.logo_updated',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('command_id', target_command_id, 'logo_path', target_logo_path),
    target_occurred_at
  );

  return result_payload;
end;
$function$;

commit;
