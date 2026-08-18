begin;

-- BDB OS V1 usage metering is measurement-only. It records trustworthy
-- workspace usage without charging, suspending, or exposing provider billing.

create table public.plan_usage_allowances (
  plan_id uuid not null references public.plans(id) on delete cascade,
  metric_key text not null,
  unit text not null,
  included_quantity numeric,
  warning_threshold_percent numeric not null default 80,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, metric_key),
  constraint plan_usage_allowances_metric_check check (
    metric_key in ('storage_bytes','active_users','automation_executions','outbound_emails','sms_segments')
  ),
  constraint plan_usage_allowances_quantity_check check (included_quantity is null or included_quantity >= 0),
  constraint plan_usage_allowances_warning_check check (warning_threshold_percent >= 0 and warning_threshold_percent <= 100)
);

comment on table public.plan_usage_allowances is
  'Founder-managed usage allowances attached to the existing commercial Plans engine. NULL quantity means not configured, never an automatic charge.';

insert into public.plan_usage_allowances (plan_id, metric_key, unit, included_quantity)
select plan.id, metric.metric_key, metric.unit, null
from public.plans plan
cross join (values
  ('storage_bytes'::text, 'bytes'::text),
  ('active_users'::text, 'users'::text),
  ('automation_executions'::text, 'executions'::text),
  ('outbound_emails'::text, 'messages'::text),
  ('sms_segments'::text, 'segments'::text)
) metric(metric_key, unit)
on conflict (plan_id, metric_key) do nothing;

create table public.workspace_usage_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  plan_id_snapshot uuid references public.plans(id) on delete set null,
  plan_code_snapshot text,
  plan_name_snapshot text,
  allowances_snapshot jsonb not null default '{}'::jsonb,
  measurement_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, period_start),
  constraint workspace_usage_periods_bounds_check check (period_end > period_start),
  constraint workspace_usage_periods_allowances_check check (jsonb_typeof(allowances_snapshot) = 'object')
);

comment on table public.workspace_usage_periods is
  'Monthly measurement periods. Plan identity and allowances are frozen when the period is first observed so later commercial edits cannot rewrite usage history.';

create table public.workspace_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_period_id uuid not null references public.workspace_usage_periods(id) on delete cascade,
  metric_key text not null,
  quantity numeric not null,
  unit text not null,
  idempotency_key text not null,
  source_type text not null,
  source_id text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_usage_events_metric_check check (
    metric_key in ('storage_bytes','active_users','automation_executions','outbound_emails','sms_segments')
  ),
  constraint workspace_usage_events_quantity_check check (quantity > 0),
  constraint workspace_usage_events_idempotency_check check (char_length(idempotency_key) between 8 and 200),
  constraint workspace_usage_events_metadata_check check (jsonb_typeof(metadata) = 'object'),
  unique (workspace_id, metric_key, idempotency_key)
);

create index workspace_usage_events_period_metric_idx
  on public.workspace_usage_events (usage_period_id, metric_key, occurred_at desc);
create index workspace_usage_events_workspace_time_idx
  on public.workspace_usage_events (workspace_id, occurred_at desc);

comment on table public.workspace_usage_events is
  'Append-only, workspace-owned, idempotent usage ledger for event-style meters. It is measurement evidence, not a customer invoice.';

create table public.workspace_usage_baselines (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  metric_key text not null,
  quantity numeric not null,
  unit text not null,
  captured_at timestamptz not null default now(),
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (workspace_id, metric_key),
  constraint workspace_usage_baselines_metric_check check (metric_key in ('storage_bytes','active_users')),
  constraint workspace_usage_baselines_quantity_check check (quantity >= 0),
  constraint workspace_usage_baselines_metadata_check check (jsonb_typeof(metadata) = 'object')
);

comment on table public.workspace_usage_baselines is
  'One trustworthy starting point for point-in-time resources when metering is enabled. Baselines are not reconstructed billing history.';

alter table public.plan_usage_allowances enable row level security;
alter table public.workspace_usage_periods enable row level security;
alter table public.workspace_usage_events enable row level security;
alter table public.workspace_usage_baselines enable row level security;

create policy "Platform admins can view plan usage allowances"
on public.plan_usage_allowances for select to authenticated
using (private.is_platform_admin());

create policy "Platform admins can view workspace usage periods"
on public.workspace_usage_periods for select to authenticated
using (private.is_platform_admin());

create policy "Platform admins can view workspace usage events"
on public.workspace_usage_events for select to authenticated
using (private.is_platform_admin());

create policy "Platform admins can view workspace usage baselines"
on public.workspace_usage_baselines for select to authenticated
using (private.is_platform_admin());

revoke all on public.plan_usage_allowances from anon, authenticated;
revoke all on public.workspace_usage_periods from anon, authenticated;
revoke all on public.workspace_usage_events from anon, authenticated;
revoke all on public.workspace_usage_baselines from anon, authenticated;
grant select on public.plan_usage_allowances to authenticated;
grant select on public.workspace_usage_periods to authenticated;
grant select on public.workspace_usage_events to authenticated;
grant select on public.workspace_usage_baselines to authenticated;

create or replace function public.ensure_workspace_usage_period(
  p_workspace_id uuid,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_period_id uuid;
  v_plan_id uuid;
  v_plan_code text;
  v_plan_name text;
  v_allowances jsonb := '{}'::jsonb;
begin
  if p_workspace_id is null then
    raise exception 'Workspace is required';
  end if;

  select workspace.plan_id, plan.code, plan.name
  into v_plan_id, v_plan_code, v_plan_name
  from public.workspaces workspace
  left join public.plans plan on plan.id = workspace.plan_id
  where workspace.id = p_workspace_id;

  if not found then
    raise exception 'Workspace not found';
  end if;

  v_period_start := date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';
  v_period_end := v_period_start + interval '1 month';

  if v_plan_id is not null then
    select coalesce(jsonb_object_agg(
      allowance.metric_key,
      jsonb_build_object(
        'unit', allowance.unit,
        'included_quantity', allowance.included_quantity,
        'warning_threshold_percent', allowance.warning_threshold_percent
      )
    ), '{}'::jsonb)
    into v_allowances
    from public.plan_usage_allowances allowance
    where allowance.plan_id = v_plan_id;
  end if;

  insert into public.workspace_usage_periods (
    workspace_id,
    period_start,
    period_end,
    plan_id_snapshot,
    plan_code_snapshot,
    plan_name_snapshot,
    allowances_snapshot,
    measurement_started_at
  )
  values (
    p_workspace_id,
    v_period_start,
    v_period_end,
    v_plan_id,
    v_plan_code,
    v_plan_name,
    v_allowances,
    now()
  )
  on conflict (workspace_id, period_start) do nothing
  returning id into v_period_id;

  if v_period_id is null then
    select period.id
    into v_period_id
    from public.workspace_usage_periods period
    where period.workspace_id = p_workspace_id
      and period.period_start = v_period_start;
  end if;

  return v_period_id;
end;
$function$;

revoke all on function public.ensure_workspace_usage_period(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ensure_workspace_usage_period(uuid,timestamptz) to service_role;

create or replace function public.record_workspace_usage_event(
  p_workspace_id uuid,
  p_metric_key text,
  p_quantity numeric,
  p_unit text,
  p_idempotency_key text,
  p_source_type text,
  p_source_id text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_id uuid;
  v_event_id uuid;
begin
  if p_metric_key not in ('storage_bytes','active_users','automation_executions','outbound_emails','sms_segments') then
    raise exception 'Unsupported usage metric';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Usage quantity must be positive';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null or char_length(p_idempotency_key) > 200 then
    raise exception 'A valid usage idempotency key is required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Usage metadata must be an object';
  end if;

  v_period_id := public.ensure_workspace_usage_period(p_workspace_id, coalesce(p_occurred_at, now()));

  insert into public.workspace_usage_events (
    workspace_id,
    usage_period_id,
    metric_key,
    quantity,
    unit,
    idempotency_key,
    source_type,
    source_id,
    occurred_at,
    metadata
  )
  values (
    p_workspace_id,
    v_period_id,
    p_metric_key,
    p_quantity,
    p_unit,
    p_idempotency_key,
    p_source_type,
    p_source_id,
    coalesce(p_occurred_at, now()),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (workspace_id, metric_key, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.id
    into v_event_id
    from public.workspace_usage_events event
    where event.workspace_id = p_workspace_id
      and event.metric_key = p_metric_key
      and event.idempotency_key = p_idempotency_key;
  end if;

  return v_event_id;
end;
$function$;

revoke all on function public.record_workspace_usage_event(uuid,text,numeric,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.record_workspace_usage_event(uuid,text,numeric,text,text,text,text,timestamptz,jsonb) to service_role;

create or replace function private.meter_operator_run_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_execution_states constant text[] := array['running','succeeded','simulated','exception','failed'];
begin
  if new.status = any(v_execution_states)
    and (tg_op = 'INSERT' or old.status <> all(v_execution_states))
  then
    begin
      perform public.record_workspace_usage_event(
        new.workspace_id,
        'automation_executions',
        1,
        'executions',
        'operator-run:' || new.id::text,
        'operator_run',
        new.id::text,
        coalesce(new.started_at, new.completed_at, new.updated_at, new.created_at, now()),
        jsonb_build_object(
          'workflow_key', new.workflow_key,
          'provider_mode', new.provider_mode,
          'status', new.status
        )
      );
    exception when others then
      -- Metering is recoverable by reconciliation and must never break Operator work.
      null;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists meter_operator_run_usage on public.operator_runs;
create trigger meter_operator_run_usage
after insert or update of status on public.operator_runs
for each row execute function private.meter_operator_run_usage();

create or replace function private.meter_outbound_email_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.direction = 'outbound' and new.channel = 'Email' and new.draft_state = 'none' then
    begin
      perform public.record_workspace_usage_event(
        new.workspace_id,
        'outbound_emails',
        1,
        'messages',
        'message:' || new.id::text,
        'communication_message',
        new.id::text,
        new.occurred_at,
        jsonb_build_object(
          'channel', new.channel,
          'thread_id', new.thread_id,
          'delivery_evidence', 'recorded_outbound_message'
        )
      );
    exception when others then
      -- Communications remain authoritative even if metering is temporarily unavailable.
      null;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists meter_outbound_email_usage on public.messages;
create trigger meter_outbound_email_usage
after insert on public.messages
for each row execute function private.meter_outbound_email_usage();

create or replace function public.reconcile_workspace_usage_events(
  p_workspace_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_automation_count integer := 0;
  v_email_count integer := 0;
begin
  perform public.ensure_workspace_usage_period(p_workspace_id, p_at);
  v_period_start := date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';
  v_period_end := v_period_start + interval '1 month';

  insert into public.workspace_usage_events (
    workspace_id, usage_period_id, metric_key, quantity, unit,
    idempotency_key, source_type, source_id, occurred_at, metadata
  )
  select
    run.workspace_id,
    public.ensure_workspace_usage_period(run.workspace_id, coalesce(run.started_at, run.completed_at, run.updated_at, run.created_at)),
    'automation_executions',
    1,
    'executions',
    'operator-run:' || run.id::text,
    'operator_run',
    run.id::text,
    coalesce(run.started_at, run.completed_at, run.updated_at, run.created_at),
    jsonb_build_object('workflow_key', run.workflow_key, 'provider_mode', run.provider_mode, 'status', run.status, 'reconciled', true)
  from public.operator_runs run
  where run.workspace_id = p_workspace_id
    and run.status in ('running','succeeded','simulated','exception','failed')
    and coalesce(run.started_at, run.completed_at, run.updated_at, run.created_at) >= v_period_start
    and coalesce(run.started_at, run.completed_at, run.updated_at, run.created_at) < v_period_end
  on conflict (workspace_id, metric_key, idempotency_key) do nothing;
  get diagnostics v_automation_count = row_count;

  insert into public.workspace_usage_events (
    workspace_id, usage_period_id, metric_key, quantity, unit,
    idempotency_key, source_type, source_id, occurred_at, metadata
  )
  select
    message.workspace_id,
    public.ensure_workspace_usage_period(message.workspace_id, message.occurred_at),
    'outbound_emails',
    1,
    'messages',
    'message:' || message.id::text,
    'communication_message',
    message.id::text,
    message.occurred_at,
    jsonb_build_object('channel', message.channel, 'thread_id', message.thread_id, 'delivery_evidence', 'recorded_outbound_message', 'reconciled', true)
  from public.messages message
  where message.workspace_id = p_workspace_id
    and message.direction = 'outbound'
    and message.channel = 'Email'
    and message.draft_state = 'none'
    and message.occurred_at >= v_period_start
    and message.occurred_at < v_period_end
  on conflict (workspace_id, metric_key, idempotency_key) do nothing;
  get diagnostics v_email_count = row_count;

  return jsonb_build_object(
    'workspaceId', p_workspace_id,
    'periodStart', v_period_start,
    'periodEnd', v_period_end,
    'automationEventsRecovered', v_automation_count,
    'emailEventsRecovered', v_email_count
  );
end;
$function$;

revoke all on function public.reconcile_workspace_usage_events(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.reconcile_workspace_usage_events(uuid,timestamptz) to service_role;

create or replace function public.get_founder_workspace_usage_snapshot(
  p_workspace_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period public.workspace_usage_periods%rowtype;
  v_storage_bytes numeric := 0;
  v_active_users numeric := 0;
  v_invited_users numeric := 0;
  v_automation numeric := 0;
  v_emails numeric := 0;
  v_sms numeric := 0;
  v_baselines jsonb := '{}'::jsonb;
  v_indicators jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.workspaces workspace where workspace.id = p_workspace_id) then
    raise exception 'Workspace not found';
  end if;

  perform public.reconcile_workspace_usage_events(p_workspace_id, p_at);

  select period.*
  into v_period
  from public.workspace_usage_periods period
  where period.id = public.ensure_workspace_usage_period(p_workspace_id, p_at);

  select coalesce(sum(
    case
      when coalesce(object.metadata->>'size', '') ~ '^[0-9]+$' then (object.metadata->>'size')::numeric
      else 0
    end
  ), 0)
  into v_storage_bytes
  from storage.objects object
  where object.bucket_id in ('workspace-documents','workspace-assets')
    and object.name like p_workspace_id::text || '/%';

  select
    count(*) filter (where membership.status::text = 'active'),
    count(*) filter (where membership.status::text = 'invited')
  into v_active_users, v_invited_users
  from public.workspace_memberships membership
  where membership.workspace_id = p_workspace_id;

  select
    coalesce(sum(event.quantity) filter (where event.metric_key = 'automation_executions'), 0),
    coalesce(sum(event.quantity) filter (where event.metric_key = 'outbound_emails'), 0),
    coalesce(sum(event.quantity) filter (where event.metric_key = 'sms_segments'), 0)
  into v_automation, v_emails, v_sms
  from public.workspace_usage_events event
  where event.usage_period_id = v_period.id;

  select coalesce(jsonb_object_agg(
    baseline.metric_key,
    jsonb_build_object(
      'quantity', baseline.quantity,
      'unit', baseline.unit,
      'captured_at', baseline.captured_at,
      'source', baseline.source
    )
  ), '{}'::jsonb)
  into v_baselines
  from public.workspace_usage_baselines baseline
  where baseline.workspace_id = p_workspace_id;

  select jsonb_build_object(
    'customers_total', (select count(*) from public.customers customer where customer.workspace_id = p_workspace_id),
    'documents_total', (select count(*) from public.documents document where document.workspace_id = p_workspace_id),
    'sales_in_period', (select count(*) from public.sales sale where sale.workspace_id = p_workspace_id and sale.occurred_at >= v_period.period_start and sale.occurred_at < v_period.period_end),
    'invoices_in_period', (select count(*) from public.invoices invoice where invoice.workspace_id = p_workspace_id and invoice.created_at >= v_period.period_start and invoice.created_at < v_period.period_end),
    'appointments_in_period', (select count(*) from public.bookings booking where booking.workspace_id = p_workspace_id and booking.created_at >= v_period.period_start and booking.created_at < v_period.period_end),
    'communications_in_period', (select count(*) from public.messages message where message.workspace_id = p_workspace_id and message.created_at >= v_period.period_start and message.created_at < v_period.period_end),
    'operator_runs_in_period', (select count(*) from public.operator_runs run where run.workspace_id = p_workspace_id and run.created_at >= v_period.period_start and run.created_at < v_period.period_end)
  ) into v_indicators;

  return jsonb_build_object(
    'workspaceId', p_workspace_id,
    'period', jsonb_build_object(
      'id', v_period.id,
      'start', v_period.period_start,
      'end', v_period.period_end,
      'planId', v_period.plan_id_snapshot,
      'planCode', v_period.plan_code_snapshot,
      'planName', v_period.plan_name_snapshot,
      'allowances', v_period.allowances_snapshot,
      'measurementStartedAt', v_period.measurement_started_at
    ),
    'measured', jsonb_build_object(
      'storage_bytes', v_storage_bytes,
      'active_users', v_active_users,
      'automation_executions', v_automation,
      'outbound_emails', v_emails,
      'sms_segments', v_sms
    ),
    'context', jsonb_build_object('invited_users', v_invited_users),
    'baselines', v_baselines,
    'indicators', v_indicators,
    'sources', jsonb_build_object(
      'storage_bytes', 'live_private_storage_objects',
      'active_users', 'live_workspace_memberships',
      'automation_executions', 'operator_runs',
      'outbound_emails', 'recorded_outbound_email_messages',
      'sms_segments', 'not_connected'
    )
  );
end;
$function$;

revoke all on function public.get_founder_workspace_usage_snapshot(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.get_founder_workspace_usage_snapshot(uuid,timestamptz) to service_role;

-- Capture trustworthy point-in-time baselines at metering installation. These
-- are state snapshots only and are never presented as reconstructed history.
insert into public.workspace_usage_baselines (
  workspace_id, metric_key, quantity, unit, captured_at, source, metadata
)
select
  workspace.id,
  'active_users',
  (select count(*) from public.workspace_memberships membership where membership.workspace_id = workspace.id and membership.status::text = 'active'),
  'users',
  now(),
  'workspace_memberships',
  jsonb_build_object('baseline_type', 'point_in_time')
from public.workspaces workspace
on conflict (workspace_id, metric_key) do nothing;

insert into public.workspace_usage_baselines (
  workspace_id, metric_key, quantity, unit, captured_at, source, metadata
)
select
  workspace.id,
  'storage_bytes',
  coalesce((
    select sum(
      case
        when coalesce(object.metadata->>'size', '') ~ '^[0-9]+$' then (object.metadata->>'size')::numeric
        else 0
      end
    )
    from storage.objects object
    where object.bucket_id in ('workspace-documents','workspace-assets')
      and object.name like workspace.id::text || '/%'
  ), 0),
  'bytes',
  now(),
  'private_storage_objects',
  jsonb_build_object('baseline_type', 'point_in_time')
from public.workspaces workspace
on conflict (workspace_id, metric_key) do nothing;

commit;