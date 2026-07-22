begin;

grant execute on function private.has_feature(uuid, text) to service_role;
grant execute on function private.operator_workflow_is_published(uuid, text) to service_role;

create or replace function public.plan_due_operator_runs(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  run public.operator_runs%rowtype;
  planned_count integer := 0;
  prepared_count integer := 0;
  approval_count integer := 0;
  queued_count integer := 0;
  initial_status text;
  actor_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operator planner access denied' using errcode = '42501';
  end if;

  -- Two overlapping cron invocations must not plan the same source record.
  perform pg_advisory_xact_lock(hashtextextended('bdb-operator-planner', 0));

  for candidate in
    with candidates as (
      select
        policy.workspace_id,
        policy.workflow_key,
        policy.autonomy_mode,
        policy.provider_mode,
        'booking'::text as source_type,
        booking.id::text as source_id,
        'low'::text as risk_level,
        6::numeric as estimated_minutes,
        (booking.booking_date + booking.booking_time)::timestamptz as due_at,
        jsonb_build_object(
          'action', 'send_appointment_reminder',
          'title', 'Appointment reminder for ' || customer.name,
          'detail', booking.title || ' · ' || booking.booking_date || ' at ' || left(booking.booking_time::text, 5),
          'recordLabel', booking.booking_date || ' · ' || left(booking.booking_time::text, 5),
          'booking', jsonb_build_object(
            'id', booking.id,
            'title', booking.title,
            'date', booking.booking_date,
            'time', left(booking.booking_time::text, 5),
            'durationMinutes', booking.duration_minutes,
            'status', booking.status
          ),
          'recipient', jsonb_build_object(
            'customerId', customer.id,
            'name', customer.name,
            'email', customer.email,
            'phone', customer.phone
          )
        ) as planned_action
      from public.operator_policies policy
      join public.workspaces workspace
        on workspace.id = policy.workspace_id
       and workspace.status in ('trial', 'active')
      join public.bookings booking
        on booking.workspace_id = policy.workspace_id
       and policy.workflow_key = 'appointment-reminders'
       and booking.status = 'confirmed'
       and booking.booking_date + booking.booking_time >= localtimestamp + interval '45 minutes'
       and booking.booking_date + booking.booking_time <= localtimestamp + interval '24 hours'
      join public.customers customer
        on customer.id = booking.customer_id
       and customer.workspace_id = booking.workspace_id
      where policy.enabled
        and private.has_feature(policy.workspace_id, 'operator')
        and private.operator_workflow_is_published(policy.workspace_id, policy.workflow_key)

      union all

      select
        policy.workspace_id,
        policy.workflow_key,
        policy.autonomy_mode,
        policy.provider_mode,
        'invoice'::text,
        invoice.id::text,
        'high'::text,
        12::numeric,
        invoice.due_at::timestamptz,
        jsonb_build_object(
          'action', 'prepare_overdue_invoice_follow_up',
          'title', 'Overdue invoice follow-up for ' || customer.name,
          'detail', invoice.number || ' · due ' || invoice.due_at,
          'recordLabel', invoice.number,
          'cashProtected', invoice.amount,
          'invoice', jsonb_build_object(
            'id', invoice.id,
            'number', invoice.number,
            'dueAt', invoice.due_at,
            'amount', invoice.amount,
            'description', invoice.description,
            'status', invoice.status
          ),
          'recipient', jsonb_build_object(
            'customerId', customer.id,
            'name', customer.name,
            'email', customer.email,
            'phone', customer.phone
          )
        )
      from public.operator_policies policy
      join public.workspaces workspace
        on workspace.id = policy.workspace_id
       and workspace.status in ('trial', 'active')
      join public.invoices invoice
        on invoice.workspace_id = policy.workspace_id
       and policy.workflow_key = 'overdue-invoice-follow-up'
       and invoice.status = 'overdue'
      join public.customers customer
        on customer.id = invoice.customer_id
       and customer.workspace_id = invoice.workspace_id
      where policy.enabled
        and private.has_feature(policy.workspace_id, 'operator')
        and private.operator_workflow_is_published(policy.workspace_id, policy.workflow_key)

      union all

      select
        policy.workspace_id,
        policy.workflow_key,
        policy.autonomy_mode,
        policy.provider_mode,
        'message'::text,
        message.id::text,
        case when message.status = 'approval' then 'high' else 'medium' end,
        10::numeric,
        message.occurred_at,
        jsonb_build_object(
          'action', 'prepare_enquiry_response',
          'title', 'Triage enquiry from ' || customer.name,
          'detail', message.channel || ' · ' || message.subject,
          'recordLabel', message.subject,
          'message', jsonb_build_object(
            'id', message.id,
            'channel', message.channel,
            'subject', message.subject,
            'preview', message.preview,
            'occurredAt', message.occurred_at,
            'status', message.status
          ),
          'recipient', jsonb_build_object(
            'customerId', customer.id,
            'name', customer.name,
            'email', customer.email,
            'phone', customer.phone
          )
        )
      from public.operator_policies policy
      join public.workspaces workspace
        on workspace.id = policy.workspace_id
       and workspace.status in ('trial', 'active')
      join public.messages message
        on message.workspace_id = policy.workspace_id
       and policy.workflow_key = 'new-enquiry-triage'
       and (message.unread or message.status in ('open', 'approval'))
      join public.customers customer
        on customer.id = message.customer_id
       and customer.workspace_id = message.workspace_id
      where policy.enabled
        and private.has_feature(policy.workspace_id, 'operator')
        and private.operator_workflow_is_published(policy.workspace_id, policy.workflow_key)
    )
    select source.*
    from candidates source
    where not exists (
      select 1
      from public.operator_runs existing
      where existing.workspace_id = source.workspace_id
        and existing.workflow_key = source.workflow_key
        and existing.source_type = source.source_type
        and existing.source_id = source.source_id
    )
    order by source.due_at, source.workspace_id, source.source_id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    initial_status := case candidate.autonomy_mode
      when 'assist' then 'prepared'
      when 'approval' then 'awaiting_approval'
      when 'bounded' then case
        when candidate.workflow_key = 'appointment-reminders' and candidate.risk_level = 'low' then 'queued'
        else 'awaiting_approval'
      end
    end;
    actor_id := (
      select membership.user_id
      from public.workspace_memberships membership
      where membership.workspace_id = candidate.workspace_id
        and membership.status = 'active'
      order by case membership.access_profile when 'owner' then 0 when 'manager' then 1 else 2 end,
               membership.created_at,
               membership.user_id
      limit 1
    );
    run := null;

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
      candidate.workspace_id,
      candidate.workflow_key,
      candidate.source_type,
      candidate.source_id,
      initial_status,
      candidate.autonomy_mode,
      candidate.provider_mode,
      candidate.risk_level,
      left('auto:' || candidate.workflow_key || ':' || candidate.source_id, 128),
      candidate.planned_action,
      candidate.estimated_minutes,
      actor_id
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning * into run;

    if run.id is null then continue; end if;

    if initial_status = 'awaiting_approval' then
      insert into public.operator_approvals (
        workspace_id, run_id, requested_from, expires_at
      ) values (
        candidate.workspace_id, run.id, actor_id, now() + interval '24 hours'
      );
      approval_count := approval_count + 1;
    elsif initial_status = 'prepared' then
      prepared_count := prepared_count + 1;
    elsif initial_status = 'queued' then
      queued_count := queued_count + 1;
    end if;

    insert into public.activity_items (
      workspace_id, actor_user_id, action, detail, tone,
      entity_type, entity_id, command_id, metadata
    ) values (
      candidate.workspace_id,
      actor_id,
      'operator.run_planned_automatically',
      coalesce(candidate.planned_action ->> 'title', candidate.workflow_key),
      'gold',
      'operator_run',
      run.id::text,
      run.id,
      jsonb_build_object(
        'workflow_key', candidate.workflow_key,
        'status', initial_status,
        'source_type', candidate.source_type,
        'source_id', candidate.source_id
      )
    );
    planned_count := planned_count + 1;
  end loop;

  return jsonb_build_object(
    'planned', planned_count,
    'prepared', prepared_count,
    'awaitingApproval', approval_count,
    'queued', queued_count
  );
end;
$$;

revoke all on function public.plan_due_operator_runs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.plan_due_operator_runs(integer) to service_role;

comment on function public.plan_due_operator_runs(integer) is
  'Service-role-only deterministic planner. Canonical bookings, overdue invoices and messages become durable work without requiring an open browser tab.';

commit;
