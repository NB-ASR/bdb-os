-- Accounts Engine Hardening V1 — Pass 4: Customer-side register scale closure
--
-- The canonical balance views previously aggregated every Payment allocation and Credit Note
-- in a workspace before applying register LIMIT/cursor ordering. That kept result sets bounded
-- in the browser, but still created an O(workspace ledger) database read path.
--
-- Re-express the same derived balances as per-row LATERAL aggregates so PostgreSQL can walk
-- the existing ordered base-table indexes first and calculate balances only for rows actually
-- visited by the register. No financial posting, allocation, Credit Note, or document history
-- is rewritten by this migration.

create index if not exists customers_workspace_name_cursor_idx
  on public.customers (workspace_id, name, id);

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
select
  invoice.id,
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
  case
    when invoice.status::text in ('draft', 'void') then 0
    else greatest(
      round(
        invoice.total_amount
        - coalesce(credit.credited_amount, 0)
        - coalesce(allocation.allocated_amount, 0),
        4
      ),
      0
    )
  end::numeric(14,4) as outstanding_amount,
  case
    when invoice.status::text = 'void' then 'void'
    when invoice.status::text = 'draft' then 'draft'
    when coalesce(credit.credited_amount, 0) >= invoice.total_amount then 'cancelled'
    when greatest(
      round(
        invoice.total_amount
        - coalesce(credit.credited_amount, 0)
        - coalesce(allocation.allocated_amount, 0),
        4
      ),
      0
    ) = 0 then 'paid'
    when coalesce(allocation.allocated_amount, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as payment_status,
  case
    when invoice.status::text = 'void' then 'void'
    when invoice.status::text = 'draft' then 'draft'
    when coalesce(credit.credited_amount, 0) >= invoice.total_amount then 'cancelled'
    when greatest(
      round(
        invoice.total_amount
        - coalesce(credit.credited_amount, 0)
        - coalesce(allocation.allocated_amount, 0),
        4
      ),
      0
    ) = 0 then 'paid'
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
  coalesce(credit.credited_amount, 0)::numeric(14,4) as credited_amount,
  greatest(
    round(invoice.total_amount - coalesce(credit.credited_amount, 0), 4),
    0
  )::numeric(14,4) as adjusted_total_amount,
  case
    when invoice.status::text in ('draft', 'void') then 0
    else greatest(
      round(
        coalesce(allocation.allocated_amount, 0)
        - greatest(invoice.total_amount - coalesce(credit.credited_amount, 0), 0),
        4
      ),
      0
    )
  end::numeric(14,4) as overallocated_credit,
  invoice.sales_order_reference,
  invoice.supplier_email_snapshot,
  invoice.supplier_phone_snapshot,
  invoice.document_footer_snapshot,
  invoice.document_permanence_snapshot_at
from public.invoices invoice
left join lateral (
  select round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.payment_id
   and payment.status = 'posted'
  where allocation.workspace_id = invoice.workspace_id
    and allocation.invoice_id = invoice.id
) allocation on true
left join lateral (
  select round(coalesce(sum(note.total_amount), 0), 4) as credited_amount
  from public.credit_notes note
  where note.workspace_id = invoice.workspace_id
    and note.invoice_id = invoice.id
    and note.status = 'issued'
) credit on true;

create or replace view public.payment_account_balances
with (security_invoker = true)
as
select
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.customer_id,
  payment.customer_code_snapshot,
  payment.customer_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.notes,
  payment.received_at,
  payment.status,
  payment.version,
  payment.posted_by,
  payment.reversed_at,
  payment.reversed_by,
  payment.reversal_reason,
  payment.created_at,
  case
    when payment.status = 'posted' then coalesce(allocation.allocated_amount, 0)
    else 0
  end::numeric(14,4) as allocated_amount,
  case
    when payment.status = 'posted' then greatest(
      round(payment.amount - coalesce(allocation.allocated_amount, 0), 4),
      0
    )
    else 0
  end::numeric(14,4) as unallocated_amount
from public.payments payment
left join lateral (
  select round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  where allocation.workspace_id = payment.workspace_id
    and allocation.payment_id = payment.id
) allocation on true;

create or replace view public.customer_account_balances
with (security_invoker = true)
as
select
  customer.workspace_id,
  customer.id as customer_id,
  customer.code as customer_code,
  customer.name as customer_name,
  customer.company,
  coalesce(invoice.issued_amount, 0)::numeric(14,4) as issued_amount,
  coalesce(payment.received_amount, 0)::numeric(14,4) as received_amount,
  coalesce(invoice.allocated_amount, 0)::numeric(14,4) as allocated_amount,
  coalesce(invoice.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
  round(
    coalesce(payment.unallocated_credit, 0)
    + coalesce(invoice.overallocated_credit, 0),
    4
  )::numeric(14,4) as unallocated_credit,
  round(
    coalesce(invoice.outstanding_amount, 0)
    - coalesce(payment.unallocated_credit, 0)
    - coalesce(invoice.overallocated_credit, 0),
    4
  )::numeric(14,4) as net_balance,
  case
    when round(
      coalesce(invoice.outstanding_amount, 0)
      - coalesce(payment.unallocated_credit, 0)
      - coalesce(invoice.overallocated_credit, 0),
      4
    ) > 0 then 'amount_due'
    when round(
      coalesce(invoice.outstanding_amount, 0)
      - coalesce(payment.unallocated_credit, 0)
      - coalesce(invoice.overallocated_credit, 0),
      4
    ) < 0 then 'customer_credit'
    else 'clear'
  end as balance_status
from public.customers customer
left join lateral (
  select
    round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.adjusted_total_amount else 0 end), 4) as issued_amount,
    round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.allocated_amount else 0 end), 4) as allocated_amount,
    round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.outstanding_amount else 0 end), 4) as outstanding_amount,
    round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.overallocated_credit else 0 end), 4) as overallocated_credit
  from public.invoice_account_balances invoice
  where invoice.workspace_id = customer.workspace_id
    and invoice.customer_id = customer.id
) invoice on true
left join lateral (
  select
    round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as received_amount,
    round(sum(payment.unallocated_amount), 4) as unallocated_credit
  from public.payment_account_balances payment
  where payment.workspace_id = customer.workspace_id
    and payment.customer_id = customer.id
) payment on true;

revoke all on public.invoice_account_balances from anon;
revoke all on public.payment_account_balances from anon;
revoke all on public.customer_account_balances from anon;
grant select on public.invoice_account_balances to authenticated, service_role;
grant select on public.payment_account_balances to authenticated, service_role;
grant select on public.customer_account_balances to authenticated, service_role;
