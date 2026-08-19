begin;

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation_1.workspace_id,
         allocation_1.invoice_id,
         round(coalesce(sum(allocation_1.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation_1
  join public.payments payment
    on payment.workspace_id = allocation_1.workspace_id
   and payment.id = allocation_1.payment_id
  where payment.status = 'posted'
  group by allocation_1.workspace_id, allocation_1.invoice_id
), credit_totals as (
  select credit_notes.workspace_id,
         credit_notes.invoice_id,
         round(coalesce(sum(credit_notes.total_amount), 0), 4) as credited_amount
  from public.credit_notes
  where credit_notes.status = 'issued'
  group by credit_notes.workspace_id, credit_notes.invoice_id
)
select invoice.id,
       invoice.workspace_id,
       invoice.number,
       invoice.customer_id,
       invoice.issued_at,
       invoice.due_at,
       invoice.description,
       invoice.amount,
       invoice.status,
       invoice.created_at,
       invoice.updated_at,
       invoice.source_sale_id,
       invoice.currency,
       invoice.customer_code_snapshot,
       invoice.customer_name_snapshot,
       invoice.gross_amount,
       invoice.discount_amount,
       invoice.net_amount,
       invoice.vat_amount,
       invoice.total_amount,
       invoice.notes,
       invoice.version,
       invoice.created_by,
       invoice.updated_by,
       invoice.issued_by,
       invoice.sent_at,
       invoice.voided_at,
       invoice.voided_by,
       invoice.void_reason,
       coalesce(allocation.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       (case
          when invoice.status::text in ('draft','void') then 0
          else greatest(round(invoice.total_amount - coalesce(credit.credited_amount,0) - coalesce(allocation.allocated_amount,0),4),0)
        end)::numeric(14,4) as outstanding_amount,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when coalesce(credit.credited_amount,0) >= invoice.total_amount then 'cancelled'
         when greatest(round(invoice.total_amount - coalesce(credit.credited_amount,0) - coalesce(allocation.allocated_amount,0),4),0) = 0 then 'paid'
         when coalesce(allocation.allocated_amount,0) > 0 then 'partially_paid'
         else 'unpaid'
       end as payment_status,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when coalesce(credit.credited_amount,0) >= invoice.total_amount then 'cancelled'
         when greatest(round(invoice.total_amount - coalesce(credit.credited_amount,0) - coalesce(allocation.allocated_amount,0),4),0) = 0 then 'paid'
         when invoice.due_at < current_date then 'overdue'
         else 'sent'
       end as display_status,
       invoice.supplier_name_snapshot,
       invoice.supplier_address_snapshot,
       invoice.supplier_vat_number_snapshot,
       invoice.supplier_registration_number_snapshot,
       invoice.customer_address_snapshot,
       invoice.customer_vat_number_snapshot,
       invoice.supply_date,
       invoice.legal_snapshot_at,
       invoice.final_number_assigned_at,
       coalesce(credit.credited_amount,0)::numeric(14,4) as credited_amount,
       greatest(round(invoice.total_amount - coalesce(credit.credited_amount,0),4),0)::numeric(14,4) as adjusted_total_amount,
       (case
          when invoice.status::text in ('draft','void') then 0
          else greatest(round(coalesce(allocation.allocated_amount,0) - greatest(invoice.total_amount - coalesce(credit.credited_amount,0),0),4),0)
        end)::numeric(14,4) as overallocated_credit
from public.invoices invoice
left join allocation_totals allocation
  on allocation.workspace_id = invoice.workspace_id
 and allocation.invoice_id = invoice.id
left join credit_totals credit
  on credit.workspace_id = invoice.workspace_id
 and credit.invoice_id = invoice.id;

grant select on public.invoice_account_balances to authenticated;

commit;
