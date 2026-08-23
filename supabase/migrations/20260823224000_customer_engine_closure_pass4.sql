begin;

-- Customer Engine V1 Pass 4 — closure hardening.
-- This migration hardens Customer lifecycle/import retry identity and concurrent
-- duplicate review without changing Accounts financial rules or Customer V1
-- business concepts.

create table public.customer_command_claims (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  command_type text not null check (command_type in ('lifecycle', 'vanita_import', 'legacy_lifecycle', 'legacy_vanita_import')),
  actor_user_id uuid,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.customer_command_claims enable row level security;
revoke all on table public.customer_command_claims from public, anon, authenticated, service_role;

comment on table public.customer_command_claims is
  'Internal Customer command claim ledger. One workspace-scoped idempotency key is bound to one command type, actor and canonical request hash.';

-- Existing Production receipts predate request hashing. Mark them as legacy so a
-- historical key can never be silently reused with unverifiable new input.
do $migration$
begin
  if exists (
    select 1
    from public.customer_command_receipts receipt
    join public.customer_import_batches batch
      on batch.workspace_id = receipt.workspace_id
     and batch.idempotency_key = receipt.idempotency_key
  ) then
    raise exception 'Existing Customer lifecycle/import idempotency collision blocks Pass 4';
  end if;
end;
$migration$;

insert into public.customer_command_claims (
  workspace_id, idempotency_key, command_type, actor_user_id, request_hash, created_at
)
select receipt.workspace_id,
       receipt.idempotency_key,
       'legacy_lifecycle',
       null,
       encode(extensions.digest(convert_to(receipt.result::text, 'UTF8'), 'sha256'), 'hex'),
       receipt.created_at
from public.customer_command_receipts receipt
on conflict (workspace_id, idempotency_key) do nothing;

insert into public.customer_command_claims (
  workspace_id, idempotency_key, command_type, actor_user_id, request_hash, created_at
)
select batch.workspace_id,
       batch.idempotency_key,
       'legacy_vanita_import',
       batch.created_by,
       encode(extensions.digest(convert_to(coalesce(batch.result, jsonb_build_object('batchId', batch.id))::text, 'UTF8'), 'sha256'), 'hex'),
       batch.created_at
from public.customer_import_batches batch
on conflict (workspace_id, idempotency_key) do nothing;

create or replace function private.claim_customer_command(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_command_type text,
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
  existing_type text;
  existing_actor uuid;
  existing_hash text;
begin
  if char_length(normalized_key) not between 1 and 128 then
    raise exception 'Customer idempotency key is invalid';
  end if;
  if p_command_type not in ('lifecycle', 'vanita_import') then
    raise exception 'Customer command type is invalid';
  end if;
  if p_actor_user_id is null then
    raise exception 'Customer command actor is invalid';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Customer command claim payload is invalid';
  end if;

  calculated_hash := encode(
    extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.customer_command_claims (
    workspace_id, idempotency_key, command_type, actor_user_id, request_hash
  ) values (
    p_workspace_id, normalized_key, p_command_type, p_actor_user_id, calculated_hash
  )
  on conflict (workspace_id, idempotency_key) do nothing;

  select claim.command_type, claim.actor_user_id, claim.request_hash
    into existing_type, existing_actor, existing_hash
    from public.customer_command_claims claim
   where claim.workspace_id = p_workspace_id
     and claim.idempotency_key = normalized_key;

  if existing_type is distinct from p_command_type
     or existing_actor is distinct from p_actor_user_id
     or existing_hash is distinct from calculated_hash then
    raise exception 'Customer idempotency key was reused with different input';
  end if;

  return calculated_hash;
end;
$function$;

revoke all on function private.claim_customer_command(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.execute_customer_command(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_code text default null,
  p_name text default null,
  p_company text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_preferences jsonb default '{}'::jsonb,
  p_allow_duplicate boolean default false,
  p_vat_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  permission_action text;
  claim_payload jsonb;
  normalized_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception 'Unsupported customer action';
  end if;

  -- Authorization deliberately precedes replay/claim lookup so knowledge of an
  -- idempotency key can never expose another actor's prior Customer result.
  permission_action := case when p_action = 'create' then 'create' else 'edit' end;
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then
    raise exception 'Customer write access denied';
  end if;

  claim_payload := jsonb_build_object(
    'customerId', p_customer_id,
    'action', p_action,
    'expectedVersion', p_expected_version,
    'code', nullif(trim(coalesce(p_code, '')), ''),
    'name', nullif(trim(coalesce(p_name, '')), ''),
    'company', nullif(trim(coalesce(p_company, '')), ''),
    'email', normalized_email,
    'phone', nullif(normalized_phone, ''),
    'address', nullif(trim(coalesce(p_address, '')), ''),
    'notesCompatibility', nullif(trim(coalesce(p_notes, '')), ''),
    'preferences', coalesce(p_preferences, '{}'::jsonb),
    'allowDuplicate', coalesce(p_allow_duplicate, false),
    'vatNumber', nullif(trim(coalesce(p_vat_number, '')), '')
  );

  perform private.claim_customer_command(
    p_workspace_id,
    p_idempotency_key,
    'lifecycle',
    p_actor_user_id,
    claim_payload
  );

  -- Customer lifecycle work may run concurrently inside a workspace, but imports
  -- take the exclusive form of the same advisory lock so import and live edits do
  -- not race each other.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('customer-master:' || p_workspace_id::text, 0)
  );

  -- Duplicate review is a business guard, not just a UI warning. Serialize writes
  -- that share the same normalized identity so two simultaneous creates cannot
  -- both observe "no duplicate" and commit.
  if p_action in ('create', 'update') and normalized_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('customer-email:' || p_workspace_id::text || ':' || normalized_email, 0)
    );
  end if;
  if p_action in ('create', 'update') and char_length(normalized_phone) >= 6 then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('customer-phone:' || p_workspace_id::text || ':' || normalized_phone, 0)
    );
  end if;

  return public.apply_customer_command(
    p_workspace_id,
    p_customer_id,
    p_action,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_expected_version,
    p_code,
    p_name,
    p_company,
    p_email,
    p_phone,
    p_address,
    p_notes,
    p_preferences,
    p_allow_duplicate,
    p_vat_number
  );
end;
$function$;

create or replace function public.execute_vanita_customer_import(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_source_snapshot_id text,
  p_clients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claim_payload jsonb;
begin
  if p_clients is null or jsonb_typeof(p_clients) <> 'array' then
    raise exception 'Vanita customer import must be a JSON array';
  end if;
  if jsonb_array_length(p_clients) > 5000 then
    raise exception 'Vanita customer import is limited to 5000 records per batch';
  end if;

  -- As with lifecycle commands, authorization comes before any replay lookup.
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Customer import access denied';
  end if;

  claim_payload := jsonb_build_object(
    'batchId', p_batch_id,
    'sourceSnapshotId', nullif(trim(coalesce(p_source_snapshot_id, '')), ''),
    'clients', p_clients
  );

  perform private.claim_customer_command(
    p_workspace_id,
    p_idempotency_key,
    'vanita_import',
    p_actor_user_id,
    claim_payload
  );

  -- Imports reconcile many Customer identities at once, so they take the exclusive
  -- workspace Customer lock while ordinary lifecycle commands take its shared form.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('customer-master:' || p_workspace_id::text, 0)
  );

  return public.import_vanita_customers(
    p_workspace_id,
    p_batch_id,
    p_idempotency_key,
    p_actor_user_id,
    p_command_id,
    p_source_snapshot_id,
    p_clients
  );
end;
$function$;

-- The older public functions remain in schema history so prior migrations and
-- audit evidence stay readable, but runtime service traffic must use the hardened
-- Pass 4 wrappers above.
revoke all on function public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)
  from public, anon, authenticated;
grant execute on function public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text)
  to service_role;

revoke all on function public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb)
  to service_role;

comment on function public.execute_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean,text) is
  'Canonical Customer lifecycle runtime command. Binds idempotency keys to one actor/request and serializes duplicate identity review.';
comment on function public.execute_vanita_customer_import(uuid,uuid,text,uuid,uuid,text,jsonb) is
  'Canonical Vanita Customer import runtime command. Binds idempotency and serializes import reconciliation against live Customer edits.';

commit;
