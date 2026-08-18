begin;

-- Follow-up to Accounts Invoice polish V1.
-- PostgreSQL data-modifying CTEs share one command snapshot, so the first
-- migration correctly repriced direct draft Invoice lines but its same-statement
-- aggregate could still see the pre-update line values. Reconcile the editable
-- Invoice header in a separate statement after those line updates are visible.
-- Issued history and Sale-derived Invoice snapshots remain untouched.

with draft_totals as (
  select
    line.workspace_id,
    line.invoice_id,
    round(sum(line.gross_amount), 4) as gross_amount,
    round(sum(line.discount_amount), 4) as discount_amount,
    round(sum(line.net_amount), 4) as net_amount,
    round(sum(line.vat_amount), 4) as vat_amount,
    round(sum(line.total_amount), 4) as total_amount
  from public.invoice_lines line
  join public.invoices invoice
    on invoice.workspace_id = line.workspace_id
   and invoice.id = line.invoice_id
  where invoice.status = 'draft'::public.invoice_status
    and invoice.source_sale_id is null
  group by line.workspace_id, line.invoice_id
)
update public.invoices invoice
set gross_amount = totals.gross_amount,
    discount_amount = totals.discount_amount,
    net_amount = totals.net_amount,
    vat_amount = totals.vat_amount,
    total_amount = totals.total_amount,
    amount = round(totals.total_amount, 2),
    updated_at = now(),
    version = invoice.version + 1
from draft_totals totals
where invoice.workspace_id = totals.workspace_id
  and invoice.id = totals.invoice_id
  and invoice.status = 'draft'::public.invoice_status
  and invoice.source_sale_id is null;

commit;
