-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133446_vanita_release_customer_360.sql.
-- Sources: 20260801090000_customer_360_notes_schema.sql through 20260801093000_customer_360_index_deduplication.sql.
begin;

create table if not exists public.customer_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  note_kind text not null default 'note' check (note_kind in ('note', 'void')),
  body text,
  parent_note_id uuid,
  reason text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, parent_note_id)
    references public.customer_notes(workspace_id, id) on delete restrict,
  constraint customer_notes_shape_check check (
    (
      note_kind = 'note'
      and body is not null
      and char_length(trim(body)) between 1 and 4000
      and parent_note_id is null
      and reason is null
    )
    or
    (
      note_kind = 'void'
      and body is null
      and parent_note_id is not null
      and reason is not null
      and char_length(trim(reason)) between 5 and 500
      and parent_note_id <> id
    )
  )
);

create unique index if not exists customer_notes_one_void_per_note_idx
  on public.customer_notes(workspace_id, parent_note_id)
  where note_kind = 'void';

create index if not exists customer_notes_customer_time_idx
  on public.customer_notes(workspace_id, customer_id, occurred_at desc, created_at desc);

create index if not exists customer_notes_actor_idx
  on public.customer_notes(actor_user_id, occurred_at desc);

create table if not exists public.customer_note_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  note_id uuid not null,
  action text not null check (action in ('create', 'void')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, note_id)
    references public.customer_notes(workspace_id, id) on delete cascade
);

create index if not exists customer_note_receipts_note_idx
  on public.customer_note_command_receipts(workspace_id, note_id, created_at desc);

create or replace function private.prevent_customer_note_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Customer notes are append-only; add a linked void record instead';
end;
$$;

drop trigger if exists customer_notes_immutable on public.customer_notes;
create trigger customer_notes_immutable
before update or delete on public.customer_notes
for each row execute function private.prevent_customer_note_mutation();

alter table public.customer_notes enable row level security;
alter table public.customer_note_command_receipts enable row level security;

drop policy if exists "Customer notes permission read" on public.customer_notes;
create policy "Customer notes permission read"
on public.customer_notes for select to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'view'));

revoke all on public.customer_notes from public, anon, authenticated;
grant select on public.customer_notes to authenticated;
revoke all on public.customer_note_command_receipts from public, anon, authenticated;

revoke all on function private.prevent_customer_note_mutation() from public, anon, authenticated;
grant execute on function private.prevent_customer_note_mutation() to service_role;

commit;


begin;

create or replace function public.create_customer_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_customer_id uuid,
  p_body text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_record public.customers;
  note_record public.customer_notes;
  previous_result jsonb;
  command_result jsonb;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer note idempotency key is invalid';
  end if;
  if p_body is null or char_length(trim(p_body)) not between 1 and 4000 then
    raise exception 'Customer note body is invalid';
  end if;
  if p_occurred_at is null then
    raise exception 'Customer note date is invalid';
  end if;

  select receipt.result into previous_result
  from public.customer_note_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'customers',
    'create'
  ) then
    raise exception 'Customer note write access denied';
  end if;

  select * into customer_record
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and customer.id = p_customer_id
  for share;
  if customer_record.id is null then
    raise exception 'Customer not found';
  end if;

  insert into public.customer_notes (
    id,
    workspace_id,
    customer_id,
    note_kind,
    body,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_note_id,
    p_workspace_id,
    p_customer_id,
    'note',
    trim(p_body),
    p_actor_user_id,
    p_command_id,
    p_occurred_at
  ) returning * into note_record;

  command_result := jsonb_build_object(
    'action', 'create',
    'note', to_jsonb(note_record)
  );

  insert into public.customer_note_command_receipts (
    workspace_id,
    idempotency_key,
    note_id,
    action,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    note_record.id,
    'create',
    command_result
  );

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
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Customer note added',
    customer_record.name || ' · ' || left(note_record.body, 160),
    'gold',
    note_record.occurred_at,
    'customer',
    customer_record.id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'customer_note',
      'customer_id', customer_record.id,
      'note_id', note_record.id,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

create or replace function public.void_customer_note(
  p_workspace_id uuid,
  p_void_note_id uuid,
  p_customer_id uuid,
  p_note_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_record public.customers;
  original_note public.customer_notes;
  void_record public.customer_notes;
  previous_result jsonb;
  command_result jsonb;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Customer note idempotency key is invalid';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Customer note void reason is invalid';
  end if;
  if p_occurred_at is null then
    raise exception 'Customer note void date is invalid';
  end if;

  select receipt.result into previous_result
  from public.customer_note_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then
    return previous_result;
  end if;

  if not private.actor_has_workspace_permission(
    p_workspace_id,
    p_actor_user_id,
    'customers',
    'edit'
  ) then
    raise exception 'Customer note void access denied';
  end if;

  select * into customer_record
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and customer.id = p_customer_id
  for share;
  if customer_record.id is null then
    raise exception 'Customer not found';
  end if;

  select * into original_note
  from public.customer_notes note
  where note.workspace_id = p_workspace_id
    and note.customer_id = p_customer_id
    and note.id = p_note_id
    and note.note_kind = 'note'
  for update;
  if original_note.id is null then
    raise exception 'Customer note not found';
  end if;

  if exists (
    select 1
    from public.customer_notes note_void
    where note_void.workspace_id = p_workspace_id
      and note_void.parent_note_id = original_note.id
      and note_void.note_kind = 'void'
  ) then
    raise exception 'Customer note has already been voided';
  end if;

  insert into public.customer_notes (
    id,
    workspace_id,
    customer_id,
    note_kind,
    body,
    parent_note_id,
    reason,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_void_note_id,
    p_workspace_id,
    p_customer_id,
    'void',
    null,
    original_note.id,
    trim(p_reason),
    p_actor_user_id,
    p_command_id,
    p_occurred_at
  ) returning * into void_record;

  command_result := jsonb_build_object(
    'action', 'void',
    'noteId', original_note.id,
    'void', to_jsonb(void_record)
  );

  insert into public.customer_note_command_receipts (
    workspace_id,
    idempotency_key,
    note_id,
    action,
    result
  ) values (
    p_workspace_id,
    trim(p_idempotency_key),
    void_record.id,
    'void',
    command_result
  );

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
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Customer note voided',
    customer_record.name || ' · ' || trim(p_reason),
    'neutral',
    void_record.occurred_at,
    'customer',
    customer_record.id::text,
    p_command_id,
    jsonb_build_object(
      'source', 'customer_note',
      'customer_id', customer_record.id,
      'note_id', original_note.id,
      'void_note_id', void_record.id,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function public.create_customer_note(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.void_customer_note(uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_customer_note(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.void_customer_note(uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;

commit;


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


begin;

create index if not exists bookings_customer_activity_idx
  on public.bookings(workspace_id, customer_id, updated_at desc, created_at desc);

create index if not exists sales_customer_activity_idx
  on public.sales(workspace_id, customer_id, occurred_at desc)
  where customer_id is not null;

create index if not exists invoices_customer_activity_idx
  on public.invoices(workspace_id, customer_id, created_at desc);

create index if not exists payments_customer_activity_idx
  on public.payments(workspace_id, customer_id, received_at desc);

create index if not exists documents_customer_activity_idx
  on public.documents(workspace_id, customer_id, uploaded_at desc)
  where customer_id is not null;

create index if not exists messages_customer_activity_idx
  on public.messages(workspace_id, customer_id, occurred_at desc);

create index if not exists activity_items_customer_entity_idx
  on public.activity_items(workspace_id, entity_type, entity_id, occurred_at desc)
  where entity_type = 'customer';

commit;


begin;

-- Receipt tables remain service-role-only and intentionally expose no authenticated policies.
-- Keep this explicit in database inspection so the no-policy state is not mistaken for a missing browser rule.
comment on table public.customer_note_command_receipts is
  'Service-role-only idempotency receipts for append-only Customer note commands; authenticated access is intentionally denied.';

commit;


begin;

alter function public.get_customer_360_access(uuid) security invoker;

comment on function public.get_customer_360_access(uuid) is
  'Returns source-department Customer 360 view access using the signed-in caller context; never elevates privileges.';

commit;


begin;

-- The established Sales index already covers workspace, Customer and occurrence time.
drop index if exists public.sales_customer_activity_idx;

comment on index public.sales_workspace_customer_time_idx is
  'Canonical workspace and Customer Sale activity index, reused by Customer 360.';

commit;
