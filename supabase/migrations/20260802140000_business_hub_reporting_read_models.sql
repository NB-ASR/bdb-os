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
  select customer.workspace_id,
         count(*) filter (where customer.status = 'active')::integer as customer_count,
         count(*) filter (
           where customer.status = 'active'
             and customer.created_at >= now() - interval '30 days'
         )::integer as new_customer_count_30d
  from public.customers customer
  group by customer.workspace_id
), appointment_counts as (
  select booking.workspace_id,
         count(*) filter (
           where booking.booking_date = current_date
             and booking.status::text <> 'cancelled'
         )::integer as today_appointment_count,
         count(*) filter (
           where booking.booking_date = current_date
             and booking.status::text = 'pending'
         )::integer as pending_today_appointment_count,
         count(*) filter (
           where booking.booking_date >= current_date
             and booking.status::text in ('pending', 'confirmed')
         )::integer as upcoming_appointment_count
  from public.bookings booking
  group by booking.workspace_id
), sale_draft_counts as (
  select draft.workspace_id,
         count(*) filter (where draft.status = 'open')::integer as open_sale_draft_count
  from public.sale_drafts draft
  group by draft.workspace_id
), account_counts as (
  select invoice.workspace_id,
         count(*) filter (where invoice.display_status = 'overdue')::integer as overdue_invoice_count,
         count(*) filter (
           where invoice.status::text not in ('draft', 'void')
             and invoice.outstanding_amount > 0
         )::integer as open_invoice_count
  from public.invoice_account_balances invoice
  group by invoice.workspace_id
), payment_counts as (
  select payment.workspace_id,
         count(*) filter (
           where payment.status = 'posted'
             and payment.unallocated_amount > 0
         )::integer as unallocated_payment_count
  from public.payment_account_balances payment
  group by payment.workspace_id
), communication_counts as (
  select thread.workspace_id,
         coalesce(sum(thread.unread_count), 0)::integer as unread_message_count,
         coalesce(sum(thread.draft_review_count), 0)::integer as draft_review_count,
         count(*) filter (where thread.status = 'open')::integer as open_thread_count
  from public.unified_communication_index thread
  group by thread.workspace_id
), document_counts as (
  select document.workspace_id,
         count(*) filter (where document.status = 'active')::integer as active_document_count,
         count(*) filter (
           where document.status = 'active'
             and document.uploaded_at >= now() - interval '7 days'
         )::integer as recent_document_count
  from public.general_document_index document
  group by document.workspace_id
), inventory_counts as (
  select stock.workspace_id,
         count(*) filter (where stock.quantity <= stock.reorder_level)::integer as low_stock_product_count,
         count(*) filter (where stock.quantity <= 0)::integer as out_of_stock_product_count
  from public.inventory_product_totals stock
  group by stock.workspace_id
), purchasing_counts as (
  select document.workspace_id,
         count(*) filter (
           where document.status in ('uploaded', 'extracting', 'review_required', 'extraction_failed')
         )::integer as purchasing_review_count
  from public.supplier_documents document
  group by document.workspace_id
), banking_counts as (
  select transaction.workspace_id,
         count(*) filter (
           where transaction.record_status = 'active'
             and transaction.reconciliation_status <> 'reconciled'
         )::integer as unreconciled_transaction_count
  from public.bank_transaction_reconciliation_balances transaction
  group by transaction.workspace_id
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
  select sale.workspace_id, sale.currency
  from public.sales sale
  where sale.status = 'completed'
  group by sale.workspace_id, sale.currency
  union
  select invoice.workspace_id, invoice.currency
  from public.invoice_account_balances invoice
  where invoice.status::text not in ('draft', 'void')
  group by invoice.workspace_id, invoice.currency
  union
  select payment.workspace_id, payment.currency
  from public.payment_account_balances payment
  where payment.status = 'posted'
  group by payment.workspace_id, payment.currency
  union
  select transaction.workspace_id, transaction.currency
  from public.bank_transaction_reconciliation_balances transaction
  where transaction.record_status = 'active'
  group by transaction.workspace_id, transaction.currency
  union
  select payable.workspace_id, payable.currency
  from public.supplier_payable_balances payable
  where payable.status = 'posted'
  group by payable.workspace_id, payable.currency
), sales_totals as (
  select sale.workspace_id,
         sale.currency,
         count(*)::integer as completed_sale_count,
         round(sum(sale.total_amount), 4) as completed_sale_amount
  from public.sales sale
  where sale.status = 'completed'
  group by sale.workspace_id, sale.currency
), invoice_totals as (
  select invoice.workspace_id,
         invoice.currency,
         count(*) filter (where invoice.status::text not in ('draft', 'void'))::integer as issued_invoice_count,
         count(*) filter (
           where invoice.status::text not in ('draft', 'void')
             and invoice.outstanding_amount > 0
         )::integer as open_invoice_count,
         count(*) filter (where invoice.display_status = 'overdue')::integer as overdue_invoice_count,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.total_amount else 0 end), 4) as issued_invoice_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.outstanding_amount else 0 end), 4) as outstanding_invoice_amount,
         round(sum(case when invoice.display_status = 'overdue' then invoice.outstanding_amount else 0 end), 4) as overdue_invoice_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.currency
), payment_totals as (
  select payment.workspace_id,
         payment.currency,
         count(*) filter (where payment.status = 'posted')::integer as posted_payment_count,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as received_payment_amount,
         round(sum(case when payment.status = 'posted' then payment.unallocated_amount else 0 end), 4) as unallocated_payment_amount
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.currency
), bank_totals as (
  select transaction.workspace_id,
         transaction.currency,
         count(*) filter (where transaction.record_status = 'active')::integer as bank_transaction_count,
         count(*) filter (
           where transaction.record_status = 'active'
             and transaction.reconciliation_status <> 'reconciled'
         )::integer as unreconciled_transaction_count,
         round(sum(case
           when transaction.record_status = 'active'
             and transaction.reconciliation_status <> 'reconciled'
           then abs(transaction.unreconciled_amount)
           else 0
         end), 4) as unreconciled_transaction_amount
  from public.bank_transaction_reconciliation_balances transaction
  group by transaction.workspace_id, transaction.currency
), supplier_totals as (
  select payable.workspace_id,
         payable.currency,
         count(*) filter (
           where payable.status = 'posted'
             and payable.outstanding_amount > 0
         )::integer as open_supplier_payable_count,
         round(sum(case
           when payable.status = 'posted' and payable.outstanding_amount > 0
           then payable.outstanding_amount
           else 0
         end), 4) as outstanding_supplier_payable_amount
  from public.supplier_payable_balances payable
  group by payable.workspace_id, payable.currency
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
left join sales_totals sale
  on sale.workspace_id = currency_row.workspace_id and sale.currency = currency_row.currency
left join invoice_totals invoice
  on invoice.workspace_id = currency_row.workspace_id and invoice.currency = currency_row.currency
left join payment_totals payment
  on payment.workspace_id = currency_row.workspace_id and payment.currency = currency_row.currency
left join bank_totals bank
  on bank.workspace_id = currency_row.workspace_id and bank.currency = currency_row.currency
left join supplier_totals supplier
  on supplier.workspace_id = currency_row.workspace_id and supplier.currency = currency_row.currency;

create or replace view public.business_report_monthly_sales
with (security_invoker = true)
as
select sale.workspace_id,
       date_trunc('month', coalesce(sale.completed_at, sale.occurred_at))::date as month,
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

create or replace view public.business_hub_attention
with (security_invoker = true)
as
select invoice.workspace_id,
       'accounts'::text as department,
       'invoice'::text as source_type,
       invoice.id as source_id,
       invoice.customer_id,
       invoice.currency,
       invoice.outstanding_amount::numeric(16,4) as amount,
       100::integer as priority,
       ('Overdue invoice ' || invoice.number)::text as title,
       concat_ws(' · ', invoice.customer_name_snapshot, invoice.currency || ' ' || trim(to_char(invoice.outstanding_amount, 'FM9999999990.00')))::text as detail,
       ('/accounts?tab=invoices&invoiceId=' || invoice.id::text)::text as route,
       'gold'::text as tone,
       coalesce(invoice.sent_at, invoice.updated_at, invoice.created_at) as occurred_at
from public.invoice_account_balances invoice
where invoice.display_status = 'overdue'

union all

select payable.workspace_id,
       'accounts'::text,
       'supplier_payable'::text,
       payable.id,
       null::uuid,
       payable.currency,
       payable.outstanding_amount::numeric(16,4),
       95::integer,
       ('Supplier payment overdue · ' || payable.document_number_snapshot)::text,
       concat_ws(' · ', payable.supplier_name_snapshot, payable.currency || ' ' || trim(to_char(payable.outstanding_amount, 'FM9999999990.00')))::text,
       ('/accounts/payables?payableId=' || payable.id::text)::text,
       'gold'::text,
       payable.posted_at
from public.supplier_payable_balances payable
where payable.status = 'posted'
  and payable.outstanding_amount > 0
  and payable.due_date < current_date

union all

select payment.workspace_id,
       'accounts'::text,
       'payment'::text,
       payment.id,
       payment.customer_id,
       payment.currency,
       payment.unallocated_amount::numeric(16,4),
       90::integer,
       ('Allocate payment ' || payment.reference)::text,
       concat_ws(' · ', payment.customer_name_snapshot, payment.currency || ' ' || trim(to_char(payment.unallocated_amount, 'FM9999999990.00')))::text,
       ('/accounts?tab=payments&paymentId=' || payment.id::text)::text,
       'blue'::text,
       payment.received_at
from public.payment_account_balances payment
where payment.status = 'posted'
  and payment.unallocated_amount > 0

union all

select booking.workspace_id,
       'calendar'::text,
       'appointment'::text,
       booking.id,
       booking.customer_id,
       null::text,
       null::numeric(16,4),
       85::integer,
       ('Confirm ' || booking.title)::text,
       concat_ws(' · ', booking.customer_name_snapshot, booking.booking_time::text, booking.staff_name)::text,
       ('/calendar?appointment=' || booking.id::text)::text,
       'gold'::text,
       booking.updated_at
from public.bookings booking
where booking.booking_date = current_date
  and booking.status::text = 'pending'

union all

select thread.workspace_id,
       'communications'::text,
       'communication_thread'::text,
       thread.id,
       thread.customer_id,
       null::text,
       null::numeric(16,4),
       case when thread.draft_review_count > 0 then 84 else 80 end::integer,
       case
         when thread.draft_review_count > 0 then 'Review draft reply'
         else 'Read customer conversation'
       end::text,
       concat_ws(' · ', thread.channel, thread.subject, nullif(
         concat_ws(', ',
           case when thread.unread_count > 0 then thread.unread_count::text || ' unread' end,
           case when thread.draft_review_count > 0 then thread.draft_review_count::text || ' draft review' end
         ),
         ''
       ))::text,
       ('/communications?threadId=' || thread.id::text)::text,
       case when thread.draft_review_count > 0 then 'gold' else 'blue' end::text,
       coalesce(thread.latest_occurred_at, thread.updated_at, thread.created_at)
from public.unified_communication_index thread
where thread.unread_count > 0
   or thread.draft_review_count > 0

union all

select document.workspace_id,
       'purchasing'::text,
       'supplier_document'::text,
       document.id,
       null::uuid,
       document.currency,
       document.gross_amount::numeric(16,4),
       75::integer,
       case document.status
         when 'extraction_failed' then 'Resolve purchasing extraction'
         when 'review_required' then 'Review purchasing document'
         else 'Complete purchasing capture'
       end::text,
       concat_ws(' · ', document.file_name, document.document_number, document.status)::text,
       ('/documents/purchasing?documentId=' || document.id::text)::text,
       case when document.status = 'extraction_failed' then 'gold' else 'blue' end::text,
       document.updated_at
from public.supplier_documents document
where document.status in ('uploaded', 'extracting', 'review_required', 'extraction_failed')

union all

select transaction.workspace_id,
       'banking'::text,
       'bank_transaction'::text,
       transaction.id,
       null::uuid,
       transaction.currency,
       abs(transaction.unreconciled_amount)::numeric(16,4),
       70::integer,
       'Reconcile bank transaction'::text,
       concat_ws(' · ', transaction.bank_account_name, transaction.description, transaction.currency || ' ' || trim(to_char(abs(transaction.unreconciled_amount), 'FM9999999990.00')))::text,
       ('/banking?transactionId=' || transaction.id::text)::text,
       'gold'::text,
       transaction.created_at
from public.bank_transaction_reconciliation_balances transaction
where transaction.record_status = 'active'
  and transaction.reconciliation_status <> 'reconciled'

union all

select stock.workspace_id,
       'inventory'::text,
       'product'::text,
       stock.product_id,
       null::uuid,
       null::text,
       stock.quantity::numeric(16,4),
       65::integer,
       case when stock.quantity <= 0 then 'Product out of stock' else 'Product below reorder level' end::text,
       concat_ws(' · ', product.sku::text, product.name, 'Qty ' || trim(to_char(stock.quantity, 'FM9999999990.####')))::text,
       ('/inventory?productId=' || stock.product_id::text)::text,
       case when stock.quantity <= 0 then 'gold' else 'blue' end::text,
       product.updated_at
from public.inventory_product_totals stock
join public.products product
  on product.workspace_id = stock.workspace_id
 and product.id = stock.product_id
where product.status = 'active'
  and stock.quantity <= stock.reorder_level

union all

select draft.workspace_id,
       'sales'::text,
       'sale_draft'::text,
       draft.id,
       draft.customer_id,
       draft.currency,
       greatest(draft.quantity * draft.unit_price - draft.discount_amount, 0)::numeric(16,4),
       60::integer,
       ('Complete sale draft ' || draft.reference)::text,
       concat_ws(' · ', draft.customer_name_snapshot, draft.service_name_snapshot)::text,
       ('/sales/appointment-drafts?draftId=' || draft.id::text)::text,
       'blue'::text,
       draft.updated_at
from public.sale_drafts draft
where draft.status = 'open';

create or replace view public.business_hub_recent_activity
with (security_invoker = true)
as
select activity.workspace_id,
       case activity.source_type
         when 'appointment' then 'calendar'
         when 'sale' then 'sales'
         when 'invoice' then 'accounts'
         when 'payment' then 'accounts'
         when 'communication' then 'communications'
         when 'document' then 'documents'
         else 'customers'
       end::text as department,
       activity.source_type,
       activity.source_id,
       activity.customer_id,
       customer.name as customer_name,
       activity.event_type,
       activity.title,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       activity.route,
       activity.metadata
from public.customer_360_activity activity
join public.customers customer
  on customer.workspace_id = activity.workspace_id
 and customer.id = activity.customer_id

union all

select activity.workspace_id,
       case
         when activity.entity_type in ('supplier_document', 'supplier_payable', 'supplier', 'product_supplier') then 'purchasing'
         when activity.entity_type in ('product', 'inventory_location', 'inventory_movement') then 'inventory'
         when activity.entity_type in ('bank_transaction', 'bank_account') then 'banking'
         else 'overview'
       end::text,
       activity.entity_type::text,
       activity.id,
       null::uuid,
       null::text,
       lower(replace(activity.action, ' ', '_'))::text,
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       case
         when activity.entity_type = 'supplier_document' then ('/documents/purchasing?documentId=' || activity.entity_id)::text
         when activity.entity_type = 'supplier_payable' then ('/accounts/payables?payableId=' || activity.entity_id)::text
         when activity.entity_type in ('product', 'inventory_location', 'inventory_movement') then '/inventory'::text
         when activity.entity_type in ('bank_transaction', 'bank_account') then '/banking'::text
         else '/workspace'::text
       end,
       activity.metadata
from public.activity_items activity
where activity.entity_type in (
  'supplier_document',
  'supplier_payable',
  'supplier',
  'product_supplier',
  'product',
  'inventory_location',
  'inventory_movement',
  'bank_transaction',
  'bank_account'
);

for view_name in
  select unnest(array[
    'business_hub_operational_metrics',
    'business_hub_currency_metrics',
    'business_report_monthly_sales',
    'business_report_customer_sales',
    'business_hub_attention',
    'business_hub_recent_activity'
  ])
loop
  execute format('revoke all on public.%I from public, anon, authenticated', view_name);
  execute format('grant select on public.%I to authenticated', view_name);
end loop;

comment on function public.get_business_hub_access(uuid) is
  'Returns permission-aware Business Hub and Reporting capabilities using the signed-in caller context.';
comment on view public.business_hub_operational_metrics is
  'Read-only workspace operational signals for the Business Hub; source departments remain authoritative.';
comment on view public.business_hub_currency_metrics is
  'Currency-separated Business Hub and Reporting financial metrics; values from different currencies are never combined.';
comment on view public.business_hub_attention is
  'Exact cross-department actions requiring attention, ordered by application priority and linked to source records.';
comment on view public.business_hub_recent_activity is
  'Permission-aware recent activity for the Business Hub, combining Customer 360 and non-customer operational activity.';
comment on view public.business_report_monthly_sales is
  'Completed Sales by month and currency for Version 1 Reporting.';
comment on view public.business_report_customer_sales is
  'Completed Sales by Customer and currency for Version 1 Reporting.';

commit;
