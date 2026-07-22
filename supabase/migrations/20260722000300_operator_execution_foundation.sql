begin;

-- The Operator package is a separately sellable entitlement. It can also be
-- enabled for any bespoke contract through the existing workspace override.
insert into public.features (key, name, description, category, route, sort_order)
values (
  'operator',
  'BDB Operator',
  'Governed administrative workflows, approvals, exceptions and value evidence.',
  'automation',
  '/solo-operator',
  95
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.plans (code, name, description, term_options, sort_order)
values (
  'solo_operator',
  'Solo Operator',
  'A premium operating package for one-person and owner-operated service businesses.',
  array[3, 6]::smallint[],
  15
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  term_options = excluded.term_options,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, entitlement.feature_key, true
from public.plans plan
cross join lateral (
  select unnest(array[
    'overview', 'operator', 'accounts', 'customers', 'calendar',
    'communications', 'documents', 'activity', 'appearance', 'mobile_app'
  ]) as feature_key
) entitlement
where plan.code = 'solo_operator'
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;

insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, 'operator', true
from public.plans plan
where plan.code = 'pro'
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;

create table public.operator_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_key text not null check (workflow_key ~ '^[a-z][a-z0-9-]{2,79}$'),
  enabled boolean not null default true,
  autonomy_mode text not null default 'approval'
    check (autonomy_mode in ('assist', 'approval', 'bounded')),
  provider_mode text not null default 'unconfigured'
    check (provider_mode in ('unconfigured', 'mock', 'webhook', 'internal')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  blueprint_key text not null default 'general-services',
  blueprint_version integer not null default 1 check (blueprint_version > 0),
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, workflow_key)
);

create table public.operator_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_key text not null,
  source_type text not null check (source_type in ('booking', 'invoice', 'message', 'document', 'customer', 'manual')),
  source_id text not null,
  status text not null check (status in (
    'prepared', 'awaiting_approval', 'queued', 'running', 'succeeded',
    'simulated', 'exception', 'failed', 'cancelled'
  )),
  autonomy_mode text not null check (autonomy_mode in ('assist', 'approval', 'bounded')),
  provider_mode text not null default 'unconfigured'
    check (provider_mode in ('unconfigured', 'mock', 'webhook', 'internal')),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  planned_action jsonb not null check (jsonb_typeof(planned_action) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  error_code text,
  error_message text,
  estimated_minutes_saved numeric(8,2) not null default 0 check (estimated_minutes_saved >= 0),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  revision integer not null default 1 check (revision > 0),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (id, workspace_id)
);

create table public.operator_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_from uuid,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, workspace_id)
    references public.operator_runs(id, workspace_id) on delete cascade,
  unique (run_id)
);

create table public.operator_exceptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  code text not null,
  title text not null,
  detail text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, workspace_id)
    references public.operator_runs(id, workspace_id) on delete cascade
);

create table public.operator_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  attempt integer not null check (attempt > 0),
  provider_mode text not null check (provider_mode in ('unconfigured', 'mock', 'webhook', 'internal')),
  provider_reference text,
  accepted boolean not null default false,
  simulated boolean not null default false,
  response_code integer,
  response_summary text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  attempted_at timestamptz not null default now(),
  foreign key (run_id, workspace_id)
    references public.operator_runs(id, workspace_id) on delete cascade,
  unique (run_id, attempt)
);

create table public.operator_value_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  category text not null check (category in ('time_returned', 'cash_protected', 'booking_protected', 'record_completed')),
  minutes_saved numeric(8,2) not null default 0 check (minutes_saved >= 0),
  cash_protected numeric(12,2) not null default 0 check (cash_protected >= 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  verified boolean not null default false,
  evidence_source text not null check (evidence_source in ('provider', 'internal_record', 'human_confirmed', 'simulation')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint operator_value_verification_source_check
    check (not verified or evidence_source <> 'simulation'),
  foreign key (run_id, workspace_id)
    references public.operator_runs(id, workspace_id) on delete cascade,
  unique (run_id, category)
);

create index operator_runs_workspace_status_schedule_idx
  on public.operator_runs(workspace_id, status, scheduled_at, created_at desc);
create index operator_runs_worker_queue_idx
  on public.operator_runs(scheduled_at, created_at)
  where status = 'queued';
create index operator_approvals_workspace_status_idx
  on public.operator_approvals(workspace_id, status, requested_at desc);
create index operator_exceptions_workspace_status_idx
  on public.operator_exceptions(workspace_id, status, created_at desc);
create index operator_value_workspace_recorded_idx
  on public.operator_value_events(workspace_id, recorded_at desc);

alter table public.operator_policies enable row level security;
alter table public.operator_runs enable row level security;
alter table public.operator_approvals enable row level security;
alter table public.operator_exceptions enable row level security;
alter table public.operator_delivery_attempts enable row level security;
alter table public.operator_value_events enable row level security;

alter table public.operator_policies force row level security;
alter table public.operator_runs force row level security;
alter table public.operator_approvals force row level security;
alter table public.operator_exceptions force row level security;
alter table public.operator_delivery_attempts force row level security;
alter table public.operator_value_events force row level security;

revoke all on table public.operator_policies from public, anon, authenticated;
revoke all on table public.operator_runs from public, anon, authenticated;
revoke all on table public.operator_approvals from public, anon, authenticated;
revoke all on table public.operator_exceptions from public, anon, authenticated;
revoke all on table public.operator_delivery_attempts from public, anon, authenticated;
revoke all on table public.operator_value_events from public, anon, authenticated;

grant select on table public.operator_policies to authenticated;
grant select on table public.operator_runs to authenticated;
grant select on table public.operator_approvals to authenticated;
grant select on table public.operator_exceptions to authenticated;
grant select on table public.operator_delivery_attempts to authenticated;
grant select on table public.operator_value_events to authenticated;

grant all on table public.operator_policies to service_role;
grant all on table public.operator_runs to service_role;
grant all on table public.operator_approvals to service_role;
grant all on table public.operator_exceptions to service_role;
grant all on table public.operator_delivery_attempts to service_role;
grant all on table public.operator_value_events to service_role;

create policy "Operator policies are tenant scoped"
on public.operator_policies for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create policy "Operator runs are tenant scoped"
on public.operator_runs for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create policy "Operator approvals are tenant scoped"
on public.operator_approvals for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create policy "Operator exceptions are tenant scoped"
on public.operator_exceptions for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create policy "Operator attempts are tenant scoped"
on public.operator_delivery_attempts for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create policy "Operator value is tenant scoped"
on public.operator_value_events for select to authenticated
using (private.has_workspace_permission(workspace_id, 'operator', 'view'));

create or replace function private.operator_workflow_is_published(
  target_workspace_id uuid,
  target_workflow_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_sector_configs config
    where config.workspace_id = target_workspace_id
      and config.status = 'published'
      and config.published_config is not null
      and config.published_config -> 'workflows' ? target_workflow_key
  );
$$;

revoke all on function private.operator_workflow_is_published(uuid, text) from public;
grant execute on function private.operator_workflow_is_published(uuid, text) to authenticated;

create or replace function private.sync_workspace_operator_policies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workflow text;
  resolved_blueprint_key text;
  resolved_blueprint_version integer;
begin
  if new.status <> 'published' or new.published_config is null then
    return new;
  end if;

  resolved_blueprint_key := coalesce(new.published_config ->> 'key', 'general-services');
  resolved_blueprint_version := greatest(1, coalesce((new.published_config ->> 'version')::integer, 1));

  update public.operator_policies policy
  set enabled = false,
      blueprint_key = resolved_blueprint_key,
      blueprint_version = resolved_blueprint_version,
      updated_at = now()
  where policy.workspace_id = new.workspace_id
    and not (new.published_config -> 'workflows' ? policy.workflow_key);

  for workflow in
    select jsonb_array_elements_text(coalesce(new.published_config -> 'workflows', '[]'::jsonb))
  loop
    insert into public.operator_policies (
      workspace_id,
      workflow_key,
      enabled,
      autonomy_mode,
      resolved_blueprint_key,
      resolved_blueprint_version,
      updated_by
    ) values (
      new.workspace_id,
      workflow,
      true,
      case
        when workflow in ('new-enquiry-triage', 'matter-deadline-review', 'recurring-compliance-check') then 'assist'
        else 'approval'
      end,
      blueprint_key,
      blueprint_version,
      new.updated_by
    )
    on conflict (workspace_id, workflow_key) do update set
      enabled = true,
      blueprint_key = excluded.blueprint_key,
      blueprint_version = excluded.blueprint_version,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  return new;
end;
$$;

revoke all on function private.sync_workspace_operator_policies() from public;

drop trigger if exists workspace_sector_configs_sync_operator_policies
  on public.workspace_sector_configs;
create trigger workspace_sector_configs_sync_operator_policies
after insert or update of published_config, status
on public.workspace_sector_configs
for each row execute function private.sync_workspace_operator_policies();

-- Backfill policies for already provisioned workspaces without changing their
-- published Sector Pack snapshot.
insert into public.operator_policies (
  workspace_id,
  workflow_key,
  enabled,
  autonomy_mode,
  blueprint_key,
  blueprint_version,
  updated_by
)
select
  config.workspace_id,
  workflow.value,
  true,
  case
    when workflow.value in ('new-enquiry-triage', 'matter-deadline-review', 'recurring-compliance-check') then 'assist'
    else 'approval'
  end,
  coalesce(config.published_config ->> 'key', 'general-services'),
  greatest(1, coalesce((config.published_config ->> 'version')::integer, 1)),
  config.updated_by
from public.workspace_sector_configs config
cross join lateral jsonb_array_elements_text(
  coalesce(config.published_config -> 'workflows', '[]'::jsonb)
) as workflow(value)
where config.status = 'published'
on conflict (workspace_id, workflow_key) do nothing;

create or replace function public.set_operator_policy(
  p_workspace_id uuid,
  p_workflow_key text,
  p_enabled boolean,
  p_autonomy_mode text,
  p_provider_mode text default 'unconfigured',
  p_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  policy public.operator_policies%rowtype;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'operator', 'edit') then
    raise exception 'Operator policy access denied' using errcode = '42501';
  end if;

  if not private.operator_workflow_is_published(p_workspace_id, p_workflow_key) then
    raise exception 'Workflow is not published for this workspace';
  end if;

  if p_autonomy_mode not in ('assist', 'approval', 'bounded')
    or p_provider_mode not in ('unconfigured', 'mock', 'webhook', 'internal')
    or jsonb_typeof(coalesce(p_config, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid operator policy';
  end if;

  -- Bounded execution is deliberately narrow. Money, legal judgement,
  -- clinical judgement, destructive work and sensitive replies remain gated.
  if p_autonomy_mode = 'bounded' and p_workflow_key <> 'appointment-reminders' then
    raise exception 'This workflow cannot run without approval';
  end if;

  update public.operator_policies
  set enabled = p_enabled,
      autonomy_mode = p_autonomy_mode,
      provider_mode = p_provider_mode,
      config = coalesce(p_config, '{}'::jsonb),
      updated_by = caller_id,
      updated_at = now()
  where workspace_id = p_workspace_id
    and workflow_key = p_workflow_key
  returning * into policy;

  if policy.id is null then
    raise exception 'Operator policy is unavailable';
  end if;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    caller_id,
    'operator.policy_updated',
    p_workflow_key || ' set to ' || p_autonomy_mode,
    'neutral',
    'operator_policy',
    policy.id::text,
    jsonb_build_object('enabled', p_enabled, 'provider_mode', p_provider_mode)
  );

  return jsonb_build_object(
    'id', policy.id,
    'workflowKey', policy.workflow_key,
    'enabled', policy.enabled,
    'autonomyMode', policy.autonomy_mode,
    'providerMode', policy.provider_mode
  );
end;
$$;

create or replace function public.create_operator_run(
  p_workspace_id uuid,
  p_workflow_key text,
  p_source_type text,
  p_source_id text,
  p_risk_level text,
  p_planned_action jsonb,
  p_estimated_minutes_saved numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  policy public.operator_policies%rowtype;
  run public.operator_runs%rowtype;
  initial_status text;
  replayed boolean := false;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'operator', 'create') then
    raise exception 'Operator run access denied' using errcode = '42501';
  end if;

  if not private.operator_workflow_is_published(p_workspace_id, p_workflow_key) then
    raise exception 'Workflow is not published for this workspace';
  end if;

  select * into policy
  from public.operator_policies
  where workspace_id = p_workspace_id
    and workflow_key = p_workflow_key
    and enabled;

  if policy.id is null then
    raise exception 'Workflow is paused';
  end if;

  if p_source_type not in ('booking', 'invoice', 'message', 'document', 'customer', 'manual')
    or p_risk_level not in ('low', 'medium', 'high')
    or jsonb_typeof(p_planned_action) <> 'object'
    or char_length(trim(p_source_id)) = 0
    or char_length(p_idempotency_key) not between 8 and 128
    or p_estimated_minutes_saved < 0 then
    raise exception 'Invalid operator run';
  end if;

  if policy.autonomy_mode = 'bounded'
    and (p_workflow_key <> 'appointment-reminders' or p_risk_level <> 'low') then
    raise exception 'This action requires approval';
  end if;

  initial_status := case policy.autonomy_mode
    when 'assist' then 'prepared'
    when 'approval' then 'awaiting_approval'
    else 'queued'
  end;

  insert into public.operator_runs (
    workspace_id,
    workflow_key,
    source_type,
    source_id,
    status,
    autonomy_mode,
    provider_mode,
    risk_level,
    idempotency_key,
    planned_action,
    estimated_minutes_saved,
    created_by
  ) values (
    p_workspace_id,
    p_workflow_key,
    p_source_type,
    p_source_id,
    initial_status,
    policy.autonomy_mode,
    policy.provider_mode,
    p_risk_level,
    p_idempotency_key,
    p_planned_action,
    p_estimated_minutes_saved,
    caller_id
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into run;

  if run.id is null then
    replayed := true;
    select * into run
    from public.operator_runs
    where workspace_id = p_workspace_id
      and idempotency_key = p_idempotency_key;
  else
    if initial_status = 'awaiting_approval' then
      insert into public.operator_approvals (workspace_id, run_id, requested_from, expires_at)
      values (p_workspace_id, run.id, caller_id, now() + interval '24 hours');
    end if;

    insert into public.activity_items (
      workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, metadata
    ) values (
      p_workspace_id,
      caller_id,
      'operator.run_created',
      coalesce(p_planned_action ->> 'title', p_workflow_key),
      'gold',
      'operator_run',
      run.id::text,
      jsonb_build_object(
        'workflow_key', p_workflow_key,
        'autonomy_mode', policy.autonomy_mode,
        'status', initial_status,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  return jsonb_build_object(
    'id', run.id,
    'status', run.status,
    'revision', run.revision,
    'replayed', replayed
  );
end;
$$;

create or replace function public.decide_operator_run(
  p_workspace_id uuid,
  p_run_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  run public.operator_runs%rowtype;
  next_status text;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'operator', 'approve') then
    raise exception 'Operator approval access denied' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected')
    or p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Invalid approval decision';
  end if;

  select * into run
  from public.operator_runs
  where id = p_run_id and workspace_id = p_workspace_id
  for update;

  if run.id is null then raise exception 'Operator run not found'; end if;
  if run.revision <> p_expected_revision then raise exception 'Operator run changed; refresh and review again'; end if;
  if run.status <> 'awaiting_approval' then
    return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', true);
  end if;

  next_status := case p_decision when 'approved' then 'queued' else 'cancelled' end;

  update public.operator_approvals
  set status = p_decision,
      decided_by = caller_id,
      decided_at = now(),
      decision_note = p_note,
      updated_at = now()
  where run_id = run.id and status = 'pending';

  update public.operator_runs
  set status = next_status,
      revision = revision + 1,
      completed_at = case when next_status = 'cancelled' then now() else null end,
      updated_at = now()
  where id = run.id
  returning * into run;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    caller_id,
    'operator.run_' || p_decision,
    coalesce(run.planned_action ->> 'title', run.workflow_key),
    case when p_decision = 'approved' then 'green' else 'neutral' end,
    'operator_run',
    run.id::text,
    jsonb_build_object('decision_note', p_note)
  );

  return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', false);
end;
$$;

create or replace function public.complete_operator_run_manually(
  p_workspace_id uuid,
  p_run_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  run public.operator_runs%rowtype;
begin
  if caller_id is null
    or not private.has_workspace_permission(p_workspace_id, 'operator', 'edit') then
    raise exception 'Operator completion access denied' using errcode = '42501';
  end if;

  select * into run
  from public.operator_runs
  where id = p_run_id and workspace_id = p_workspace_id
  for update;

  if run.id is null then raise exception 'Operator run not found'; end if;
  if run.revision <> p_expected_revision then raise exception 'Operator run changed; refresh and review again'; end if;
  if run.status <> 'prepared' then
    return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', true);
  end if;

  update public.operator_runs
  set status = 'succeeded',
      provider_mode = 'internal',
      completed_at = now(),
      revision = revision + 1,
      evidence = jsonb_build_object('confirmed_by', caller_id, 'confirmed_at', now()),
      updated_at = now()
  where id = run.id
  returning * into run;

  insert into public.operator_value_events (
    workspace_id, run_id, category, minutes_saved, verified, evidence_source, evidence
  ) values (
    p_workspace_id,
    run.id,
    'record_completed',
    0,
    true,
    'human_confirmed',
    jsonb_build_object('confirmed_by', caller_id)
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    caller_id,
    'operator.run_completed',
    coalesce(run.planned_action ->> 'title', run.workflow_key),
    'green',
    'operator_run',
    run.id::text,
    jsonb_build_object('evidence_source', 'human_confirmed')
  );

  return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', false);
end;
$$;

revoke all on function public.set_operator_policy(uuid, text, boolean, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_operator_run(uuid, text, text, text, text, jsonb, numeric, text)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_operator_run(uuid, uuid, text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_operator_run_manually(uuid, uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.set_operator_policy(uuid, text, boolean, text, text, jsonb)
  to authenticated;
grant execute on function public.create_operator_run(uuid, text, text, text, text, jsonb, numeric, text)
  to authenticated;
grant execute on function public.decide_operator_run(uuid, uuid, text, integer, text)
  to authenticated;
grant execute on function public.complete_operator_run_manually(uuid, uuid, integer)
  to authenticated;

create or replace function public.claim_operator_runs(
  p_limit integer default 10,
  p_worker_id text default 'operator-worker'
)
returns setof public.operator_runs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operator worker access denied' using errcode = '42501';
  end if;

  -- A crashed function invocation must not leave work stuck forever. Exhausted
  -- claims become explicit exceptions; retriable claims return to the queue.
  insert into public.operator_exceptions (
    workspace_id, run_id, code, title, detail, severity
  )
  select
    stale.workspace_id,
    stale.id,
    'WORKER_TIMEOUT',
    'Workflow worker timed out',
    'The workflow was claimed but did not complete before the recovery window.',
    'critical'
  from public.operator_runs stale
  where stale.status = 'running'
    and stale.claimed_at < now() - interval '15 minutes'
    and stale.attempts >= stale.max_attempts
    and not exists (
      select 1 from public.operator_exceptions exception
      where exception.run_id = stale.id and exception.code = 'WORKER_TIMEOUT'
    );

  update public.operator_runs stale
  set status = 'failed',
      error_code = 'WORKER_TIMEOUT',
      error_message = 'The workflow worker timed out after the maximum number of attempts.',
      completed_at = now(),
      revision = stale.revision + 1,
      updated_at = now()
  where stale.status = 'running'
    and stale.claimed_at < now() - interval '15 minutes'
    and stale.attempts >= stale.max_attempts;

  update public.operator_runs stale
  set status = 'queued',
      scheduled_at = now(),
      claimed_at = null,
      claimed_by = null,
      error_code = 'WORKER_RECOVERED',
      error_message = 'A stale worker claim was recovered automatically.',
      revision = stale.revision + 1,
      updated_at = now()
  where stale.status = 'running'
    and stale.claimed_at < now() - interval '15 minutes'
    and stale.attempts < stale.max_attempts;

  return query
  with candidates as (
    select candidate.id
    from public.operator_runs candidate
    where candidate.status = 'queued'
      and candidate.scheduled_at <= now()
      and candidate.attempts < candidate.max_attempts
    order by candidate.scheduled_at, candidate.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.operator_runs run
  set status = 'running',
      started_at = coalesce(run.started_at, now()),
      claimed_at = now(),
      claimed_by = left(coalesce(p_worker_id, 'operator-worker'), 120),
      attempts = run.attempts + 1,
      revision = run.revision + 1,
      updated_at = now()
  from candidates
  where run.id = candidates.id
  returning run.*;
end;
$$;

create or replace function public.retry_operator_run(
  p_run_id uuid,
  p_provider_mode text,
  p_provider_reference text,
  p_response_code integer,
  p_response_summary text,
  p_evidence jsonb,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run public.operator_runs%rowtype;
  retry_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'Operator worker access denied' using errcode = '42501';
  end if;

  if p_provider_mode not in ('unconfigured', 'mock', 'webhook', 'internal')
    or jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid operator retry';
  end if;

  select * into run
  from public.operator_runs
  where id = p_run_id
  for update;

  if run.id is null then raise exception 'Operator run not found'; end if;
  if run.status <> 'running' then
    return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', true);
  end if;

  insert into public.operator_delivery_attempts (
    workspace_id,
    run_id,
    attempt,
    provider_mode,
    provider_reference,
    accepted,
    simulated,
    response_code,
    response_summary,
    evidence
  ) values (
    run.workspace_id,
    run.id,
    run.attempts,
    p_provider_mode,
    p_provider_reference,
    false,
    false,
    p_response_code,
    left(p_response_summary, 1000),
    coalesce(p_evidence, '{}'::jsonb)
  );

  if run.attempts >= run.max_attempts then
    update public.operator_runs
    set status = 'failed',
        provider_mode = p_provider_mode,
        evidence = coalesce(p_evidence, '{}'::jsonb),
        error_code = coalesce(p_error_code, 'PROVIDER_FAILED'),
        error_message = coalesce(p_error_message, 'The provider rejected the workflow.'),
        completed_at = now(),
        revision = revision + 1,
        updated_at = now()
    where id = run.id
    returning * into run;

    insert into public.operator_exceptions (
      workspace_id, run_id, code, title, detail, severity
    ) values (
      run.workspace_id,
      run.id,
      coalesce(p_error_code, 'PROVIDER_FAILED'),
      'Workflow delivery failed',
      coalesce(p_error_message, 'The provider rejected the workflow after all retry attempts.'),
      'critical'
    );
  else
    retry_at := now() + make_interval(mins => least(30, (power(2, run.attempts))::integer));
    update public.operator_runs
    set status = 'queued',
        provider_mode = p_provider_mode,
        scheduled_at = retry_at,
        claimed_at = null,
        claimed_by = null,
        error_code = coalesce(p_error_code, 'PROVIDER_RETRY'),
        error_message = coalesce(p_error_message, 'The provider call will be retried.'),
        revision = revision + 1,
        updated_at = now()
    where id = run.id
    returning * into run;
  end if;

  return jsonb_build_object(
    'id', run.id,
    'status', run.status,
    'revision', run.revision,
    'retryAt', retry_at,
    'replayed', false
  );
end;
$$;

create or replace function public.complete_operator_run(
  p_run_id uuid,
  p_status text,
  p_provider_mode text,
  p_provider_reference text,
  p_response_code integer,
  p_response_summary text,
  p_evidence jsonb,
  p_verified boolean,
  p_cash_protected numeric default 0,
  p_currency text default 'GBP',
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run public.operator_runs%rowtype;
  evidence_source text;
begin
  if current_user <> 'service_role' then
    raise exception 'Operator worker access denied' using errcode = '42501';
  end if;

  if p_status not in ('succeeded', 'simulated', 'exception', 'failed')
    or p_provider_mode not in ('unconfigured', 'mock', 'webhook', 'internal')
    or p_currency not in ('GBP', 'EUR', 'USD')
    or p_cash_protected < 0
    or (p_verified and (p_status <> 'succeeded' or p_provider_mode = 'mock'))
    or jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid operator completion';
  end if;

  select * into run
  from public.operator_runs
  where id = p_run_id
  for update;

  if run.id is null then raise exception 'Operator run not found'; end if;
  if run.status in ('succeeded', 'simulated', 'exception', 'failed', 'cancelled') then
    return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', true);
  end if;
  if run.status <> 'running' then raise exception 'Operator run is not claimed'; end if;

  update public.operator_runs
  set status = p_status,
      provider_mode = p_provider_mode,
      evidence = coalesce(p_evidence, '{}'::jsonb),
      error_code = p_error_code,
      error_message = p_error_message,
      completed_at = now(),
      revision = revision + 1,
      updated_at = now()
  where id = run.id
  returning * into run;

  insert into public.operator_delivery_attempts (
    workspace_id,
    run_id,
    attempt,
    provider_mode,
    provider_reference,
    accepted,
    simulated,
    response_code,
    response_summary,
    evidence
  ) values (
    run.workspace_id,
    run.id,
    run.attempts,
    p_provider_mode,
    p_provider_reference,
    p_status = 'succeeded',
    p_status = 'simulated',
    p_response_code,
    left(p_response_summary, 1000),
    coalesce(p_evidence, '{}'::jsonb)
  );

  if p_status in ('exception', 'failed') then
    insert into public.operator_exceptions (
      workspace_id, run_id, code, title, detail, severity
    ) values (
      run.workspace_id,
      run.id,
      coalesce(p_error_code, upper(p_status)),
      case when p_status = 'failed' then 'Workflow failed' else 'Workflow needs configuration' end,
      coalesce(p_error_message, 'The operator returned this work for human review.'),
      case when p_status = 'failed' then 'critical' else 'warning' end
    );
  else
    evidence_source := case
      when p_status = 'simulated' then 'simulation'
      when p_provider_mode = 'internal' then 'internal_record'
      else 'provider'
    end;

    insert into public.operator_value_events (
      workspace_id,
      run_id,
      category,
      minutes_saved,
      cash_protected,
      currency,
      verified,
      evidence_source,
      evidence
    ) values (
      run.workspace_id,
      run.id,
      case when p_cash_protected > 0 then 'cash_protected' else 'time_returned' end,
      run.estimated_minutes_saved,
      p_cash_protected,
      p_currency,
      p_verified and p_status = 'succeeded',
      evidence_source,
      coalesce(p_evidence, '{}'::jsonb)
    );
  end if;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, metadata
  ) values (
    run.workspace_id,
    run.created_by,
    'operator.run_' || p_status,
    coalesce(run.planned_action ->> 'title', run.workflow_key),
    case
      when p_status = 'succeeded' then 'green'
      when p_status = 'simulated' then 'neutral'
      else 'gold'
    end,
    'operator_run',
    run.id::text,
    jsonb_build_object(
      'provider_mode', p_provider_mode,
      'provider_reference', p_provider_reference,
      'verified', p_verified and p_status = 'succeeded'
    )
  );

  return jsonb_build_object('id', run.id, 'status', run.status, 'revision', run.revision, 'replayed', false);
end;
$$;

revoke all on function public.claim_operator_runs(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_operator_run(uuid, text, text, integer, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_operator_run(uuid, text, text, text, integer, text, jsonb, boolean, numeric, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_operator_runs(integer, text) to service_role;
grant execute on function public.retry_operator_run(uuid, text, text, integer, text, jsonb, text, text)
  to service_role;
grant execute on function public.complete_operator_run(uuid, text, text, text, integer, text, jsonb, boolean, numeric, text, text, text)
  to service_role;

comment on table public.operator_runs is
  'Durable, idempotent BDB Operator work. Final states are evidence-backed and simulation is never counted as verified work.';
comment on table public.operator_value_events is
  'Commercial value ledger. Verified and simulated outcomes remain explicitly separate.';
comment on function public.create_operator_run(uuid, text, text, text, text, jsonb, numeric, text) is
  'Authenticated atomic command for creating an idempotent operator run and its approval/activity records.';
comment on function public.complete_operator_run(uuid, text, text, text, integer, text, jsonb, boolean, numeric, text, text, text) is
  'Service-role-only atomic completion used by the operator worker.';

commit;
