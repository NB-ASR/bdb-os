begin;

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
       case when thread.draft_review_count > 0 then 'Review draft reply' else 'Read customer conversation' end::text,
       concat_ws(' · ', thread.channel, thread.subject, nullif(
         concat_ws(', ',
           case when thread.unread_count > 0 then thread.unread_count::text || ' unread' end,
           case when thread.draft_review_count > 0 then thread.draft_review_count::text || ' draft review' end
         ), ''
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

revoke all on public.business_hub_attention from public, anon, authenticated;
grant select on public.business_hub_attention to authenticated;
revoke all on public.business_hub_recent_activity from public, anon, authenticated;
grant select on public.business_hub_recent_activity to authenticated;

comment on view public.business_hub_attention is
  'Exact cross-department actions requiring attention, ordered by application priority and linked to source records.';
comment on view public.business_hub_recent_activity is
  'Permission-aware recent activity for the Business Hub, combining Customer 360 and non-customer operational activity.';

commit;
