begin;

create or replace function public.get_business_hub_access(target_workspace_id uuid)
returns table(feature_key text, can_view boolean, can_create boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select feature.feature_key,
         private.has_workspace_permission(target_workspace_id, feature.feature_key, 'view') as can_view,
         private.has_workspace_permission(target_workspace_id, feature.feature_key, 'create') as can_create
  from unnest(array[
    'overview',
    'customers',
    'calendar',
    'sales',
    'accounts',
    'communications',
    'documents',
    'banking',
    'inventory',
    'purchasing',
    'reports'
  ]::text[]) as feature(feature_key);
$$;

revoke all on function public.get_business_hub_access(uuid) from public, anon;
grant execute on function public.get_business_hub_access(uuid) to authenticated, service_role;

create or replace view public.business_hub_operational_metrics
with (security_invoker = true)
as
with customer_counts as (
  select workspace_id,
         count(*) filter (where status = 'active')::integer as customer_count,
         count(*) filter (where status = 'active' and created_at >= now() - interval '30 days')::integer as new_customer_count_30d
  from public.customers
  group by workspace_id
), appointment_counts as (
  select workspace_id,
         count(*) filter (where booking_date = current_date and status::text <> 'cancelled')::integer as today_appointment_count,
         count(*) filter (where booking_date = current_date and status::text = 'pending')::integer as pending_today_appointment_count,
         count(*) filter (where booking_date >= current_date and status::text in ('pending', 'confirmed'))::integer as upcoming_appointment_count
  from public.bookings
  group by workspace_id
), sale_draft_counts as (
  select workspace_id,
         count(*) filter (where status = 'open')::integer as open_sale_draft_count
  from public.sale_drafts
  group by workspace_id
), account_counts as (
  select workspace_id,
         count(*) filter (where display_status = 'overdue')::integer as overdue_invoice_count,
         count(*) filter (where status::text not in ('draft', 'void') and outstanding_amount > 0)::integer as open_invoice_count
  from public.invoice_account_balances
  group by workspace_id
), payment_counts as (
  select workspace_id,
         count(*) filter (where status = 'posted' and unallocated_amount > 0)::integer as unallocated_payment_count
  from public.payment_account_balances
  group by workspace_id
), communication_counts as (
  select workspace_id,
         coalesce(sum(unread_count), 0)::integer as unread_message_count,
         coalesce(sum(draft_review_count), 0)::integer as draft_review_count,
         count(*) filter (where status = 'open')::integer as open_thread_count
  from public.unified_communication_index
  group by workspace_id
), document_counts as (
  select workspace_id,
         count(*) filter (where status = 'active')::integer as active_document_count,
         count(*) filter (where status = 'active' and uploaded_at >= now() - interval '7 days')::integer as recent_document_count
  from public.general_document_index
  group by workspace_id
), inventory_counts as (
  select workspace_id,
         count(*) filter (where quantity <= reorder_level)::integer as low_stock_product_count,
         count(*) filter (where quantity <= 0)::integer as out_of_stock_product_count
  from public.inventory_product_totals
  group by workspace_id
), purchasing_counts as (
  select workspace_id,
         count(*) filter (where status in ('uploaded', 'extracting', 'review_required', 'extraction_failed'))::integer as purchasing_review_count
  from public.supplier_documents
  group by workspace_id
), banking_counts as (
  select workspace_id,
         count(*) filter (where record_status = 'active' and reconciliation_status <> 'reconciled')::integer as unreconciled_transaction_count
  from public.bank_transaction_reconciliation_balances
  group by workspace_id
)
select workspace.id as workspace_id,
       workspace.name as workspace_name,
       coalesce(customer.customer_count, 0) as customer_count,
       coalesce(customer.new_customer_count_30d, 0) as new_customer_count_30d,
       coalesce(appointment.today_appointment_count, 0) as today_appointment_count,
       coalesce(appointment.pending_today_appointment_count, 0) as pending_today_appointment_count,
       coalesce(appointment.upcoming_appointment_count, 0) as upcoming_appointment_count,
       coalesce(draft.open_sale_draft_count, 0) as open_sale_draft_count,
       coalesce(account.overdue_invoice_count, 0) as overdue_invoice_count,
       coalesce(account.open_invoice_count, 0) as open_invoice_count,
       coalesce(payment.unallocated_payment_count, 0) as unallocated_payment_count,
       coalesce(communication.unread_message_count, 0) as unread_message_count,
       coalesce(communication.draft_review_count, 0) as draft_review_count,
       coalesce(communication.open_thread_count, 0) as open_thread_count,
       coalesce(document.active_document_count, 0) as active_document_count,
       coalesce(document.recent_document_count, 0) as recent_document_count,
       coalesce(inventory.low_stock_product_count, 0) as low_stock_product_count,
       coalesce(inventory.out_of_stock_product_count, 0) as out_of_stock_product_count,
       coalesce(purchasing.purchasing_review_count, 0) as purchasing_review_count,
       coalesce(banking.unreconciled_transaction_count, 0) as unreconciled_transaction_count,
       (
         coalesce(appointment.pending_today_appointment_count, 0)
         + coalesce(draft.open_sale_draft_count, 0)
         + coalesce(account.overdue_invoice_count, 0)
         + coalesce(payment.unallocated_payment_count, 0)
         + coalesce(communication.unread_message_count, 0)
         + coalesce(communication.draft_review_count, 0)
         + coalesce(inventory.low_stock_product_count, 0)
         + coalesce(purchasing.purchasing_review_count, 0)
         + coalesce(banking.unreconciled_transaction_count, 0)
       )::integer as attention_count,
       now() as generated_at
from public.workspaces workspace
left join customer_counts customer on customer.workspace_id = workspace.id
left join appointment_counts appointment on appointment.workspace_id = workspace.id
left join sale_draft_counts draft on draft.workspace_id = workspace.id
left join account_counts account on account.workspace_id = workspace.id
left join payment_counts payment on payment.workspace_id = workspace.id
left join communication_counts communication on communication.workspace_id = workspace.id
left join document_counts document on document.workspace_id = workspace.id
left join inventory_counts inventory on inventory.workspace_id = workspace.id
left join purchasing_counts purchasing on purchasing.workspace_id = workspace.id
left join banking_counts banking on banking.workspace_id = workspace.id;

create or replace view public.business_hub_currency_metrics
with (security_invoker = true)
as
with currencies as (
  select workspace_id, currency from public.sales where status = 'completed' group by workspace_id, currency
  union
  select workspace_id, currency from public.invoice_account_balances where status::text not in ('draft', 'void') group by workspace_id, currency
  union
  select workspace_id, currency from public.payment_account_balances where status = 'posted' group by workspace_id, currency
  union
  select workspace_id, currency from public.bank_transaction_reconciliation_balances where record_status = 'active' group by workspace_id, currency
  union
  select workspace_id, currency from public.supplier_payable_balances where status = 'posted' group by workspace_id, currency
), sales_totals as (
  select workspace_id, currency,
         count(*)::integer as completed_sale_count,
         round(sum(total_amount), 4) as completed_sale_amount
  from public.sales
  where status = 'completed'
  group by workspace_id, currency
), invoice_totals as (
  select workspace_id, currency,
         count(*) filter (where status::text not in ('draft', 'void'))::integer as issued_invoice_count,
         count(*) filter (where status::text not in ('draft', 'void') and outstanding_amount > 0)::integer as open_invoice_count,
         count(*) filter (where display_status = 'overdue')::integer as overdue_invoice_count,
         round(sum(case when status::text not in ('draft', 'void') then total_amount else 0 end), 4) as issued_invoice_amount,
         round(sum(case when status::text not in ('draft', 'void') then outstanding_amount else 0 end), 4) as outstanding_invoice_amount,
         round(sum(case when display_status = 'overdue' then outstanding_amount else 0 end), 4) as overdue_invoice_amount
  from public.invoice_account_balances
  group by workspace_id, currency
), payment_totals as (
  select workspace_id, currency,
         count(*) filter (where status = 'posted')::integer as posted_payment_count,
         round(sum(case when status = 'posted' then amount else 0 end), 4) as received_payment_amount,
         round(sum(case when status = 'posted' then unallocated_amount else 0 end), 4) as unallocated_payment_amount
  from public.payment_account_balances
  group by workspace_id, currency
), bank_totals as (
  select workspace_id, currency,
         count(*) filter (where record_status = 'active')::integer as bank_transaction_count,
         count(*) filter (where record_status = 'active' and reconciliation_status <> 'reconciled')::integer as unreconciled_transaction_count,
         round(sum(case when record_status = 'active' and reconciliation_status <> 'reconciled' then abs(unreconciled_amount) else 0 end), 4) as unreconciled_transaction_amount
  from public.bank_transaction_reconciliation_balances
  group by workspace_id, currency
), supplier_totals as (
  select workspace_id, currency,
         count(*) filter (where status = 'posted' and outstanding_amount > 0)::integer as open_supplier_payable_count,
         round(sum(case when status = 'posted' and outstanding_amount > 0 then outstanding_amount else 0 end), 4) as outstanding_supplier_payable_amount
  from public.supplier_payable_balances
  group by workspace_id, currency
)
select currency_row.workspace_id,
       currency_row.currency,
       coalesce(sale.completed_sale_count, 0) as completed_sale_count,
       coalesce(sale.completed_sale_amount, 0)::numeric(16,4) as completed_sale_amount,
       coalesce(invoice.issued_invoice_count, 0) as issued_invoice_count,
       coalesce(invoice.open_invoice_count, 0) as open_invoice_count,
       coalesce(invoice.overdue_invoice_count, 0) as overdue_invoice_count,
       coalesce(invoice.issued_invoice_amount, 0)::numeric(16,4) as issued_invoice_amount,
       coalesce(invoice.outstanding_invoice_amount, 0)::numeric(16,4) as outstanding_invoice_amount,
       coalesce(invoice.overdue_invoice_amount, 0)::numeric(16,4) as overdue_invoice_amount,
       coalesce(payment.posted_payment_count, 0) as posted_payment_count,
       coalesce(payment.received_payment_amount, 0)::numeric(16,4) as received_payment_amount,
       coalesce(payment.unallocated_payment_amount, 0)::numeric(16,4) as unallocated_payment_amount,
       coalesce(bank.bank_transaction_count, 0) as bank_transaction_count,
       coalesce(bank.unreconciled_transaction_count, 0) as unreconciled_transaction_count,
       coalesce(bank.unreconciled_transaction_amount, 0)::numeric(16,4) as unreconciled_transaction_amount,
       coalesce(supplier.open_supplier_payable_count, 0) as open_supplier_payable_count,
       coalesce(supplier.outstanding_supplier_payable_amount, 0)::numeric(16,4) as outstanding_supplier_payable_amount
from currencies currency_row
left join sales_totals sale on sale.workspace_id = currency_row.workspace_id and sale.currency = currency_row.currency
left join invoice_totals invoice on invoice.workspace_id = currency_row.workspace_id and invoice.currency = currency_row.currency
left join payment_totals payment on payment.workspace_id = currency_row.workspace_id and payment.currency = currency_row.currency
left join bank_totals bank on bank.workspace_id = currency_row.workspace_id and bank.currency = currency_row.currency
left join supplier_totals supplier on supplier.workspace_id = currency_row.workspace_id and supplier.currency = currency_row.currency;

revoke all on public.business_hub_operational_metrics from public, anon, authenticated;
grant select on public.business_hub_operational_metrics to authenticated;
revoke all on public.business_hub_currency_metrics from public, anon, authenticated;
grant select on public.business_hub_currency_metrics to authenticated;

comment on function public.get_business_hub_access(uuid) is
  'Returns permission-aware Business Hub and Reporting capabilities using the signed-in caller context.';
comment on view public.business_hub_operational_metrics is
  'Read-only workspace operational signals for the Business Hub; source departments remain authoritative.';
comment on view public.business_hub_currency_metrics is
  'Currency-separated Business Hub and Reporting financial metrics; values from different currencies are never combined.';

commit;
