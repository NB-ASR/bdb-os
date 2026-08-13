begin;

-- General Documents is now written only through the trusted command API.
drop policy if exists "Documents permission insert" on public.documents;
drop policy if exists "Documents permission update" on public.documents;
drop policy if exists "Documents permission delete" on public.documents;

revoke all on public.documents from public, anon, authenticated;
grant select on public.documents to authenticated;

revoke all on public.document_links from public, anon, authenticated;
grant select on public.document_links to authenticated;

revoke all on public.document_command_receipts from public, anon, authenticated;

revoke all on public.general_document_index from public, anon, authenticated;
grant select on public.general_document_index to authenticated;

-- File bytes follow the same trusted server boundary as Document metadata.
drop policy if exists "Members can upload workspace documents" on storage.objects;
drop policy if exists "Managers can update workspace documents" on storage.objects;
drop policy if exists "Managers can delete workspace documents" on storage.objects;

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
  select link.workspace_id,
         link.target_id as customer_id,
         count(distinct link.document_id)::integer as document_count,
         max(greatest(
           document.uploaded_at,
           link.created_at,
           coalesce(document.archived_at, '-infinity'::timestamptz)
         )) as last_document_activity_at
  from public.document_links link
  join public.documents document
    on document.workspace_id = link.workspace_id
   and document.id = link.document_id
  where link.link_type = 'customer'
    and link.target_id is not null
    and link.revoked_at is null
  group by link.workspace_id, link.target_id
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

select document_link.workspace_id,
       document_link.customer_id,
       'document'::text,
       document.id,
       'document_uploaded'::text,
       'Document uploaded'::text,
       concat_ws(' · ', document.name, document.document_type),
       'blue'::text,
       document.uploaded_at,
       ('/documents?documentId=' || document.id::text)::text,
       jsonb_build_object(
         'name', document.name,
         'document_type', document.document_type,
         'category', document.category,
         'status', document.status,
         'link_type', 'customer'
       )
from (
  select distinct link.workspace_id,
         link.target_id as customer_id,
         link.document_id
  from public.document_links link
  where link.link_type = 'customer'
    and link.target_id is not null
) document_link
join public.documents document
  on document.workspace_id = document_link.workspace_id
 and document.id = document_link.document_id

union all

select activity.workspace_id,
       customer.id,
       'document'::text,
       activity.id,
       case activity.action
         when 'Document linked' then 'document_linked'
         else 'document_link_revoked'
       end,
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/documents?documentId=' || activity.entity_id)::text,
       activity.metadata
from public.activity_items activity
join public.customers customer
  on customer.workspace_id = activity.workspace_id
 and customer.id::text = activity.metadata ->> 'target_id'
where activity.entity_type = 'document'
  and activity.action in ('Document linked', 'Document link revoked')
  and activity.metadata ->> 'source' = 'general_document_link'
  and activity.metadata ->> 'link_type' = 'customer'

union all

select distinct activity.workspace_id,
       customer.id,
       'document'::text,
       activity.id,
       'document_archived'::text,
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/documents?documentId=' || activity.entity_id)::text,
       activity.metadata
from public.activity_items activity
join public.documents document
  on document.workspace_id = activity.workspace_id
 and document.id::text = activity.entity_id
join public.document_links link
  on link.workspace_id = document.workspace_id
 and link.document_id = document.id
 and link.link_type = 'customer'
 and link.target_id is not null
join public.customers customer
  on customer.workspace_id = link.workspace_id
 and customer.id = link.target_id
where activity.entity_type = 'document'
  and activity.action = 'Document archived'
  and activity.metadata ->> 'source' = 'general_document'

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

revoke all on public.customer_360_operational_summary from public, anon, authenticated;
revoke all on public.customer_360_activity from public, anon, authenticated;
grant select on public.customer_360_operational_summary to authenticated;
grant select on public.customer_360_activity to authenticated;

comment on view public.customer_360_operational_summary is
  'Customer operational counts with Documents resolved through active typed links.';
comment on view public.customer_360_activity is
  'Unified Customer activity with Document upload, link, revoke and archive events resolved through typed links.';

commit;
