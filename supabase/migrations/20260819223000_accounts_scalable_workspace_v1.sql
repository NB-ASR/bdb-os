begin;

-- Accounts scalability foundation.
-- This migration changes read/query infrastructure only. It does not alter financial document,
-- payment, balance, numbering, VAT, Credit Note or offline command semantics.

create extension if not exists pg_trgm with schema extensions;

-- Stable keyset pagination for high-volume Invoice registers.
create index if not exists invoices_workspace_issued_cursor_idx
  on public.invoices(workspace_id, issued_at desc, id desc);

create index if not exists invoices_workspace_customer_issued_cursor_idx
  on public.invoices(workspace_id, customer_id, issued_at desc, id desc);

-- Search remains database-side. Trigram indexes keep document/customer/SO lookups viable
-- without loading historical Invoice collections into the browser.
create index if not exists invoices_number_search_trgm_idx
  on public.invoices using gin (lower(number) extensions.gin_trgm_ops);

create index if not exists invoices_customer_name_search_trgm_idx
  on public.invoices using gin (lower(customer_name_snapshot) extensions.gin_trgm_ops);

create index if not exists invoices_sales_order_search_trgm_idx
  on public.invoices using gin (lower(sales_order_reference) extensions.gin_trgm_ops)
  where sales_order_reference is not null;

-- The same creation-order spine supports later dedicated Credit Note / Delivery Note registers.
create index if not exists credit_notes_workspace_created_cursor_idx
  on public.credit_notes(workspace_id, created_at desc, id desc);

create index if not exists delivery_notes_workspace_created_cursor_idx
  on public.delivery_notes(workspace_id, created_at desc, id desc);

-- One compact Accounts landing summary. security_invoker keeps the existing workspace RLS
-- authority intact; this view is a read model, not a second accounting ledger.
create or replace view public.accounts_workspace_summary
with (security_invoker = true)
as
with invoice_summary as (
  select
    invoice.workspace_id,
    count(*) filter (where invoice.status::text <> 'draft')::bigint as invoice_count,
    count(*) filter (where invoice.outstanding_amount > 0)::bigint as open_invoice_count,
    count(*) filter (where invoice.display_status = 'overdue')::bigint as overdue_invoice_count,
    count(*) filter (where invoice.credited_amount > 0)::bigint as credited_invoice_count,
    round(coalesce(sum(invoice.outstanding_amount), 0), 4)::numeric(16,4) as outstanding_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id
),
customer_summary as (
  select
    customer.workspace_id,
    round(coalesce(sum(customer.unallocated_credit), 0), 4)::numeric(16,4) as customer_credit_amount
  from public.customer_account_balances customer
  group by customer.workspace_id
),
payment_summary as (
  select
    payment.workspace_id,
    count(*) filter (where payment.status = 'posted' and payment.unallocated_amount > 0)::bigint as unallocated_payment_count,
    round(coalesce(sum(payment.unallocated_amount) filter (where payment.status = 'posted'), 0), 4)::numeric(16,4) as unallocated_payment_amount
  from public.payment_account_balances payment
  group by payment.workspace_id
)
select
  settings.workspace_id,
  settings.currency,
  coalesce(invoice.invoice_count, 0)::bigint as invoice_count,
  coalesce(invoice.open_invoice_count, 0)::bigint as open_invoice_count,
  coalesce(invoice.overdue_invoice_count, 0)::bigint as overdue_invoice_count,
  coalesce(invoice.credited_invoice_count, 0)::bigint as credited_invoice_count,
  coalesce(invoice.outstanding_amount, 0)::numeric(16,4) as outstanding_amount,
  coalesce(customer.customer_credit_amount, 0)::numeric(16,4) as customer_credit_amount,
  coalesce(payment.unallocated_payment_count, 0)::bigint as unallocated_payment_count,
  coalesce(payment.unallocated_payment_amount, 0)::numeric(16,4) as unallocated_payment_amount
from public.workspace_settings settings
left join invoice_summary invoice on invoice.workspace_id = settings.workspace_id
left join customer_summary customer on customer.workspace_id = settings.workspace_id
left join payment_summary payment on payment.workspace_id = settings.workspace_id;

grant select on public.accounts_workspace_summary to authenticated;

commit;
