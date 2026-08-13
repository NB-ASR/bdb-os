begin;

create or replace view public.customer_note_status
with (security_invoker = true)
as
select note.workspace_id,
       note.id,
       note.customer_id,
       note.body,
       note.actor_user_id,
       note.command_id,
       note.occurred_at,
       note.created_at,
       case when note_void.id is null then 'active' else 'void' end as status,
       note_void.id as void_note_id,
       note_void.reason as void_reason,
       note_void.actor_user_id as voided_by,
       note_void.occurred_at as voided_at
from public.customer_notes note
left join lateral (
  select candidate.id,
         candidate.reason,
         candidate.actor_user_id,
         candidate.occurred_at
  from public.customer_notes candidate
  where candidate.workspace_id = note.workspace_id
    and candidate.parent_note_id = note.id
    and candidate.note_kind = 'void'
  order by candidate.occurred_at desc, candidate.created_at desc
  limit 1
) note_void on true
where note.note_kind = 'note';

create or replace view public.customer_360_financial_summary
with (security_invoker = true)
as
with currencies as (
  select invoice.workspace_id, invoice.customer_id, invoice.currency
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id, invoice.currency
  union
  select payment.workspace_id, payment.customer_id, payment.currency
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id, payment.currency
), invoice_totals as (
  select invoice.workspace_id,
         invoice.customer_id,
         invoice.currency,
         count(*) filter (where invoice.status::text not in ('draft', 'void'))::integer as issued_invoice_count,
         count(*) filter (where invoice.status::text not in ('draft', 'void') and invoice.outstanding_amount > 0)::integer as open_invoice_count,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.total_amount else 0 end), 4) as issued_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.allocated_amount else 0 end), 4) as allocated_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.outstanding_amount else 0 end), 4) as outstanding_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id, invoice.currency
), payment_totals as (
  select payment.workspace_id,
         payment.customer_id,
         payment.currency,
         count(*) filter (where payment.status = 'posted')::integer as payment_count,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as received_amount,
         round(sum(payment.unallocated_amount), 4) as unallocated_credit
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id, payment.currency
)
select currency_row.workspace_id,
       currency_row.customer_id,
       currency_row.currency,
       coalesce(invoice.issued_invoice_count, 0) as issued_invoice_count,
       coalesce(invoice.open_invoice_count, 0) as open_invoice_count,
       coalesce(payment.payment_count, 0) as payment_count,
       coalesce(invoice.issued_amount, 0)::numeric(14,4) as issued_amount,
       coalesce(invoice.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       coalesce(invoice.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.received_amount, 0)::numeric(14,4) as received_amount,
       coalesce(payment.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4)::numeric(14,4) as net_balance,
       case
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) < 0 then 'customer_credit'
         else 'clear'
       end as balance_status
from currencies currency_row
left join invoice_totals invoice
  on invoice.workspace_id = currency_row.workspace_id
 and invoice.customer_id = currency_row.customer_id
 and invoice.currency = currency_row.currency
left join payment_totals payment
  on payment.workspace_id = currency_row.workspace_id
 and payment.customer_id = currency_row.customer_id
 and payment.currency = currency_row.currency;

create or replace view public.customer_360_operational_summary
with (security_invoker = true)
as
with appointment_counts as (
  select booking.workspace_id,
         booking.customer_id,
         count(*)::integer as appointment_count,
         count(*) filter (where booking.status::text in ('pending', 'confirmed'))::integer as upcoming_appointment_count,
         count(*) filter (where booking.status::text = 'completed')::integer as completed_appointment_count,
         max(coalesce(booking.completed_at, booking.cancelled_at, booking.updated_at, booking.created_at)) as last_appointment_activity_at
  from public.bookings booking
  group by booking.workspace_id, booking.customer_id
), sale_counts as (
  select sale.workspace_id,
         sale.customer_id,
         count(*)::integer as sale_count,
         count(*) filter (where sale.status = 'completed')::integer as completed_sale_count,
         max(coalesce(sale.reversed_at, sale.completed_at, sale.occurred_at)) as last_sale_activity_at
  from public.sales sale
  where sale.customer_id is not null
  group by sale.workspace_id, sale.customer_id
), invoice_counts as (
  select invoice.workspace_id,
         invoice.customer_id,
         count(*)::integer as invoice_count,
         count(*) filter (where invoice.status::text not in ('draft', 'void') and invoice.outstanding_amount > 0)::integer as open_invoice_count,
         max(coalesce(invoice.voided_at, invoice.sent_at, invoice.updated_at, invoice.created_at)) as last_invoice_activity_at
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id
), payment_counts as (
  select payment.workspace_id,
         payment.customer_id,
         count(*)::integer as payment_count,
         max(coalesce(payment.reversed_at, payment.received_at, payment.created_at)) as last_payment_activity_at
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id
), document_counts as (
  select document.workspace_id,
         document.customer_id,
         count(*)::integer as document_count,
         max(document.uploaded_at) as last_document_activity_at
  from public.documents document
  where document.customer_id is not null
  group by document.workspace_id, document.customer_id
), message_counts as (
  select message.workspace_id,
         message.customer_id,
         count(*)::integer as message_count,
         count(*) filter (where message.unread)::integer as unread_message_count,
         max(message.occurred_at) as last_message_activity_at
  from public.messages message
  group by message.workspace_id, message.customer_id
), note_counts as (
  select note.workspace_id,
         note.customer_id,
         count(*)::integer as note_count,
         count(*) filter (where note.status = 'active')::integer as active_note_count,
         max(coalesce(note.voided_at, note.occurred_at)) as last_note_activity_at
  from public.customer_note_status note
  group by note.workspace_id, note.customer_id
)
select customer.workspace_id,
       customer.id as customer_id,
       coalesce(appointment.appointment_count, 0) as appointment_count,
       coalesce(appointment.upcoming_appointment_count, 0) as upcoming_appointment_count,
       coalesce(appointment.completed_appointment_count, 0) as completed_appointment_count,
       coalesce(sale.sale_count, 0) as sale_count,
       coalesce(sale.completed_sale_count, 0) as completed_sale_count,
       coalesce(invoice.invoice_count, 0) as invoice_count,
       coalesce(invoice.open_invoice_count, 0) as open_invoice_count,
       coalesce(payment.payment_count, 0) as payment_count,
       coalesce(document.document_count, 0) as document_count,
       coalesce(message.message_count, 0) as message_count,
       coalesce(message.unread_message_count, 0) as unread_message_count,
       coalesce(note.note_count, 0) as note_count,
       coalesce(note.active_note_count, 0) as active_note_count,
       nullif(greatest(
         coalesce(appointment.last_appointment_activity_at, '-infinity'::timestamptz),
         coalesce(sale.last_sale_activity_at, '-infinity'::timestamptz),
         coalesce(invoice.last_invoice_activity_at, '-infinity'::timestamptz),
         coalesce(payment.last_payment_activity_at, '-infinity'::timestamptz),
         coalesce(document.last_document_activity_at, '-infinity'::timestamptz),
         coalesce(message.last_message_activity_at, '-infinity'::timestamptz),
         coalesce(note.last_note_activity_at, '-infinity'::timestamptz),
         customer.updated_at
       ), '-infinity'::timestamptz) as last_activity_at
from public.customers customer
left join appointment_counts appointment
  on appointment.workspace_id = customer.workspace_id and appointment.customer_id = customer.id
left join sale_counts sale
  on sale.workspace_id = customer.workspace_id and sale.customer_id = customer.id
left join invoice_counts invoice
  on invoice.workspace_id = customer.workspace_id and invoice.customer_id = customer.id
left join payment_counts payment
  on payment.workspace_id = customer.workspace_id and payment.customer_id = customer.id
left join document_counts document
  on document.workspace_id = customer.workspace_id and document.customer_id = customer.id
left join message_counts message
  on message.workspace_id = customer.workspace_id and message.customer_id = customer.id
left join note_counts note
  on note.workspace_id = customer.workspace_id and note.customer_id = customer.id;

create or replace view public.customer_360_activity
with (security_invoker = true)
as
select activity.workspace_id,
       customer.id as customer_id,
       'customer'::text as source_type,
       activity.id as source_id,
       'customer_lifecycle'::text as event_type,
       activity.action as title,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/customers/' || customer.id::text)::text as route,
       activity.metadata
from public.activity_items activity
join public.customers customer
  on customer.workspace_id = activity.workspace_id
 and activity.entity_type = 'customer'
 and activity.entity_id = customer.id::text
where coalesce(activity.metadata ->> 'source', '') <> 'customer_note'

union all

select note.workspace_id,
       note.customer_id,
       'customer_note'::text,
       note.id,
       case when note.note_kind = 'note' then 'note_added' else 'note_voided' end,
       case when note.note_kind = 'note' then 'Customer note added' else 'Customer note voided' end,
       coalesce(note.body, note.reason, ''),
       case when note.note_kind = 'note' then 'gold' else 'neutral' end,
       note.occurred_at,
       ('/customers/' || note.customer_id::text)::text,
       jsonb_build_object(
         'note_kind', note.note_kind,
         'parent_note_id', note.parent_note_id,
         'actor_user_id', note.actor_user_id
       )
from public.customer_notes note

union all

select booking.workspace_id,
       booking.customer_id,
       'appointment'::text,
       booking.id,
       ('appointment_' || booking.status::text)::text,
       case booking.status::text
         when 'completed' then 'Appointment completed'
         when 'cancelled' then 'Appointment cancelled'
         when 'confirmed' then 'Appointment confirmed'
         else 'Appointment scheduled'
       end,
       concat_ws(' · ', booking.reference, booking.title, booking.staff_name),
       case booking.status::text
         when 'completed' then 'green'
         when 'cancelled' then 'neutral'
         when 'confirmed' then 'blue'
         else 'gold'
       end,
       coalesce(booking.completed_at, booking.cancelled_at, booking.updated_at, booking.created_at),
       ('/calendar?appointment=' || booking.id::text)::text,
       jsonb_build_object(
         'reference', booking.reference,
         'status', booking.status::text,
         'booking_date', booking.booking_date,
         'booking_time', booking.booking_time,
         'service_id', booking.service_id,
         'staff_user_id', booking.staff_user_id
       )
from public.bookings booking

union all

select sale.workspace_id,
       sale.customer_id,
       'sale'::text,
       sale.id,
       ('sale_' || sale.status)::text,
       case when sale.status = 'reversed' then 'Sale reversed' else 'Sale completed' end,
       concat_ws(' · ', sale.reference, sale.currency || ' ' || trim(to_char(sale.total_amount, 'FM9999999990.00'))),
       case when sale.status = 'reversed' then 'neutral' else 'green' end,
       coalesce(sale.reversed_at, sale.completed_at, sale.occurred_at),
       ('/sales?customerId=' || sale.customer_id::text)::text,
       jsonb_build_object(
         'reference', sale.reference,
         'status', sale.status,
         'currency', sale.currency,
         'total_amount', sale.total_amount
       )
from public.sales sale
where sale.customer_id is not null

union all

select invoice.workspace_id,
       invoice.customer_id,
       'invoice'::text,
       invoice.id,
       ('invoice_' || invoice.display_status)::text,
       case invoice.display_status
         when 'paid' then 'Invoice paid'
         when 'overdue' then 'Invoice overdue'
         when 'void' then 'Invoice voided'
         when 'draft' then 'Invoice drafted'
         else 'Invoice issued'
       end,
       concat_ws(' · ', invoice.number, invoice.currency || ' ' || trim(to_char(invoice.total_amount, 'FM9999999990.00'))),
       case invoice.display_status
         when 'paid' then 'green'
         when 'overdue' then 'gold'
         when 'void' then 'neutral'
         when 'draft' then 'neutral'
         else 'blue'
       end,
       coalesce(invoice.voided_at, invoice.sent_at, invoice.updated_at, invoice.created_at),
       ('/accounts?customerId=' || invoice.customer_id::text)::text,
       jsonb_build_object(
         'number', invoice.number,
         'status', invoice.display_status,
         'currency', invoice.currency,
         'total_amount', invoice.total_amount,
         'outstanding_amount', invoice.outstanding_amount
       )
from public.invoice_account_balances invoice

union all

select payment.workspace_id,
       payment.customer_id,
       'payment'::text,
       payment.id,
       ('payment_' || payment.status)::text,
       case when payment.status = 'reversed' then 'Customer Payment reversed' else 'Customer Payment recorded' end,
       concat_ws(' · ', payment.reference, payment.currency || ' ' || trim(to_char(payment.amount, 'FM9999999990.00'))),
       case when payment.status = 'reversed' then 'neutral' else 'green' end,
       coalesce(payment.reversed_at, payment.received_at, payment.created_at),
       ('/accounts?customerId=' || payment.customer_id::text)::text,
       jsonb_build_object(
         'reference', payment.reference,
         'status', payment.status,
         'currency', payment.currency,
         'amount', payment.amount,
         'unallocated_amount', payment.unallocated_amount
       )
from public.payment_account_balances payment

union all

select document.workspace_id,
       document.customer_id,
       'document'::text,
       document.id,
       'document_uploaded'::text,
       'Document uploaded'::text,
       concat_ws(' · ', document.name, document.document_type),
       'blue'::text,
       document.uploaded_at,
       ('/documents?customerId=' || document.customer_id::text)::text,
       jsonb_build_object(
         'name', document.name,
         'document_type', document.document_type,
         'linked_to', document.linked_to
       )
from public.documents document
where document.customer_id is not null

union all

select message.workspace_id,
       message.customer_id,
       'communication'::text,
       message.id,
       'communication_recorded'::text,
       (message.channel || ' communication')::text,
       concat_ws(' · ', message.subject, message.preview),
       case when message.unread then 'gold' else 'blue' end,
       message.occurred_at,
       ('/communications?customerId=' || message.customer_id::text)::text,
       jsonb_build_object(
         'channel', message.channel,
         'subject', message.subject,
         'status', message.status::text,
         'unread', message.unread
       )
from public.messages message;

create or replace function public.get_customer_360_access(target_workspace_id uuid)
returns table (
  feature_key text,
  can_view boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select feature.feature_key,
         private.has_workspace_permission(target_workspace_id, feature.feature_key, 'view')
  from unnest(array[
    'customers',
    'calendar',
    'sales',
    'accounts',
    'documents',
    'communications'
  ]::text[]) as feature(feature_key);
$$;

revoke all on public.customer_note_status from public, anon;
revoke all on public.customer_360_financial_summary from public, anon;
revoke all on public.customer_360_operational_summary from public, anon;
revoke all on public.customer_360_activity from public, anon;
grant select on public.customer_note_status to authenticated;
grant select on public.customer_360_financial_summary to authenticated;
grant select on public.customer_360_operational_summary to authenticated;
grant select on public.customer_360_activity to authenticated;

revoke all on function public.get_customer_360_access(uuid) from public, anon;
grant execute on function public.get_customer_360_access(uuid) to authenticated;

commit;
