begin;

-- The established Sales index already covers workspace, Customer and occurrence time.
drop index if exists public.sales_customer_activity_idx;

comment on index public.sales_workspace_customer_time_idx is
  'Canonical workspace and Customer Sale activity index, reused by Customer 360.';

commit;
