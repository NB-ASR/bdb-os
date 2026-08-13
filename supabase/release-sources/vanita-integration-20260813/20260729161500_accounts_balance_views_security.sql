begin;

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.payment_id
  where payment.status = 'posted'
  group by allocation.workspace_id, allocation.invoice_id
)
select invoice.*,
       coalesce(total.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0)::numeric(14,4) as outstanding_amount,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0) = 0 then 'paid'
         when coalesce(total.allocated_amount, 0) > 0 then 'partially_paid'
         else 'unpaid'
       end as payment_status,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0) = 0 then 'paid'
         when invoice.due_at < current_date then 'overdue'
         else 'sent'
       end as display_status
from public.invoices invoice
left join allocation_totals total
  on total.workspace_id = invoice.workspace_id
 and total.invoice_id = invoice.id;

create or replace view public.payment_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.payment_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  group by allocation.workspace_id, allocation.payment_id
)
select payment.*,
       case when payment.status = 'posted' then coalesce(total.allocated_amount, 0) else 0 end::numeric(14,4) as allocated_amount,
       case when payment.status = 'posted'
         then greatest(round(payment.amount - coalesce(total.allocated_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_amount
from public.payments payment
left join allocation_totals total
  on total.workspace_id = payment.workspace_id
 and total.payment_id = payment.id;

create or replace view public.customer_account_balances
with (security_invoker = true)
as
with invoice_totals as (
  select invoice.workspace_id,
         invoice.customer_id,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.total_amount else 0 end), 4) as issued_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.allocated_amount else 0 end), 4) as allocated_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.outstanding_amount else 0 end), 4) as outstanding_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id
), payment_totals as (
  select payment.workspace_id,
         payment.customer_id,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as received_amount,
         round(sum(payment.unallocated_amount), 4) as unallocated_credit
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id
)
select customer.workspace_id,
       customer.id as customer_id,
       customer.code as customer_code,
       customer.name as customer_name,
       customer.company,
       coalesce(invoice.issued_amount, 0)::numeric(14,4) as issued_amount,
       coalesce(payment.received_amount, 0)::numeric(14,4) as received_amount,
       coalesce(invoice.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       coalesce(invoice.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4)::numeric(14,4) as net_balance,
       case
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) < 0 then 'customer_credit'
         else 'clear'
       end as balance_status
from public.customers customer
left join invoice_totals invoice
  on invoice.workspace_id = customer.workspace_id
 and invoice.customer_id = customer.id
left join payment_totals payment
  on payment.workspace_id = customer.workspace_id
 and payment.customer_id = customer.id;

create or replace view public.sale_account_status
with (security_invoker = true)
as
select sale.workspace_id,
       sale.id as sale_id,
       sale.reference as sale_reference,
       sale.customer_id,
       sale.currency,
       sale.total_amount as sale_total_amount,
       invoice.id as invoice_id,
       invoice.number as invoice_number,
       invoice.display_status as invoice_status,
       invoice.allocated_amount,
       invoice.outstanding_amount,
       case
         when sale.status = 'reversed' then 'reversed'
         when invoice.id is null then 'not_invoiced'
         when invoice.display_status = 'void' then 'invoice_void'
         when invoice.outstanding_amount = 0 then 'paid'
         when invoice.allocated_amount > 0 then 'partially_paid'
         else 'invoiced'
       end as account_status
from public.sales sale
left join lateral (
  select balance.*
  from public.invoice_account_balances balance
  where balance.workspace_id = sale.workspace_id
    and balance.source_sale_id = sale.id
  order by (balance.status <> 'void'::public.invoice_status) desc, balance.created_at desc
  limit 1
) invoice on true;

alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.accounts_command_receipts enable row level security;

drop policy if exists "Accounts permission insert" on public.invoices;
drop policy if exists "Accounts permission update" on public.invoices;
drop policy if exists "Accounts permission delete" on public.invoices;
drop policy if exists "Accounts permission read" on public.invoices;
create policy "Accounts permission read" on public.invoices for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Invoice lines permission read" on public.invoice_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Payments permission read" on public.payments for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Payment allocations permission read" on public.payment_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
revoke all on public.invoice_lines from anon, authenticated;
grant select on public.invoice_lines to authenticated;
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
revoke all on public.payment_allocations from anon, authenticated;
grant select on public.payment_allocations to authenticated;
revoke all on public.accounts_command_receipts from anon, authenticated;
revoke all on public.invoice_account_balances from anon;
revoke all on public.payment_account_balances from anon;
revoke all on public.customer_account_balances from anon;
revoke all on public.sale_account_status from anon;
grant select on public.invoice_account_balances to authenticated;
grant select on public.payment_account_balances to authenticated;
grant select on public.customer_account_balances to authenticated;
grant select on public.sale_account_status to authenticated;

commit;
