begin;

create or replace view public.supplier_account_balances
with (security_invoker = true)
as
with party_keys as (
  select payable.workspace_id, payable.supplier_id, payable.currency
  from public.supplier_payables payable
  group by payable.workspace_id, payable.supplier_id, payable.currency
  union
  select payment.workspace_id, payment.supplier_id, payment.currency
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
       supplier.code::text as supplier_code,
       supplier.name as supplier_name,
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
join public.suppliers supplier
  on supplier.workspace_id = party.workspace_id
 and supplier.id = party.supplier_id
left join payable_totals payable
  on payable.workspace_id = party.workspace_id
 and payable.supplier_id = party.supplier_id
 and payable.currency = party.currency
left join payment_totals payment
  on payment.workspace_id = party.workspace_id
 and payment.supplier_id = party.supplier_id
 and payment.currency = party.currency;

comment on view public.supplier_account_balances is
  'Derived Supplier balance by canonical Supplier identity and currency. Historical snapshots cannot create duplicate balance rows.';

commit;
