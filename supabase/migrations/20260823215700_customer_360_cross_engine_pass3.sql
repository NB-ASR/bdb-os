begin;

-- Customer Engine V1 Pass 3 — Customer 360 & cross-engine integrity.
-- This migration does not change Accounts posting, balances, allocations, numbering,
-- Credit Note rules, Delivery Note rules or any other frozen financial invariant.
-- It strengthens Customer-facing relationships and removes duplicate Communication
-- summary logic from Customer 360.

do $$
begin
  if exists (
    select 1
    from public.messages message
    join public.communication_threads thread
      on thread.workspace_id = message.workspace_id
     and thread.id = message.thread_id
    where message.customer_id <> thread.customer_id
  ) then
    raise exception 'Existing Communication message/thread Customer mismatch blocks Customer Pass 3';
  end if;

  if exists (
    select 1
    from public.messages message
    join public.messages reply
      on reply.id = message.reply_to_message_id
    where message.reply_to_message_id is not null
      and (
        reply.workspace_id <> message.workspace_id
        or reply.thread_id <> message.thread_id
      )
  ) then
    raise exception 'Existing Communication reply crosses workspace or thread';
  end if;

  if exists (
    select 1
    from public.document_links link
    left join public.customers customer
      on customer.workspace_id = link.workspace_id
     and customer.id = link.target_id
    where link.link_type = 'customer'
      and customer.id is null
  ) then
    raise exception 'Existing Customer Document link targets an unavailable Customer';
  end if;
end;
$$;

create unique index if not exists communication_threads_workspace_id_customer_uidx
  on public.communication_threads(workspace_id, id, customer_id);

create unique index if not exists messages_workspace_thread_id_uidx
  on public.messages(workspace_id, thread_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_workspace_thread_customer_fkey'
  ) then
    alter table public.messages
      add constraint messages_workspace_thread_customer_fkey
      foreign key (workspace_id, thread_id, customer_id)
      references public.communication_threads(workspace_id, id, customer_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_workspace_thread_reply_fkey'
  ) then
    alter table public.messages
      add constraint messages_workspace_thread_reply_fkey
      foreign key (workspace_id, thread_id, reply_to_message_id)
      references public.messages(workspace_id, thread_id, id)
      on delete restrict;
  end if;
end;
$$;

comment on constraint messages_workspace_thread_customer_fkey on public.messages is
  'A Communication message must belong to the same workspace and Customer as its authoritative thread.';
comment on constraint messages_workspace_thread_reply_fkey on public.messages is
  'A Communication reply target must belong to the same workspace and thread.';

create or replace function private.enforce_customer_document_link_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.link_type = 'customer' then
    if new.target_id is null or not exists (
      select 1
      from public.customers customer
      where customer.workspace_id = new.workspace_id
        and customer.id = new.target_id
    ) then
      raise exception 'Customer Document link target is unavailable in this workspace';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_customer_document_link_target() from public, anon, authenticated;
grant execute on function private.enforce_customer_document_link_target() to service_role;

drop trigger if exists document_links_customer_target_guard on public.document_links;
create trigger document_links_customer_target_guard
before insert or update of workspace_id, link_type, target_id on public.document_links
for each row execute function private.enforce_customer_document_link_target();

comment on function private.enforce_customer_document_link_target() is
  'Database-level integrity guard for canonical Customer Document links. Other typed link domains remain owned by their source engines.';

create or replace view public.customer_360_communication_summary
with (security_invoker = true)
as
with message_totals as (
  select thread.workspace_id,
         thread.customer_id,
         count(distinct thread.id)::integer as thread_count,
         count(distinct thread.id) filter (where thread.status = 'open')::integer as open_thread_count,
         count(message.id) filter (where message.draft_state <> 'dismissed')::integer as message_count,
         count(message.id) filter (
           where message.direction = 'inbound'
             and message.unread = true
             and message.draft_state <> 'dismissed'
         )::integer as unread_message_count,
         count(message.id) filter (where message.draft_state = 'review')::integer as draft_review_count,
         max(greatest(
           thread.last_message_at,
           coalesce(message.occurred_at, thread.last_message_at)
         )) as last_message_activity_at
  from public.communication_threads thread
  left join public.messages message
    on message.workspace_id = thread.workspace_id
   and message.thread_id = thread.id
   and message.customer_id = thread.customer_id
  group by thread.workspace_id, thread.customer_id
), lifecycle_totals as (
  select activity.workspace_id,
         customer.id as customer_id,
         max(activity.occurred_at) as last_lifecycle_activity_at
  from public.activity_items activity
  join public.customers customer
    on customer.workspace_id = activity.workspace_id
   and customer.id::text = activity.metadata ->> 'customer_id'
  where activity.entity_type = 'communication_thread'
    and activity.metadata ->> 'source' = 'unified_communication_lifecycle'
  group by activity.workspace_id, customer.id
)
select message.workspace_id,
       message.customer_id,
       message.thread_count,
       message.open_thread_count,
       message.message_count,
       message.unread_message_count,
       message.draft_review_count,
       nullif(greatest(
         coalesce(message.last_message_activity_at, '-infinity'::timestamptz),
         coalesce(lifecycle.last_lifecycle_activity_at, '-infinity'::timestamptz)
       ), '-infinity'::timestamptz) as last_communication_at
from message_totals message
left join lifecycle_totals lifecycle
  on lifecycle.workspace_id = message.workspace_id
 and lifecycle.customer_id = message.customer_id;

revoke all on public.customer_360_communication_summary from public, anon, authenticated;
grant select on public.customer_360_communication_summary to authenticated;

comment on view public.customer_360_communication_summary is
  'Authoritative Customer Communication summary. Counts come from unified Communications and last activity includes Communication lifecycle events.';

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
), note_counts as (
  select note.workspace_id,
         note.customer_id,
         count(*)::integer as note_count,
         count(*) filter (where note.status = 'active')::integer as active_note_count,
         max(coalesce(note.voided_at, note.occurred_at)) as last_note_activity_at
  from public.customer_note_status note
  group by note.workspace_id, note.customer_id
), communication_counts as (
  select communication.workspace_id,
         communication.customer_id,
         communication.message_count,
         communication.unread_message_count,
         communication.last_communication_at
  from public.customer_360_communication_summary communication
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
       coalesce(communication.message_count, 0) as message_count,
       coalesce(communication.unread_message_count, 0) as unread_message_count,
       coalesce(note.note_count, 0) as note_count,
       coalesce(note.active_note_count, 0) as active_note_count,
       nullif(greatest(
         coalesce(appointment.last_appointment_activity_at, '-infinity'::timestamptz),
         coalesce(sale.last_sale_activity_at, '-infinity'::timestamptz),
         coalesce(invoice.last_invoice_activity_at, '-infinity'::timestamptz),
         coalesce(payment.last_payment_activity_at, '-infinity'::timestamptz),
         coalesce(document.last_document_activity_at, '-infinity'::timestamptz),
         coalesce(communication.last_communication_at, '-infinity'::timestamptz),
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
left join communication_counts communication
  on communication.workspace_id = customer.workspace_id and communication.customer_id = customer.id
left join note_counts note
  on note.workspace_id = customer.workspace_id and note.customer_id = customer.id;

revoke all on public.customer_360_operational_summary from public, anon, authenticated;
grant select on public.customer_360_operational_summary to authenticated;

comment on view public.customer_360_operational_summary is
  'Customer operational summary composed from department-owned read models; Communications are sourced from the unified Communication summary and Documents from active typed links.';

commit;
