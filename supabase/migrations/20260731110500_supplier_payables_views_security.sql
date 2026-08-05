begin;

create or replace view public.supplier_payable_balances
with (security_invoker = true)
as
with payment_totals as (
  select allocation.workspace_id,
         allocation.supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_payment_amount
  from public.supplier_payment_allocations allocation
  join public.supplier_payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.supplier_payment_id
  where payment.status = 'posted'
  group by allocation.workspace_id, allocation.supplier_payable_id
), invoice_credit_totals as (
  select allocation.workspace_id,
         allocation.invoice_payable_id as supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_credit_amount
  from public.supplier_credit_allocations allocation
  join public.supplier_payables credit
    on credit.workspace_id = allocation.workspace_id
   and credit.id = allocation.credit_payable_id
  where credit.status = 'posted'
  group by allocation.workspace_id, allocation.invoice_payable_id
), credit_used_totals as (
  select allocation.workspace_id,
         allocation.credit_payable_id as supplier_payable_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as used_credit_amount
  from public.supplier_credit_allocations allocation
  join public.supplier_payables invoice
    on invoice.workspace_id = allocation.workspace_id
   and invoice.id = allocation.invoice_payable_id
  where invoice.status = 'posted'
  group by allocation.workspace_id, allocation.credit_payable_id
)
select payable.*,
       case when payable.document_type = 'invoice' and payable.status = 'posted'
         then coalesce(payment.allocated_payment_amount, 0)
         else 0
       end::numeric(14,4) as allocated_payment_amount,
       case when payable.document_type = 'invoice' and payable.status = 'posted'
         then coalesce(credit.allocated_credit_amount, 0)
         else 0
       end::numeric(14,4) as allocated_credit_amount,
       case
         when payable.status <> 'posted' then 0
         when payable.document_type = 'invoice'
           then round(coalesce(payment.allocated_payment_amount, 0) + coalesce(credit.allocated_credit_amount, 0), 4)
         else coalesce(used.used_credit_amount, 0)
       end::numeric(14,4) as allocated_amount,
       case when payable.status = 'posted' and payable.document_type = 'invoice'
         then greatest(round(payable.amount - coalesce(payment.allocated_payment_amount, 0) - coalesce(credit.allocated_credit_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as outstanding_amount,
       case when payable.status = 'posted' and payable.document_type = 'credit_note'
         then greatest(round(payable.amount - coalesce(used.used_credit_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_credit,
       case
         when payable.status = 'reversed' then 'reversed'
         when payable.document_type = 'credit_note' and greatest(round(payable.amount - coalesce(used.used_credit_amount, 0), 4), 0) = 0 then 'credit_used'
         when payable.document_type = 'credit_note' then 'credit_available'
         when greatest(round(payable.amount - coalesce(payment.allocated_payment_amount, 0) - coalesce(credit.allocated_credit_amount, 0), 4), 0) = 0 then 'paid'
         when round(coalesce(payment.allocated_payment_amount, 0) + coalesce(credit.allocated_credit_amount, 0), 4) > 0 then 'partially_paid'
         when payable.due_date < current_date then 'overdue'
         else 'unpaid'
       end as settlement_status
from public.supplier_payables payable
left join payment_totals payment
  on payment.workspace_id = payable.workspace_id
 and payment.supplier_payable_id = payable.id
left join invoice_credit_totals credit
  on credit.workspace_id = payable.workspace_id
 and credit.supplier_payable_id = payable.id
left join credit_used_totals used
  on used.workspace_id = payable.workspace_id
 and used.supplier_payable_id = payable.id;

create or replace view public.supplier_payment_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.supplier_payment_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.supplier_payment_allocations allocation
  group by allocation.workspace_id, allocation.supplier_payment_id
)
select payment.*,
       case when payment.status = 'posted' then coalesce(total.allocated_amount, 0) else 0 end::numeric(14,4) as allocated_amount,
       case when payment.status = 'posted'
         then greatest(round(payment.amount - coalesce(total.allocated_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_amount
from public.supplier_payments payment
left join allocation_totals total
  on total.workspace_id = payment.workspace_id
 and total.supplier_payment_id = payment.id;

create or replace view public.supplier_account_balances
with (security_invoker = true)
as
with party_keys as (
  select payable.workspace_id, payable.supplier_id, payable.currency,
         max(payable.supplier_code_snapshot) as supplier_code,
         max(payable.supplier_name_snapshot) as supplier_name
  from public.supplier_payables payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
  union
  select payment.workspace_id, payment.supplier_id, payment.currency,
         max(payment.supplier_code_snapshot) as supplier_code,
         max(payment.supplier_name_snapshot) as supplier_name
  from public.supplier_payments payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
), payable_totals as (
  select payable.workspace_id,
         payable.supplier_id,
         payable.currency,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.amount else 0 end), 4) as posted_invoice_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_payment_amount else 0 end), 4) as allocated_payment_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.allocated_credit_amount else 0 end), 4) as allocated_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'invoice' then payable.outstanding_amount else 0 end), 4) as outstanding_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.amount else 0 end), 4) as supplier_credit_amount,
         round(sum(case when payable.status = 'posted' and payable.document_type = 'credit_note' then payable.unallocated_credit else 0 end), 4) as unallocated_credit
  from public.supplier_payable_balances payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
), payment_totals as (
  select payment.workspace_id,
         payment.supplier_id,
         payment.currency,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as payments_sent,
         round(sum(payment.unallocated_amount), 4) as unallocated_payment
  from public.supplier_payment_balances payment
  group by payment.workspace_id, payment.supplier_id, payment.currency
)
select party.workspace_id,
       party.supplier_id,
       party.supplier_code,
       party.supplier_name,
       party.currency,
       coalesce(payable.posted_invoice_amount, 0)::numeric(14,4) as posted_invoice_amount,
       coalesce(payment.payments_sent, 0)::numeric(14,4) as payments_sent,
       coalesce(payable.allocated_payment_amount, 0)::numeric(14,4) as allocated_payment_amount,
       coalesce(payable.allocated_credit_amount, 0)::numeric(14,4) as allocated_credit_amount,
       coalesce(payable.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.unallocated_payment, 0)::numeric(14,4) as unallocated_payment,
       coalesce(payable.supplier_credit_amount, 0)::numeric(14,4) as supplier_credit_amount,
       coalesce(payable.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(
         coalesce(payable.outstanding_amount, 0)
         - coalesce(payment.unallocated_payment, 0)
         - coalesce(payable.unallocated_credit, 0),
         4
       )::numeric(14,4) as net_balance,
       case
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(payable.outstanding_amount, 0) - coalesce(payment.unallocated_payment, 0) - coalesce(payable.unallocated_credit, 0), 4) < 0 then 'supplier_credit'
         else 'clear'
       end as balance_status
from party_keys party
left join payable_totals payable
  on payable.workspace_id = party.workspace_id
 and payable.supplier_id = party.supplier_id
 and payable.currency = party.currency
left join payment_totals payment
  on payment.workspace_id = party.workspace_id
 and payment.supplier_id = party.supplier_id
 and payment.currency = party.currency;

alter table public.supplier_payables enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;
alter table public.supplier_credit_allocations enable row level security;
alter table public.supplier_accounts_command_receipts enable row level security;

create policy "Supplier payables Accounts read"
on public.supplier_payables for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier Payments Accounts read"
on public.supplier_payments for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier Payment allocations Accounts read"
on public.supplier_payment_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Supplier credit allocations Accounts read"
on public.supplier_credit_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

revoke all on public.supplier_payables from anon, authenticated;
grant select on public.supplier_payables to authenticated;
revoke all on public.supplier_payments from anon, authenticated;
grant select on public.supplier_payments to authenticated;
revoke all on public.supplier_payment_allocations from anon, authenticated;
grant select on public.supplier_payment_allocations to authenticated;
revoke all on public.supplier_credit_allocations from anon, authenticated;
grant select on public.supplier_credit_allocations to authenticated;
revoke all on public.supplier_accounts_command_receipts from anon, authenticated;

revoke all on public.supplier_payable_balances from anon;
revoke all on public.supplier_payment_balances from anon;
revoke all on public.supplier_account_balances from anon;
grant select on public.supplier_payable_balances to authenticated;
grant select on public.supplier_payment_balances to authenticated;
grant select on public.supplier_account_balances to authenticated;

comment on view public.supplier_payable_balances is
  'Derived Supplier invoice outstanding amounts and unallocated Supplier credit-note balances.';
comment on view public.supplier_payment_balances is
  'Derived allocated and unallocated amounts for immutable outgoing Supplier Payments.';
comment on view public.supplier_account_balances is
  'Derived Supplier balance by currency. Positive net balance is owed to the Supplier; negative is Supplier credit or prepayment.';

commit;
