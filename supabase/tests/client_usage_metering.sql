begin;

select plan(35);

select has_table('public', 'plan_usage_allowances', 'Plan usage allowances table exists');
select has_table('public', 'workspace_usage_periods', 'Workspace usage periods table exists');
select has_table('public', 'workspace_usage_events', 'Workspace usage event ledger exists');
select has_table('public', 'workspace_usage_baselines', 'Workspace usage baselines table exists');
select has_function('public', 'ensure_workspace_usage_period', array['uuid','timestamp with time zone'], 'Usage period function exists');
select has_function('public', 'record_workspace_usage_event', array['uuid','text','numeric','text','text','text','text','timestamp with time zone','jsonb'], 'Usage event recorder exists');
select has_function('public', 'reconcile_workspace_usage_events', array['uuid','timestamp with time zone'], 'Usage reconciliation function exists');
select has_function('public', 'get_founder_workspace_usage_snapshot', array['uuid','timestamp with time zone'], 'Founder usage snapshot function exists');

select ok((select relrowsecurity from pg_class where oid='public.workspace_usage_events'::regclass), 'Usage event ledger has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.workspace_usage_periods'::regclass), 'Usage periods have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.plan_usage_allowances'::regclass), 'Plan allowances have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.workspace_usage_baselines'::regclass), 'Usage baselines have RLS enabled');
select ok(not has_table_privilege('anon','public.workspace_usage_events','SELECT'), 'Anonymous users cannot read usage events');
select ok(has_table_privilege('authenticated','public.workspace_usage_events','SELECT'), 'Authenticated access is available only through Founder RLS');
select ok(position('private.is_platform_admin' in coalesce((select lower(qual) from pg_policies where schemaname='public' and tablename='workspace_usage_events' limit 1),'')) > 0, 'Usage event visibility is restricted to Platform Admins');
select ok(not has_function_privilege('authenticated','public.get_founder_workspace_usage_snapshot(uuid,timestamp with time zone)','EXECUTE'), 'Client sessions cannot execute Founder usage summaries');
select ok(has_function_privilege('service_role','public.get_founder_workspace_usage_snapshot(uuid,timestamp with time zone)','EXECUTE'), 'Service role can execute Founder usage summaries');
select ok(not has_function_privilege('authenticated','public.record_workspace_usage_event(uuid,text,numeric,text,text,text,text,timestamp with time zone,jsonb)','EXECUTE'), 'Client sessions cannot forge usage events');

insert into public.plans (id, code, name, description, pricing_model, sort_order)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'usage_test_plan', 'Usage Test Plan', 'Metering test plan', 'quote', 999);

insert into public.workspaces (id, slug, name, status, plan_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'usage-test-a', 'Usage Test A', 'active', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'usage-test-b', 'Usage Test B', 'active', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

insert into public.plan_usage_allowances (plan_id, metric_key, unit, included_quantity, warning_threshold_percent)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'automation_executions', 'executions', 100, 80),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'outbound_emails', 'messages', 50, 80)
on conflict (plan_id, metric_key) do update
set included_quantity=excluded.included_quantity, warning_threshold_percent=excluded.warning_threshold_percent;

-- Create August first, then inspect it in separate statements so the assertions
-- observe the row written by the side-effecting helper.
select public.ensure_workspace_usage_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-31 23:59:59+00');

select is(
  (select period_start from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-08-01 00:00:00+00'),
  '2026-08-01 00:00:00+00'::timestamptz,
  'Usage period starts at the UTC month boundary'
);

select is(
  (select period_end from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-08-01 00:00:00+00'),
  '2026-09-01 00:00:00+00'::timestamptz,
  'Usage period ends at the next UTC month boundary'
);

select is(
  (select (allowances_snapshot #>> '{automation_executions,included_quantity}')::numeric from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-08-01 00:00:00+00'),
  100::numeric,
  'Usage period snapshots the plan allowance'
);

update public.plan_usage_allowances
set included_quantity=200, updated_at=now()
where plan_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and metric_key='automation_executions';

select public.ensure_workspace_usage_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-15 12:00:00+00');

select is(
  (select (allowances_snapshot #>> '{automation_executions,included_quantity}')::numeric from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-08-01 00:00:00+00'),
  100::numeric,
  'Changing a plan later does not rewrite the existing period allowance snapshot'
);

-- September is first observed only after the plan allowance changes, so it must
-- receive the new value while August remains frozen.
select public.ensure_workspace_usage_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-09-02 12:00:00+00');

select is(
  (select (allowances_snapshot #>> '{automation_executions,included_quantity}')::numeric from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-09-01 00:00:00+00'),
  200::numeric,
  'A new usage period receives the updated allowance'
);

select isnt(
  (select id from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-08-01 00:00:00+00'),
  (select id from public.workspace_usage_periods where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and period_start='2026-09-01 00:00:00+00'),
  'Adjacent billing months use different immutable usage periods'
);

select public.record_workspace_usage_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','automation_executions',1,'executions','test-auto-0001','test','run-a','2026-08-12 10:00:00+00','{}'::jsonb
);
select public.record_workspace_usage_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','automation_executions',1,'executions','test-auto-0001','test','run-a','2026-08-12 10:00:00+00','{}'::jsonb
);

select is(
  (select count(*) from public.workspace_usage_events where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and metric_key='automation_executions' and idempotency_key='test-auto-0001'),
  1::bigint,
  'Repeated idempotency keys cannot double-count usage'
);

select public.record_workspace_usage_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','automation_executions',2,'executions','test-auto-0002','test','run-b','2026-08-12 11:00:00+00','{}'::jsonb
);
select public.record_workspace_usage_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','outbound_emails',3,'messages','test-email-001','test','message-a','2026-08-12 12:00:00+00','{}'::jsonb
);
select public.record_workspace_usage_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','automation_executions',9,'executions','test-auto-other','test','run-other','2026-08-12 12:00:00+00','{}'::jsonb
);

select is(
  (select coalesce(sum(quantity),0) from public.workspace_usage_events where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and metric_key='automation_executions' and occurred_at >= '2026-08-01' and occurred_at < '2026-09-01'),
  3::numeric,
  'Workspace A event aggregation is accurate'
);

select is(
  (select coalesce(sum(quantity),0) from public.workspace_usage_events where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' and metric_key='automation_executions' and occurred_at >= '2026-08-01' and occurred_at < '2026-09-01'),
  9::numeric,
  'Workspace B usage is independent from Workspace A'
);

select is(
  ((public.get_founder_workspace_usage_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-12 12:30:00+00')->'measured'->>'automation_executions')::numeric),
  3::numeric,
  'Founder summary aggregates only the selected workspace automation usage'
);

select is(
  ((public.get_founder_workspace_usage_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-12 12:30:00+00')->'measured'->>'outbound_emails')::numeric),
  3::numeric,
  'Founder summary aggregates outbound email usage'
);

select is(
  ((public.get_founder_workspace_usage_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-12 12:30:00+00')->'measured'->>'sms_segments')::numeric),
  0::numeric,
  'SMS remains zero when no transport has produced usage evidence'
);

select is(
  public.get_founder_workspace_usage_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','2026-08-12 12:30:00+00')->'sources'->>'sms_segments',
  'not_connected',
  'SMS is explicitly reported as not connected rather than inferred'
);

select ok(position('exception when others' in lower(pg_get_functiondef('private.meter_operator_run_usage()'::regprocedure))) > 0, 'Operator metering failure cannot block core Operator execution');
select ok(position('exception when others' in lower(pg_get_functiondef('private.meter_outbound_email_usage()'::regprocedure))) > 0, 'Email metering failure cannot block core Communications work');
select ok(
  to_regclass('public.operator_runs') is null
  or exists (
    select 1 from pg_trigger
    where tgrelid=to_regclass('public.operator_runs')
      and tgname='meter_operator_run_usage'
      and not tgisinternal
  ),
  'Operator usage meter is attached whenever the authoritative Operator table is present'
);
select has_trigger('public','messages','meter_outbound_email_usage','Outbound email meter is attached to authoritative communication records');

select * from finish();
rollback;
