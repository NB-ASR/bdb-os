begin;

-- Accounts register scalability: bounded operational reads keep financial source-of-truth tables unchanged.
create extension if not exists pg_trgm with schema extensions;

create index if not exists invoices_workspace_issued_cursor_idx
  on public.invoices(workspace_id, issued_at desc, id desc);
create index if not exists credit_notes_workspace_created_cursor_idx
  on public.credit_notes(workspace_id, created_at desc, id desc);
create index if not exists delivery_notes_workspace_created_cursor_idx
  on public.delivery_notes(workspace_id, created_at desc, id desc);
create index if not exists payments_workspace_received_cursor_idx
  on public.payments(workspace_id, received_at desc, id desc);

-- Trigram indexes support operational contains-search without forcing full table scans at scale.
create index if not exists invoices_number_trgm_idx
  on public.invoices using gin (number extensions.gin_trgm_ops);
create index if not exists invoices_customer_name_trgm_idx
  on public.invoices using gin (customer_name_snapshot extensions.gin_trgm_ops);
create index if not exists invoices_sales_order_trgm_idx
  on public.invoices using gin (sales_order_reference extensions.gin_trgm_ops)
  where sales_order_reference is not null;

create index if not exists credit_notes_number_trgm_idx
  on public.credit_notes using gin (number extensions.gin_trgm_ops);
create index if not exists credit_notes_customer_name_trgm_idx
  on public.credit_notes using gin (customer_name_snapshot extensions.gin_trgm_ops);
create index if not exists credit_notes_reason_trgm_idx
  on public.credit_notes using gin (reason extensions.gin_trgm_ops);
create index if not exists credit_notes_sales_order_trgm_idx
  on public.credit_notes using gin (sales_order_reference extensions.gin_trgm_ops)
  where sales_order_reference is not null;

create index if not exists delivery_notes_number_trgm_idx
  on public.delivery_notes using gin (number extensions.gin_trgm_ops);
create index if not exists delivery_notes_customer_name_trgm_idx
  on public.delivery_notes using gin (customer_name_snapshot extensions.gin_trgm_ops);
create index if not exists delivery_notes_address_trgm_idx
  on public.delivery_notes using gin (delivery_address extensions.gin_trgm_ops)
  where delivery_address is not null;

create index if not exists payments_reference_trgm_idx
  on public.payments using gin (reference extensions.gin_trgm_ops);
create index if not exists payments_customer_name_trgm_idx
  on public.payments using gin (customer_name_snapshot extensions.gin_trgm_ops);
create index if not exists payments_external_reference_trgm_idx
  on public.payments using gin (external_reference extensions.gin_trgm_ops)
  where external_reference is not null;

create index if not exists customers_name_trgm_idx
  on public.customers using gin (name extensions.gin_trgm_ops);
create index if not exists customers_code_trgm_idx
  on public.customers using gin (code extensions.gin_trgm_ops);
create index if not exists customers_company_trgm_idx
  on public.customers using gin (company extensions.gin_trgm_ops)
  where company is not null;

create or replace view public.accounts_workspace_summary
with (security_invoker = true)
as
with invoice_summary as (
  select
    invoice.workspace_id,
    count(*) filter (where invoice.display_status not in ('draft', 'void'))::bigint as invoice_count,
    count(*) filter (
      where invoice.display_status not in ('draft', 'void', 'cancelled')
        and invoice.outstanding_amount > 0
    )::bigint as open_invoice_count,
    count(*) filter (where invoice.display_status = 'overdue')::bigint as overdue_invoice_count,
    count(*) filter (where invoice.credited_amount > 0)::bigint as credited_invoice_count,
    round(coalesce(sum(invoice.outstanding_amount) filter (
      where invoice.display_status not in ('draft', 'void', 'cancelled')
    ), 0), 4)::numeric(14,4) as outstanding_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id
), customer_summary as (
  select
    customer.workspace_id,
    round(coalesce(sum(customer.unallocated_credit), 0), 4)::numeric(14,4) as customer_credit_amount
  from public.customer_account_balances customer
  group by customer.workspace_id
), payment_summary as (
  select
    payment.workspace_id,
    count(*) filter (where payment.status = 'posted' and payment.unallocated_amount > 0)::bigint as unallocated_payment_count,
    round(coalesce(sum(payment.unallocated_amount) filter (
      where payment.status = 'posted' and payment.unallocated_amount > 0
    ), 0), 4)::numeric(14,4) as unallocated_payment_amount
  from public.payment_account_balances payment
  group by payment.workspace_id
)
select
  workspace.id as workspace_id,
  coalesce(settings.currency, 'EUR') as currency,
  coalesce(invoice.invoice_count, 0)::bigint as invoice_count,
  coalesce(invoice.open_invoice_count, 0)::bigint as open_invoice_count,
  coalesce(invoice.overdue_invoice_count, 0)::bigint as overdue_invoice_count,
  coalesce(invoice.credited_invoice_count, 0)::bigint as credited_invoice_count,
  coalesce(invoice.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
  coalesce(customer.customer_credit_amount, 0)::numeric(14,4) as customer_credit_amount,
  coalesce(payment.unallocated_payment_count, 0)::bigint as unallocated_payment_count,
  coalesce(payment.unallocated_payment_amount, 0)::numeric(14,4) as unallocated_payment_amount
from public.workspaces workspace
left join public.workspace_settings settings on settings.workspace_id = workspace.id
left join invoice_summary invoice on invoice.workspace_id = workspace.id
left join customer_summary customer on customer.workspace_id = workspace.id
left join payment_summary payment on payment.workspace_id = workspace.id;

revoke all on public.accounts_workspace_summary from anon;
grant select on public.accounts_workspace_summary to authenticated, service_role;

commit;
