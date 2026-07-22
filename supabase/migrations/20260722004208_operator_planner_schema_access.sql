begin;

grant usage on schema private to service_role;

comment on function public.plan_due_operator_runs(integer) is
  'Service-role-only deterministic planner. Canonical bookings, overdue invoices and messages become durable work without an open browser. The worker has explicit USAGE on the private authorization-helper schema.';

commit;
