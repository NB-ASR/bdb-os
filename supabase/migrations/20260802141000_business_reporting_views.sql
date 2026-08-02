begin;

create or replace view public.business_report_monthly_sales
with (security_invoker = true)
as
select sale.workspace_id,
       date_trunc('month', coalesce(sale.completed_at, sale.occurred_at))::date as month_start,
       sale.currency,
       count(*)::integer as completed_sale_count,
       round(sum(sale.total_amount), 4)::numeric(16,4) as completed_sale_amount
from public.sales sale
where sale.status = 'completed'
group by sale.workspace_id,
         date_trunc('month', coalesce(sale.completed_at, sale.occurred_at))::date,
         sale.currency;

create or replace view public.business_report_customer_sales
with (security_invoker = true)
as
select sale.workspace_id,
       sale.customer_id,
       customer.code as customer_code,
       customer.name as customer_name,
       sale.currency,
       count(*)::integer as completed_sale_count,
       round(sum(sale.total_amount), 4)::numeric(16,4) as completed_sale_amount,
       max(coalesce(sale.completed_at, sale.occurred_at)) as last_sale_at
from public.sales sale
join public.customers customer
  on customer.workspace_id = sale.workspace_id
 and customer.id = sale.customer_id
where sale.status = 'completed'
  and sale.customer_id is not null
group by sale.workspace_id, sale.customer_id, customer.code, customer.name, sale.currency;

revoke all on public.business_report_monthly_sales from public, anon, authenticated;
grant select on public.business_report_monthly_sales to authenticated;
revoke all on public.business_report_customer_sales from public, anon, authenticated;
grant select on public.business_report_customer_sales to authenticated;

comment on view public.business_report_monthly_sales is
  'Completed Sales by month and currency for Version 1 Reporting.';
comment on view public.business_report_customer_sales is
  'Completed Sales by Customer and currency for Version 1 Reporting.';

commit;
