-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133455_vanita_release_business_hub_workspace_and_admin.sql.
-- Sources: 20260802140000_business_hub_access_and_metrics.sql through 20260805131000_revoke_anonymous_operational_settings.sql.
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


begin;

create or replace view public.business_report_monthly_sales
with (security_invoker = true)
as
select sale.workspace_id,
       date_trunc('month', coalesce(sale.completed_at, sale.occurred_at))::date as month_start,
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

revoke all on public.business_report_monthly_sales from public, anon, authenticated;
grant select on public.business_report_monthly_sales to authenticated;
revoke all on public.business_report_customer_sales from public, anon, authenticated;
grant select on public.business_report_customer_sales to authenticated;

comment on view public.business_report_monthly_sales is
  'Completed Sales by month and currency for Version 1 Reporting.';
comment on view public.business_report_customer_sales is
  'Completed Sales by Customer and currency for Version 1 Reporting.';

commit;


begin;

create table if not exists public.workspace_recovery_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  action text not null check (action in ('update_configuration', 'set_logo', 'restore_snapshot')),
  request_hash text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.workspace_recovery_receipts enable row level security;
revoke all on public.workspace_recovery_receipts from anon, authenticated;
grant all on public.workspace_recovery_receipts to service_role;

create or replace function private.actor_has_workspace_admin_access(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_level text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with membership as (
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  )
  select case
    when not exists (select 1 from membership) then false
    when target_level = 'view' then true
    when target_level = 'manage'
      then (select access_profile from membership) in ('owner', 'manager')
    when target_level = 'recover'
      then (select access_profile from membership) = 'owner'
    else false
  end;
$function$;

create or replace function private.workspace_restorable_tables()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'workspace_settings',
    'workspace_themes',
    'customers',
    'products',
    'suppliers',
    'services',
    'inventory_locations',
    'calendar_rooms',
    'bank_accounts',
    'automations',
    'product_suppliers',
    'calendar_staff_working_hours',
    'calendar_staff_breaks',
    'calendar_staff_leave',
    'calendar_staff_service_eligibility',
    'communication_threads',
    'messages',
    'bookings',
    'sales',
    'sale_lines',
    'sale_drafts',
    'invoices',
    'invoice_lines',
    'payments',
    'supplier_documents',
    'supplier_document_lines',
    'supplier_document_extraction_runs',
    'supplier_payables',
    'supplier_payments',
    'inventory_movements',
    'payment_allocations',
    'supplier_payment_allocations',
    'supplier_credit_allocations',
    'bank_statement_imports',
    'bank_transactions',
    'bank_reconciliation_allocations',
    'customer_notes',
    'documents',
    'document_links'
  ]::text[];
$function$;

create or replace function private.workspace_restorable_record_count(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_table text;
  total_count bigint := 0;
  table_count bigint;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'view'
  ) then
    return 0;
  end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    if target_table in ('workspace_settings', 'workspace_themes') then
      continue;
    end if;
    execute format(
      'select count(*) from public.%I where workspace_id = $1',
      target_table
    )
    into table_count
    using target_workspace_id;
    total_count := total_count + table_count;
  end loop;

  return total_count;
end;
$function$;

create or replace function public.get_workspace_settings_access(
  target_workspace_id uuid
)
returns table (
  can_view boolean,
  can_manage boolean,
  can_recover boolean,
  support_read_only boolean,
  restorable_record_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'view'
    ),
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'manage'
    ),
    private.actor_has_workspace_admin_access(
      target_workspace_id,
      (select auth.uid()),
      'recover'
    ),
    false,
    private.workspace_restorable_record_count(
      target_workspace_id,
      (select auth.uid())
    );
$function$;

revoke all on function public.get_workspace_settings_access(uuid) from public, anon;
grant execute on function public.get_workspace_settings_access(uuid) to authenticated;

revoke insert, update, delete, truncate on public.workspace_settings from authenticated;
revoke insert, update, delete, truncate on public.workspace_themes from authenticated;
revoke update, delete, truncate on public.workspaces from authenticated;

drop policy if exists "Managers can update settings" on public.workspace_settings;
drop policy if exists "Managers can create themes" on public.workspace_themes;
drop policy if exists "Managers can update themes" on public.workspace_themes;
drop policy if exists "Managers can update workspaces" on public.workspaces;
drop policy if exists "Managers can upload workspace assets" on storage.objects;
drop policy if exists "Managers can update workspace assets" on storage.objects;
drop policy if exists "Managers can delete workspace assets" on storage.objects;

commit;


begin;

create or replace function public.update_workspace_configuration(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_business_name text,
  target_legal_name text,
  target_owner_name text,
  target_email text,
  target_phone text,
  target_currency text,
  target_invoice_prefix text,
  target_vat_rate numeric,
  target_timezone text,
  target_theme jsonb,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  normalized_business_name text := btrim(coalesce(target_business_name, ''));
  normalized_legal_name text := nullif(btrim(coalesce(target_legal_name, '')), '');
  normalized_owner_name text := btrim(coalesce(target_owner_name, ''));
  normalized_email text := nullif(lower(btrim(coalesce(target_email, ''))), '');
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_currency text := upper(btrim(coalesce(target_currency, '')));
  normalized_invoice_prefix text := upper(btrim(coalesce(target_invoice_prefix, '')));
  normalized_timezone text := btrim(coalesce(target_timezone, ''));
  normalized_theme jsonb := coalesce(target_theme, '{}'::jsonb);
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace settings management is not permitted';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'update_configuration'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with different settings input';
    end if;
    return existing_receipt.result;
  end if;

  if length(normalized_business_name) not between 2 and 120 then
    raise exception 'Business name must contain between 2 and 120 characters';
  end if;
  if normalized_legal_name is not null and length(normalized_legal_name) > 160 then
    raise exception 'Legal name is too long';
  end if;
  if length(normalized_owner_name) not between 2 and 120 then
    raise exception 'Owner name must contain between 2 and 120 characters';
  end if;
  if normalized_email is not null
    and normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Business email is invalid';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be an ISO three-letter code';
  end if;
  if normalized_invoice_prefix !~ '^[A-Z0-9-]{1,8}$' then
    raise exception 'Invoice prefix must use 1 to 8 letters, numbers or hyphens';
  end if;
  if target_vat_rate is null or target_vat_rate < 0 or target_vat_rate > 100 then
    raise exception 'VAT rate must be between 0 and 100';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = normalized_timezone
  ) then
    raise exception 'Timezone is invalid';
  end if;
  if coalesce(normalized_theme->>'preset', '') not in (
    'obsidian-gold', 'ocean', 'forest', 'clay', 'slate', 'custom'
  ) then
    raise exception 'Theme preset is invalid';
  end if;
  if coalesce(normalized_theme->>'mode', '') not in ('dark', 'light', 'system') then
    raise exception 'Theme mode is invalid';
  end if;
  if coalesce(normalized_theme->>'accentColor', '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Accent colour is invalid';
  end if;
  if coalesce(normalized_theme->>'fontFamily', '') not in ('manrope', 'dm-sans', 'system') then
    raise exception 'Font family is invalid';
  end if;
  if coalesce(normalized_theme->>'density', '') not in ('compact', 'comfortable', 'spacious') then
    raise exception 'Interface density is invalid';
  end if;
  if coalesce((normalized_theme->>'textScale')::numeric, 0) < 0.9
    or coalesce((normalized_theme->>'textScale')::numeric, 0) > 1.2
  then
    raise exception 'Text scale is invalid';
  end if;

  update public.workspaces
  set
    name = normalized_business_name,
    legal_name = normalized_legal_name,
    updated_at = target_occurred_at
  where id = target_workspace_id;

  insert into public.workspace_settings (
    workspace_id,
    owner_name,
    email,
    phone,
    currency,
    invoice_prefix,
    vat_rate,
    timezone,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    normalized_owner_name,
    normalized_email,
    normalized_phone,
    normalized_currency,
    normalized_invoice_prefix,
    target_vat_rate,
    normalized_timezone,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    owner_name = excluded.owner_name,
    email = excluded.email,
    phone = excluded.phone,
    currency = excluded.currency,
    invoice_prefix = excluded.invoice_prefix,
    vat_rate = excluded.vat_rate,
    timezone = excluded.timezone,
    updated_at = excluded.updated_at;

  insert into public.workspace_themes (
    workspace_id,
    preset,
    mode,
    accent_color,
    font_family,
    text_scale,
    density,
    high_contrast,
    reduced_motion,
    client_logo_path,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    normalized_theme->>'preset',
    normalized_theme->>'mode',
    normalized_theme->>'accentColor',
    normalized_theme->>'fontFamily',
    (normalized_theme->>'textScale')::numeric,
    normalized_theme->>'density',
    coalesce((normalized_theme->>'highContrast')::boolean, false),
    coalesce((normalized_theme->>'reducedMotion')::boolean, false),
    (
      select client_logo_path
      from public.workspace_themes
      where workspace_id = target_workspace_id
    ),
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    preset = excluded.preset,
    mode = excluded.mode,
    accent_color = excluded.accent_color,
    font_family = excluded.font_family,
    text_scale = excluded.text_scale,
    density = excluded.density,
    high_contrast = excluded.high_contrast,
    reduced_motion = excluded.reduced_motion,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace settings updated',
    normalized_business_name,
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object('currency', normalized_currency, 'timezone', normalized_timezone)
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.settings_updated',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('command_id', target_command_id),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'businessName', normalized_business_name,
    'legalName', normalized_legal_name,
    'ownerName', normalized_owner_name,
    'email', normalized_email,
    'phone', normalized_phone,
    'currency', normalized_currency,
    'invoicePrefix', normalized_invoice_prefix,
    'vatRate', target_vat_rate,
    'timezone', normalized_timezone,
    'theme', normalized_theme,
    'updatedAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'update_configuration',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

create or replace function public.set_workspace_logo(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_logo_path text,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  previous_logo_path text;
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace appearance management is not permitted';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'set_logo'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different logo';
    end if;
    return existing_receipt.result;
  end if;

  if target_logo_path !~ ('^' || target_workspace_id::text || '/branding/[a-zA-Z0-9._-]+$') then
    raise exception 'Logo path is outside the workspace branding area';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'workspace-assets'
      and name = target_logo_path
  ) then
    raise exception 'Uploaded logo object does not exist';
  end if;

  select client_logo_path
  into previous_logo_path
  from public.workspace_themes
  where workspace_id = target_workspace_id;

  insert into public.workspace_themes (
    workspace_id,
    client_logo_path,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    target_logo_path,
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    client_logo_path = excluded.client_logo_path,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace logo updated',
    target_logo_path,
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'logoPath', target_logo_path,
    'previousLogoPath', previous_logo_path,
    'updatedAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'set_logo',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

create or replace function public.export_workspace_snapshot(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_exported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_table text;
  table_rows jsonb;
  sections jsonb := '{}'::jsonb;
  workspace_row public.workspaces%rowtype;
  storage_manifest jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'recover'
  ) then
    raise exception 'Workspace export is restricted to the owner';
  end if;

  select *
  into workspace_row
  from public.workspaces
  where id = target_workspace_id
    and status in ('trial', 'active');

  if not found then
    raise exception 'Workspace is not available';
  end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source_row) order by to_jsonb(source_row)::text), ''[]''::jsonb)
       from public.%I source_row
       where source_row.workspace_id = $1',
      target_table
    )
    into table_rows
    using target_workspace_id;

    sections := sections || jsonb_build_object(target_table, table_rows);
  end loop;

  select jsonb_build_object(
    'workspaceAssets',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', 'workspace-assets', 'path', theme.client_logo_path))
      from public.workspace_themes theme
      where theme.workspace_id = target_workspace_id
        and theme.client_logo_path is not null
    ), '[]'::jsonb),
    'workspaceDocuments',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', 'workspace-documents', 'path', document.storage_path))
      from public.documents document
      where document.workspace_id = target_workspace_id
        and document.storage_path is not null
    ), '[]'::jsonb),
    'supplierDocuments',
    coalesce((
      select jsonb_agg(jsonb_build_object('bucket', document.file_bucket, 'path', document.file_path))
      from public.supplier_documents document
      where document.workspace_id = target_workspace_id
        and document.file_bucket is not null
        and document.file_path is not null
    ), '[]'::jsonb)
  )
  into storage_manifest;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.snapshot_exported',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('schema_version', 1),
    target_exported_at
  );

  return jsonb_build_object(
    'format', 'bdb_workspace_snapshot',
    'schemaVersion', 1,
    'workspaceId', target_workspace_id,
    'exportedAt', target_exported_at,
    'workspace', jsonb_build_object(
      'name', workspace_row.name,
      'legalName', workspace_row.legal_name
    ),
    'sections', sections,
    'storageManifest', storage_manifest,
    'exclusions', jsonb_build_array(
      'authentication',
      'workspace memberships',
      'member permissions',
      'feature entitlements',
      'billing and subscriptions',
      'command receipts',
      'audit and activity logs',
      'device subscriptions'
    )
  );
end;
$function$;

create or replace function public.restore_workspace_snapshot(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_snapshot jsonb,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  allowed_tables text[] := private.workspace_restorable_tables();
  target_table text;
  section_rows jsonb;
  sanitized_rows jsonb;
  row_count bigint;
  restored_counts jsonb := '{}'::jsonb;
  extra_section text;
  missing_object jsonb;
  snapshot_workspace jsonb := coalesce(target_snapshot->'workspace', '{}'::jsonb);
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'recover'
  ) then
    raise exception 'Workspace restore is restricted to the owner';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'restore_snapshot'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different snapshot';
    end if;
    return existing_receipt.result;
  end if;

  if coalesce(target_snapshot->>'format', '') <> 'bdb_workspace_snapshot'
    or coalesce((target_snapshot->>'schemaVersion')::integer, 0) <> 1
    or coalesce(target_snapshot->>'workspaceId', '') <> target_workspace_id::text
    or jsonb_typeof(target_snapshot->'sections') <> 'object'
  then
    raise exception 'Snapshot format, version or workspace identity is invalid';
  end if;

  select section_name
  into extra_section
  from jsonb_object_keys(target_snapshot->'sections') as section_name
  where not (section_name = any(allowed_tables))
  limit 1;

  if extra_section is not null then
    raise exception 'Snapshot contains unsupported section: %', extra_section;
  end if;

  if private.workspace_restorable_record_count(
    target_workspace_id,
    target_actor_user_id
  ) > 0 then
    raise exception 'Workspace restore requires an empty operational workspace';
  end if;

  select object_row
  into missing_object
  from (
    select value as object_row
    from jsonb_array_elements(
      coalesce(target_snapshot->'storageManifest'->'workspaceAssets', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'workspaceDocuments', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'supplierDocuments', '[]'::jsonb)
    )
  ) objects
  where not exists (
    select 1
    from storage.objects stored
    where stored.bucket_id = object_row->>'bucket'
      and stored.name = object_row->>'path'
  )
  limit 1;

  if missing_object is not null then
    raise exception 'Snapshot references a missing storage object: %/%',
      missing_object->>'bucket',
      missing_object->>'path';
  end if;

  delete from public.workspace_settings where workspace_id = target_workspace_id;
  delete from public.workspace_themes where workspace_id = target_workspace_id;

  update public.workspaces
  set
    name = coalesce(nullif(btrim(snapshot_workspace->>'name'), ''), name),
    legal_name = nullif(btrim(coalesce(snapshot_workspace->>'legalName', '')), ''),
    updated_at = target_occurred_at
  where id = target_workspace_id;

  foreach target_table in array allowed_tables
  loop
    section_rows := coalesce(target_snapshot->'sections'->target_table, '[]'::jsonb);
    if jsonb_typeof(section_rows) <> 'array' then
      raise exception 'Snapshot section % is not an array', target_table;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_set(section_row, '{workspace_id}', to_jsonb(target_workspace_id), true)
      ),
      '[]'::jsonb
    )
    into sanitized_rows
    from jsonb_array_elements(section_rows) section_row;

    row_count := jsonb_array_length(sanitized_rows);
    if row_count > 0 then
      execute format(
        'insert into public.%I
         select * from jsonb_populate_recordset(null::public.%I, $1)',
        target_table,
        target_table
      )
      using sanitized_rows;
    end if;

    restored_counts := restored_counts || jsonb_build_object(target_table, row_count);
  end loop;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace snapshot restored',
    'Structured business data restored from a verified workspace snapshot',
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object('schema_version', 1, 'restored_counts', restored_counts)
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.snapshot_restored',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object(
      'command_id', target_command_id,
      'schema_version', 1,
      'restored_counts', restored_counts
    ),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'schemaVersion', 1,
    'restoredCounts', restored_counts,
    'restoredAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'restore_snapshot',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

revoke all on function public.update_workspace_configuration(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_workspace_configuration(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, text, jsonb, uuid, timestamptz
) to service_role;

revoke all on function public.set_workspace_logo(
  uuid, uuid, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_workspace_logo(
  uuid, uuid, text, text, text, uuid, timestamptz
) to service_role;

revoke all on function public.export_workspace_snapshot(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.export_workspace_snapshot(
  uuid, uuid, timestamptz
) to service_role;

revoke all on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) to service_role;

commit;


create table if not exists public.workspace_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text not null default '',
  plan_id uuid not null references public.plans(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  is_default boolean not null default false,
  settings_defaults jsonb not null default '{"currency":"GBP","invoicePrefix":"BDB","vatRate":20,"timezone":"Europe/London"}'::jsonb
    check (jsonb_typeof(settings_defaults) = 'object'),
  theme_defaults jsonb not null default '{"preset":"obsidian-gold","mode":"dark","accentColor":"#d3a84b","fontFamily":"manrope","textScale":1,"density":"comfortable","highContrast":false,"reducedMotion":false}'::jsonb
    check (jsonb_typeof(theme_defaults) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_templates_one_default_idx
  on public.workspace_templates (is_default)
  where is_default and is_active;
create index if not exists workspace_templates_plan_idx
  on public.workspace_templates (plan_id);
create index if not exists workspace_templates_active_name_idx
  on public.workspace_templates (is_active, name);

create table if not exists public.workspace_template_features (
  template_id uuid not null references public.workspace_templates(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (template_id, feature_key)
);

create index if not exists workspace_template_features_feature_idx
  on public.workspace_template_features (feature_key);

create table if not exists public.workspace_template_permissions (
  template_id uuid not null references public.workspace_templates(id) on delete cascade,
  access_profile text not null check (access_profile in ('manager', 'employee', 'custom')),
  feature_key text not null references public.features(key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (template_id, access_profile, feature_key)
);

create index if not exists workspace_template_permissions_feature_idx
  on public.workspace_template_permissions (feature_key);

create table if not exists public.workspace_access_profile_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  access_profile text not null check (access_profile in ('manager', 'employee', 'custom')),
  feature_key text not null references public.features(key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  source_template_id uuid references public.workspace_templates(id) on delete set null,
  source_template_version integer check (source_template_version is null or source_template_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, access_profile, feature_key)
);

create index if not exists workspace_access_profile_permissions_feature_idx
  on public.workspace_access_profile_permissions (feature_key);
create index if not exists workspace_access_profile_permissions_template_idx
  on public.workspace_access_profile_permissions (source_template_id);

alter table public.workspaces
  add column if not exists workspace_template_id uuid references public.workspace_templates(id) on delete set null,
  add column if not exists workspace_template_version integer check (workspace_template_version is null or workspace_template_version > 0);

create index if not exists workspaces_workspace_template_idx
  on public.workspaces (workspace_template_id);

alter table public.workspace_templates enable row level security;
alter table public.workspace_template_features enable row level security;
alter table public.workspace_template_permissions enable row level security;
alter table public.workspace_access_profile_permissions enable row level security;

revoke all on table public.workspace_templates from anon, authenticated;
revoke all on table public.workspace_template_features from anon, authenticated;
revoke all on table public.workspace_template_permissions from anon, authenticated;
revoke all on table public.workspace_access_profile_permissions from anon, authenticated;

grant all on table public.workspace_templates to service_role;
grant all on table public.workspace_template_features to service_role;
grant all on table public.workspace_template_permissions to service_role;
grant all on table public.workspace_access_profile_permissions to service_role;

insert into public.workspace_templates (
  code,
  name,
  description,
  plan_id,
  is_default,
  settings_defaults,
  theme_defaults
)
select
  trim(both '-' from regexp_replace(lower(plan.code), '[^a-z0-9]+', '-', 'g')) || '-workspace',
  plan.name || ' workspace',
  'Version 1 workspace template aligned with the ' || plan.name || ' plan.',
  plan.id,
  plan.sort_order = (select min(active_plan.sort_order) from public.plans active_plan where active_plan.is_active),
  '{"currency":"GBP","invoicePrefix":"BDB","vatRate":20,"timezone":"Europe/London"}'::jsonb,
  '{"preset":"obsidian-gold","mode":"dark","accentColor":"#d3a84b","fontFamily":"manrope","textScale":1,"density":"comfortable","highContrast":false,"reducedMotion":false}'::jsonb
from public.plans plan
where plan.is_active
on conflict (code) do nothing;

insert into public.workspace_template_features (template_id, feature_key, enabled)
select template.id, feature.key, coalesce(plan_feature.enabled, false)
from public.workspace_templates template
join public.plans plan on plan.id = template.plan_id
cross join public.features feature
left join public.plan_features plan_feature
  on plan_feature.plan_id = plan.id
 and plan_feature.feature_key = feature.key
where template.code = trim(both '-' from regexp_replace(lower(plan.code), '[^a-z0-9]+', '-', 'g')) || '-workspace'
  and feature.is_active
on conflict (template_id, feature_key) do nothing;

insert into public.workspace_template_permissions (
  template_id,
  access_profile,
  feature_key,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_approve,
  can_export
)
select
  template.id,
  profile.access_profile,
  feature.key,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  false,
  profile.access_profile = 'manager',
  profile.access_profile = 'manager'
from public.workspace_templates template
cross join (values ('manager'), ('employee'), ('custom')) as profile(access_profile)
cross join public.features feature
where feature.is_active
on conflict (template_id, access_profile, feature_key) do nothing;

insert into public.workspace_access_profile_permissions (
  workspace_id,
  access_profile,
  feature_key,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_approve,
  can_export
)
select
  workspace.id,
  profile.access_profile,
  feature.key,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  case when profile.access_profile in ('manager', 'employee') then true else false end,
  false,
  profile.access_profile = 'manager',
  profile.access_profile = 'manager'
from public.workspaces workspace
cross join (values ('manager'), ('employee'), ('custom')) as profile(access_profile)
cross join public.features feature
where feature.is_active
on conflict (workspace_id, access_profile, feature_key) do nothing;

create or replace function private.actor_has_workspace_permission(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_feature_key text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with membership as (
    select member.access_profile
    from public.workspace_memberships member
    join public.workspaces workspace on workspace.id = member.workspace_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_actor_user_id
      and member.status = 'active'
      and workspace.status in ('trial', 'active')
      and profile.is_active
    limit 1
  ), explicit_permission as (
    select permission.*
    from public.workspace_member_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.user_id = target_actor_user_id
      and permission.feature_key = target_feature_key
    limit 1
  ), profile_permission as (
    select permission.*
    from public.workspace_access_profile_permissions permission
    where permission.workspace_id = target_workspace_id
      and permission.access_profile = (select access_profile from membership)
      and permission.feature_key = target_feature_key
    limit 1
  )
  select case
    when not private.has_feature(target_workspace_id, target_feature_key) then false
    when not exists (select 1 from membership) then false
    when (select access_profile from membership) = 'owner' then true
    when exists (select 1 from explicit_permission) then case target_action
      when 'view' then (select can_view from explicit_permission)
      when 'create' then (select can_create from explicit_permission)
      when 'edit' then (select can_edit from explicit_permission)
      when 'delete' then (select can_delete from explicit_permission)
      when 'approve' then (select can_approve from explicit_permission)
      when 'export' then (select can_export from explicit_permission)
      else false
    end
    when exists (select 1 from profile_permission) then case target_action
      when 'view' then (select can_view from profile_permission)
      when 'create' then (select can_create from profile_permission)
      when 'edit' then (select can_edit from profile_permission)
      when 'delete' then (select can_delete from profile_permission)
      when 'approve' then (select can_approve from profile_permission)
      when 'export' then (select can_export from profile_permission)
      else false
    end
    when (select access_profile from membership) = 'manager'
      then target_action in ('view', 'create', 'edit', 'approve', 'export')
    when (select access_profile from membership) = 'employee'
      then target_action in ('view', 'create', 'edit')
    else false
  end;
$function$;

comment on table public.workspace_templates is
  'Founder-managed, versioned starting configuration for new workspaces. Existing workspaces receive a snapshot and do not follow later template edits automatically.';
comment on table public.workspace_access_profile_permissions is
  'Workspace-scoped Manager, Employee and Custom permission presets copied from the selected provisioning template.';
comment on column public.workspaces.workspace_template_id is
  'Template used when this workspace was provisioned. Null means legacy or deliberately custom provisioning.';
comment on column public.workspaces.workspace_template_version is
  'Template version copied at provisioning time. Later template edits do not mutate this workspace automatically.';


create or replace function public.save_workspace_template(
  target_actor_user_id uuid,
  target_template_id uuid,
  target_code text,
  target_name text,
  target_description text,
  target_plan_id uuid,
  target_is_active boolean,
  target_is_default boolean,
  target_settings_defaults jsonb,
  target_theme_defaults jsonb,
  target_features jsonb,
  target_permissions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_template_id uuid;
  resolved_version integer;
  normalized_code text := lower(btrim(coalesce(target_code, '')));
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_settings jsonb := jsonb_build_object(
    'currency', 'GBP',
    'invoicePrefix', 'BDB',
    'vatRate', 20,
    'timezone', 'Europe/London'
  ) || coalesce(target_settings_defaults, '{}'::jsonb);
  normalized_theme jsonb := jsonb_build_object(
    'preset', 'obsidian-gold',
    'mode', 'dark',
    'accentColor', '#d3a84b',
    'fontFamily', 'manrope',
    'textScale', 1,
    'density', 'comfortable',
    'highContrast', false,
    'reducedMotion', false
  ) || coalesce(target_theme_defaults, '{}'::jsonb);
  active_feature_count integer;
  supplied_feature_count integer;
  supplied_permission_count integer;
begin
  if not exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = target_actor_user_id
      and admin.active
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_TEMPLATE_CODE';
  end if;
  if char_length(normalized_name) not between 2 and 100 then
    raise exception 'INVALID_TEMPLATE_NAME';
  end if;
  if not exists (
    select 1 from public.plans plan where plan.id = target_plan_id and plan.is_active
  ) then
    raise exception 'ACTIVE_PLAN_REQUIRED';
  end if;
  if jsonb_typeof(normalized_settings) <> 'object' or jsonb_typeof(normalized_theme) <> 'object' then
    raise exception 'INVALID_TEMPLATE_DEFAULTS';
  end if;
  if coalesce(normalized_settings->>'currency', '') !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_TEMPLATE_CURRENCY';
  end if;
  if coalesce(normalized_settings->>'invoicePrefix', '') !~ '^[A-Za-z0-9-]{1,12}$' then
    raise exception 'INVALID_TEMPLATE_INVOICE_PREFIX';
  end if;
  if coalesce((normalized_settings->>'vatRate')::numeric, -1) < 0
     or coalesce((normalized_settings->>'vatRate')::numeric, 101) > 100 then
    raise exception 'INVALID_TEMPLATE_VAT_RATE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names timezone
    where timezone.name = normalized_settings->>'timezone'
  ) then
    raise exception 'INVALID_TEMPLATE_TIMEZONE';
  end if;
  if coalesce(normalized_theme->>'mode', '') not in ('dark', 'light') then
    raise exception 'INVALID_TEMPLATE_MODE';
  end if;
  if coalesce(normalized_theme->>'density', '') not in ('comfortable', 'compact') then
    raise exception 'INVALID_TEMPLATE_DENSITY';
  end if;
  if coalesce(normalized_theme->>'accentColor', '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'INVALID_TEMPLATE_ACCENT';
  end if;
  if coalesce((normalized_theme->>'textScale')::numeric, 0) < 0.8
     or coalesce((normalized_theme->>'textScale')::numeric, 2) > 1.4 then
    raise exception 'INVALID_TEMPLATE_TEXT_SCALE';
  end if;
  if jsonb_typeof(target_features) <> 'array' or jsonb_typeof(target_permissions) <> 'array' then
    raise exception 'INVALID_TEMPLATE_MATRIX';
  end if;

  select count(*) into active_feature_count
  from public.features feature
  where feature.is_active;

  select count(distinct item->>'featureKey') into supplied_feature_count
  from jsonb_array_elements(target_features) item;

  if supplied_feature_count <> active_feature_count
     or exists (
       select 1
       from jsonb_array_elements(target_features) item
       left join public.features feature
         on feature.key = item->>'featureKey'
        and feature.is_active
       where feature.key is null
     ) then
    raise exception 'INCOMPLETE_TEMPLATE_FEATURE_MATRIX';
  end if;

  select count(distinct concat_ws(':', item->>'accessProfile', item->>'featureKey'))
  into supplied_permission_count
  from jsonb_array_elements(target_permissions) item;

  if supplied_permission_count <> active_feature_count * 3
     or exists (
       select 1
       from jsonb_array_elements(target_permissions) item
       left join public.features feature
         on feature.key = item->>'featureKey'
        and feature.is_active
       where feature.key is null
          or item->>'accessProfile' not in ('manager', 'employee', 'custom')
     ) then
    raise exception 'INCOMPLETE_TEMPLATE_PERMISSION_MATRIX';
  end if;

  if target_template_id is null then
    insert into public.workspace_templates (
      code,
      name,
      description,
      plan_id,
      is_active,
      is_default,
      settings_defaults,
      theme_defaults,
      created_by,
      updated_by
    ) values (
      normalized_code,
      normalized_name,
      btrim(coalesce(target_description, '')),
      target_plan_id,
      coalesce(target_is_active, true),
      coalesce(target_is_default, false),
      normalized_settings,
      normalized_theme,
      target_actor_user_id,
      target_actor_user_id
    )
    returning id, version into resolved_template_id, resolved_version;
  else
    update public.workspace_templates template
    set code = normalized_code,
        name = normalized_name,
        description = btrim(coalesce(target_description, '')),
        plan_id = target_plan_id,
        is_active = coalesce(target_is_active, true),
        is_default = coalesce(target_is_default, false),
        settings_defaults = normalized_settings,
        theme_defaults = normalized_theme,
        version = template.version + 1,
        updated_by = target_actor_user_id,
        updated_at = now()
    where template.id = target_template_id
    returning template.id, template.version into resolved_template_id, resolved_version;

    if resolved_template_id is null then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if coalesce(target_is_default, false) and coalesce(target_is_active, true) then
    update public.workspace_templates template
    set is_default = false,
        updated_by = target_actor_user_id,
        updated_at = now()
    where template.id <> resolved_template_id
      and template.is_default;
  end if;

  delete from public.workspace_template_features
  where template_id = resolved_template_id;

  insert into public.workspace_template_features (template_id, feature_key, enabled)
  select
    resolved_template_id,
    item->>'featureKey',
    coalesce((item->>'enabled')::boolean, false)
  from jsonb_array_elements(target_features) item;

  delete from public.workspace_template_permissions
  where template_id = resolved_template_id;

  insert into public.workspace_template_permissions (
    template_id,
    access_profile,
    feature_key,
    can_view,
    can_create,
    can_edit,
    can_delete,
    can_approve,
    can_export
  )
  select
    resolved_template_id,
    item->>'accessProfile',
    item->>'featureKey',
    coalesce((item->>'can_view')::boolean, false),
    coalesce((item->>'can_create')::boolean, false),
    coalesce((item->>'can_edit')::boolean, false),
    coalesce((item->>'can_delete')::boolean, false),
    coalesce((item->>'can_approve')::boolean, false),
    coalesce((item->>'can_export')::boolean, false)
  from jsonb_array_elements(target_permissions) item;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_actor_user_id,
    case when target_template_id is null then 'workspace_template.created' else 'workspace_template.updated' end,
    'workspace_template',
    resolved_template_id::text,
    jsonb_build_object(
      'code', normalized_code,
      'name', normalized_name,
      'version', resolved_version,
      'plan_id', target_plan_id,
      'active', coalesce(target_is_active, true),
      'default', coalesce(target_is_default, false)
    )
  );

  return resolved_template_id;
end;
$function$;

create or replace function public.apply_workspace_template(
  target_workspace_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid,
  target_owner_name text,
  target_owner_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_template public.workspace_templates%rowtype;
  settings jsonb;
  theme jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = target_actor_user_id
      and admin.active
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  select template.* into selected_template
  from public.workspace_templates template
  where template.id = target_template_id
    and template.is_active
  for share;

  if selected_template.id is null then
    raise exception 'ACTIVE_TEMPLATE_REQUIRED';
  end if;

  if not exists (
    select 1 from public.workspaces workspace where workspace.id = target_workspace_id
  ) then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.workspace_settings settings_row where settings_row.workspace_id = target_workspace_id
  ) or exists (
    select 1 from public.workspace_themes theme_row where theme_row.workspace_id = target_workspace_id
  ) or exists (
    select 1 from public.workspace_memberships membership where membership.workspace_id = target_workspace_id
  ) then
    raise exception 'WORKSPACE_ALREADY_CONFIGURED';
  end if;

  settings := selected_template.settings_defaults;
  theme := selected_template.theme_defaults;

  update public.workspaces workspace
  set plan_id = selected_template.plan_id,
      workspace_template_id = selected_template.id,
      workspace_template_version = selected_template.version,
      updated_at = now()
  where workspace.id = target_workspace_id;

  insert into public.workspace_settings (
    workspace_id,
    owner_name,
    email,
    currency,
    invoice_prefix,
    vat_rate,
    timezone
  ) values (
    target_workspace_id,
    btrim(coalesce(target_owner_name, '')),
    nullif(btrim(coalesce(target_owner_email, '')), ''),
    settings->>'currency',
    settings->>'invoicePrefix',
    (settings->>'vatRate')::numeric,
    settings->>'timezone'
  );

  insert into public.workspace_themes (
    workspace_id,
    preset,
    mode,
    accent_color,
    font_family,
    text_scale,
    density,
    high_contrast,
    reduced_motion,
    updated_by
  ) values (
    target_workspace_id,
    theme->>'preset',
    theme->>'mode',
    theme->>'accentColor',
    theme->>'fontFamily',
    (theme->>'textScale')::numeric,
    theme->>'density',
    coalesce((theme->>'highContrast')::boolean, false),
    coalesce((theme->>'reducedMotion')::boolean, false),
    target_actor_user_id
  );

  insert into public.workspace_feature_overrides (
    workspace_id,
    feature_key,
    enabled,
    reason,
    starts_at,
    created_by
  )
  select
    target_workspace_id,
    feature.feature_key,
    feature.enabled,
    'Workspace template ' || selected_template.code || ' v' || selected_template.version,
    now(),
    target_actor_user_id
  from public.workspace_template_features feature
  where feature.template_id = selected_template.id;

  insert into public.workspace_access_profile_permissions (
    workspace_id,
    access_profile,
    feature_key,
    can_view,
    can_create,
    can_edit,
    can_delete,
    can_approve,
    can_export,
    source_template_id,
    source_template_version
  )
  select
    target_workspace_id,
    permission.access_profile,
    permission.feature_key,
    permission.can_view,
    permission.can_create,
    permission.can_edit,
    permission.can_delete,
    permission.can_approve,
    permission.can_export,
    selected_template.id,
    selected_template.version
  from public.workspace_template_permissions permission
  where permission.template_id = selected_template.id;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.template_applied',
    'workspace_template',
    selected_template.id::text,
    jsonb_build_object(
      'template_code', selected_template.code,
      'template_version', selected_template.version,
      'plan_id', selected_template.plan_id
    )
  );

  return jsonb_build_object(
    'templateId', selected_template.id,
    'templateCode', selected_template.code,
    'templateVersion', selected_template.version,
    'planId', selected_template.plan_id
  );
end;
$function$;

revoke all on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_workspace_template(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.apply_workspace_template(uuid, uuid, uuid, text, text) to service_role;

comment on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) is
  'Service-role-only transactional command for creating or versioning a complete Founder workspace template.';
comment on function public.apply_workspace_template(uuid, uuid, uuid, text, text) is
  'Service-role-only provisioning command that snapshots one active template into a new, otherwise unconfigured workspace.';


create index if not exists workspace_templates_created_by_idx
  on public.workspace_templates (created_by)
  where created_by is not null;

create index if not exists workspace_templates_updated_by_idx
  on public.workspace_templates (updated_by)
  where updated_by is not null;

comment on index public.workspace_templates_created_by_idx is
  'Covers the template creator audit foreign key without indexing null seeded rows.';
comment on index public.workspace_templates_updated_by_idx is
  'Covers the template updater audit foreign key without indexing null seeded rows.';


begin;

create table if not exists public.workspace_operational_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  default_export_format text not null default 'csv'
    check (default_export_format in ('csv', 'json')),
  archived_records_default text not null default 'hide'
    check (archived_records_default in ('hide', 'show')),
  appointment_reminders_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_operational_settings_updated_by_idx
  on public.workspace_operational_settings(updated_by);

alter table public.workspace_operational_settings enable row level security;

drop policy if exists "Members view workspace operational settings"
  on public.workspace_operational_settings;
create policy "Members view workspace operational settings"
  on public.workspace_operational_settings
  for select
  to authenticated
  using (private.can_read_workspace(workspace_id));

grant select on public.workspace_operational_settings to authenticated;
revoke insert, update, delete, truncate on public.workspace_operational_settings from authenticated;
grant all on public.workspace_operational_settings to service_role;

insert into public.workspace_operational_settings (workspace_id)
select workspace.id
from public.workspaces workspace
on conflict (workspace_id) do nothing;

alter table public.workspace_recovery_receipts
  drop constraint if exists workspace_recovery_receipts_action_check;
alter table public.workspace_recovery_receipts
  add constraint workspace_recovery_receipts_action_check
  check (action in ('update_configuration', 'update_operations', 'set_logo', 'restore_snapshot'));

create or replace function public.update_workspace_operational_settings(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_fiscal_year_start_month integer,
  target_default_export_format text,
  target_archived_records_default text,
  target_appointment_reminders_enabled boolean,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  normalized_export_format text := lower(btrim(coalesce(target_default_export_format, '')));
  normalized_archive_default text := lower(btrim(coalesce(target_archived_records_default, '')));
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'manage'
  ) then
    raise exception 'Workspace settings management is not permitted';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'update_operations'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with different operational settings input';
    end if;
    return existing_receipt.result;
  end if;

  if target_fiscal_year_start_month is null
    or target_fiscal_year_start_month not between 1 and 12
  then
    raise exception 'Fiscal year start month must be between 1 and 12';
  end if;

  if normalized_export_format not in ('csv', 'json') then
    raise exception 'Default export format must be CSV or JSON';
  end if;

  if normalized_archive_default not in ('hide', 'show') then
    raise exception 'Archived record visibility must be hide or show';
  end if;

  insert into public.workspace_operational_settings (
    workspace_id,
    fiscal_year_start_month,
    default_export_format,
    archived_records_default,
    appointment_reminders_enabled,
    updated_by,
    created_at,
    updated_at
  )
  values (
    target_workspace_id,
    target_fiscal_year_start_month,
    normalized_export_format,
    normalized_archive_default,
    coalesce(target_appointment_reminders_enabled, true),
    target_actor_user_id,
    target_occurred_at,
    target_occurred_at
  )
  on conflict (workspace_id) do update
  set
    fiscal_year_start_month = excluded.fiscal_year_start_month,
    default_export_format = excluded.default_export_format,
    archived_records_default = excluded.archived_records_default,
    appointment_reminders_enabled = excluded.appointment_reminders_enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Operational settings updated',
    'Reporting, archive and reminder preferences',
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object(
      'fiscal_year_start_month', target_fiscal_year_start_month,
      'default_export_format', normalized_export_format,
      'archived_records_default', normalized_archive_default,
      'appointment_reminders_enabled', coalesce(target_appointment_reminders_enabled, true)
    )
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.operational_settings_updated',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object('command_id', target_command_id),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'fiscalYearStartMonth', target_fiscal_year_start_month,
    'defaultExportFormat', normalized_export_format,
    'archivedRecordsDefault', normalized_archive_default,
    'appointmentRemindersEnabled', coalesce(target_appointment_reminders_enabled, true),
    'updatedAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'update_operations',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

revoke all on function public.update_workspace_operational_settings(
  uuid, uuid, text, text, integer, text, text, boolean, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_workspace_operational_settings(
  uuid, uuid, text, text, integer, text, text, boolean, uuid, timestamptz
) to service_role;

create or replace function private.workspace_restorable_tables()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'workspace_settings',
    'workspace_themes',
    'workspace_operational_settings',
    'customers',
    'products',
    'suppliers',
    'services',
    'inventory_locations',
    'calendar_rooms',
    'bank_accounts',
    'automations',
    'product_suppliers',
    'calendar_staff_working_hours',
    'calendar_staff_breaks',
    'calendar_staff_leave',
    'calendar_staff_service_eligibility',
    'communication_threads',
    'messages',
    'bookings',
    'sales',
    'sale_lines',
    'sale_drafts',
    'invoices',
    'invoice_lines',
    'payments',
    'supplier_documents',
    'supplier_document_lines',
    'supplier_document_extraction_runs',
    'supplier_payables',
    'supplier_payments',
    'inventory_movements',
    'payment_allocations',
    'supplier_payment_allocations',
    'supplier_credit_allocations',
    'bank_statement_imports',
    'bank_transactions',
    'bank_reconciliation_allocations',
    'customer_notes',
    'documents',
    'document_links'
  ]::text[];
$function$;

create or replace function private.workspace_restorable_record_count(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_table text;
  total_count bigint := 0;
  table_count bigint;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'view'
  ) then
    return 0;
  end if;

  foreach target_table in array private.workspace_restorable_tables()
  loop
    if target_table in (
      'workspace_settings',
      'workspace_themes',
      'workspace_operational_settings'
    ) then
      continue;
    end if;
    execute format(
      'select count(*) from public.%I where workspace_id = $1',
      target_table
    )
    into table_count
    using target_workspace_id;
    total_count := total_count + table_count;
  end loop;

  return total_count;
end;
$function$;

create or replace function public.due_appointment_reminders()
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  workspace_id uuid,
  user_id uuid,
  booking_id uuid,
  title text,
  starts_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    booking.workspace_id,
    subscription.user_id,
    booking.id,
    booking.title,
    (booking.booking_date + booking.booking_time)
      at time zone coalesce(settings.timezone, 'Europe/London')
  from public.bookings booking
  join public.workspace_settings settings
    on settings.workspace_id = booking.workspace_id
  left join public.workspace_operational_settings operations
    on operations.workspace_id = booking.workspace_id
  join public.push_subscriptions subscription
    on subscription.workspace_id = booking.workspace_id
  join public.workspace_memberships membership
    on membership.workspace_id = booking.workspace_id
    and membership.user_id = subscription.user_id
    and membership.status = 'active'
  where booking.status in ('confirmed', 'pending')
    and coalesce(operations.appointment_reminders_enabled, true)
    and (booking.booking_date + booking.booking_time)
      at time zone coalesce(settings.timezone, 'Europe/London')
      between now() + interval '55 minutes' and now() + interval '65 minutes'
    and not exists (
      select 1
      from public.notification_deliveries delivery
      where delivery.user_id = subscription.user_id
        and delivery.booking_id = booking.id
        and delivery.notification_type = 'appointment_reminder'
    );
$function$;

revoke all on function public.due_appointment_reminders()
  from public, anon, authenticated;
grant execute on function public.due_appointment_reminders()
  to service_role;

commit;


begin;

create or replace function public.restore_workspace_snapshot(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_snapshot jsonb,
  target_command_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_receipt public.workspace_recovery_receipts%rowtype;
  allowed_tables text[] := private.workspace_restorable_tables();
  target_table text;
  section_rows jsonb;
  sanitized_rows jsonb;
  row_count bigint;
  restored_counts jsonb := '{}'::jsonb;
  extra_section text;
  missing_object jsonb;
  snapshot_workspace jsonb := coalesce(target_snapshot->'workspace', '{}'::jsonb);
  result_payload jsonb;
begin
  if not private.actor_has_workspace_admin_access(
    target_workspace_id,
    target_actor_user_id,
    'recover'
  ) then
    raise exception 'Workspace restore is restricted to the owner';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null
    or length(target_idempotency_key) > 128
    or target_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'A valid idempotency key and request hash are required';
  end if;

  select *
  into existing_receipt
  from public.workspace_recovery_receipts
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_receipt.action <> 'restore_snapshot'
      or existing_receipt.request_hash <> target_request_hash
    then
      raise exception 'Idempotency key was reused with a different snapshot';
    end if;
    return existing_receipt.result;
  end if;

  if coalesce(target_snapshot->>'format', '') <> 'bdb_workspace_snapshot'
    or coalesce((target_snapshot->>'schemaVersion')::integer, 0) <> 1
    or coalesce(target_snapshot->>'workspaceId', '') <> target_workspace_id::text
    or jsonb_typeof(target_snapshot->'sections') <> 'object'
  then
    raise exception 'Snapshot format, version or workspace identity is invalid';
  end if;

  select section_name
  into extra_section
  from jsonb_object_keys(target_snapshot->'sections') as section_name
  where not (section_name = any(allowed_tables))
  limit 1;

  if extra_section is not null then
    raise exception 'Snapshot contains unsupported section: %', extra_section;
  end if;

  if private.workspace_restorable_record_count(
    target_workspace_id,
    target_actor_user_id
  ) > 0 then
    raise exception 'Workspace restore requires an empty operational workspace';
  end if;

  select object_row
  into missing_object
  from (
    select value as object_row
    from jsonb_array_elements(
      coalesce(target_snapshot->'storageManifest'->'workspaceAssets', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'workspaceDocuments', '[]'::jsonb)
      || coalesce(target_snapshot->'storageManifest'->'supplierDocuments', '[]'::jsonb)
    )
  ) objects
  where not exists (
    select 1
    from storage.objects stored
    where stored.bucket_id = object_row->>'bucket'
      and stored.name = object_row->>'path'
  )
  limit 1;

  if missing_object is not null then
    raise exception 'Snapshot references a missing storage object: %/%',
      missing_object->>'bucket',
      missing_object->>'path';
  end if;

  delete from public.workspace_settings where workspace_id = target_workspace_id;
  delete from public.workspace_themes where workspace_id = target_workspace_id;
  delete from public.workspace_operational_settings where workspace_id = target_workspace_id;

  update public.workspaces
  set
    name = coalesce(nullif(btrim(snapshot_workspace->>'name'), ''), name),
    legal_name = nullif(btrim(coalesce(snapshot_workspace->>'legalName', '')), ''),
    updated_at = target_occurred_at
  where id = target_workspace_id;

  foreach target_table in array allowed_tables
  loop
    section_rows := coalesce(target_snapshot->'sections'->target_table, '[]'::jsonb);
    if jsonb_typeof(section_rows) <> 'array' then
      raise exception 'Snapshot section % is not an array', target_table;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_set(section_row, '{workspace_id}', to_jsonb(target_workspace_id), true)
      ),
      '[]'::jsonb
    )
    into sanitized_rows
    from jsonb_array_elements(section_rows) section_row;

    row_count := jsonb_array_length(sanitized_rows);
    if row_count > 0 then
      execute format(
        'insert into public.%I
         select * from jsonb_populate_recordset(null::public.%I, $1)',
        target_table,
        target_table
      )
      using sanitized_rows;
    end if;

    restored_counts := restored_counts || jsonb_build_object(target_table, row_count);
  end loop;

  insert into public.activity_items (
    workspace_id,
    actor_user_id,
    action,
    detail,
    tone,
    occurred_at,
    entity_type,
    entity_id,
    command_id,
    metadata
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'Workspace snapshot restored',
    'Structured business data restored from a verified workspace snapshot',
    'gold',
    target_occurred_at,
    'workspace',
    target_workspace_id::text,
    target_command_id,
    jsonb_build_object('schema_version', 1, 'restored_counts', restored_counts)
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.snapshot_restored',
    'workspace',
    target_workspace_id::text,
    jsonb_build_object(
      'command_id', target_command_id,
      'schema_version', 1,
      'restored_counts', restored_counts
    ),
    target_occurred_at
  );

  result_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'schemaVersion', 1,
    'restoredCounts', restored_counts,
    'restoredAt', target_occurred_at
  );

  insert into public.workspace_recovery_receipts (
    workspace_id,
    idempotency_key,
    action,
    request_hash,
    result,
    created_at
  )
  values (
    target_workspace_id,
    target_idempotency_key,
    'restore_snapshot',
    target_request_hash,
    result_payload,
    target_occurred_at
  );

  return result_payload;
end;
$function$;

revoke all on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
) to service_role;

commit;


begin;

revoke all on public.workspace_operational_settings from anon;
grant select on public.workspace_operational_settings to authenticated;
grant all on public.workspace_operational_settings to service_role;

-- This release makes every Vanita Integration module available to existing
-- Main customers without replacing workspace data or authentication settings.
insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, feature_key, true
from public.plans plan
cross join unnest(array[
  'products',
  'services',
  'suppliers',
  'sales',
  'inventory',
  'purchasing',
  'timesheets',
  'meetings'
]::text[]) as release_feature(feature_key)
where plan.is_active
on conflict (plan_id, feature_key) do update
set enabled = excluded.enabled;

insert into public.workspace_template_features (template_id, feature_key, enabled)
select template.id, release_feature.feature_key, true
from public.workspace_templates template
join public.plans plan on plan.id = template.plan_id and plan.is_active
cross join unnest(array[
  'products',
  'services',
  'suppliers',
  'sales',
  'inventory',
  'purchasing',
  'timesheets',
  'meetings'
]::text[]) as release_feature(feature_key)
on conflict (template_id, feature_key) do update
set enabled = excluded.enabled;

commit;
