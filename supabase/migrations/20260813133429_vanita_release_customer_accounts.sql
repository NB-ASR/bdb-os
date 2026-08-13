-- Ordered release-domain migration reconstructed from preserved sources.
-- Domain: 20260813133429_vanita_release_customer_accounts.sql.
-- Sources: 20260729160000_invoice_status_void_value.sql through 20260729163500_accounts_reference_index_hardening.sql.
alter type public.invoice_status add value if not exists 'void';


begin;

update public.features
set name = 'Accounts',
    description = 'Issued invoices, immutable Payments, allocations and derived customer balances.',
    category = 'finance',
    route = '/accounts',
    is_active = true
where key = 'accounts';

alter table public.invoices
  add column if not exists source_sale_id uuid,
  add column if not exists currency text,
  add column if not exists customer_code_snapshot text,
  add column if not exists customer_name_snapshot text,
  add column if not exists gross_amount numeric(14,4),
  add column if not exists discount_amount numeric(14,4) not null default 0,
  add column if not exists net_amount numeric(14,4),
  add column if not exists vat_amount numeric(14,4) not null default 0,
  add column if not exists total_amount numeric(14,4),
  add column if not exists notes text,
  add column if not exists version integer not null default 1,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists issued_by uuid references auth.users(id) on delete set null,
  add column if not exists sent_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

update public.invoices invoice
set currency = coalesce(invoice.currency, (select upper(settings.currency) from public.workspace_settings settings where settings.workspace_id = invoice.workspace_id), 'EUR'),
    customer_code_snapshot = coalesce(invoice.customer_code_snapshot, (select customer.code from public.customers customer where customer.workspace_id = invoice.workspace_id and customer.id = invoice.customer_id)),
    customer_name_snapshot = coalesce(invoice.customer_name_snapshot, (select customer.name from public.customers customer where customer.workspace_id = invoice.workspace_id and customer.id = invoice.customer_id)),
    gross_amount = coalesce(invoice.gross_amount, invoice.amount),
    net_amount = coalesce(invoice.net_amount, invoice.amount),
    total_amount = coalesce(invoice.total_amount, invoice.amount),
    sent_at = case when invoice.status::text in ('sent', 'paid', 'overdue') then coalesce(invoice.sent_at, invoice.created_at) else invoice.sent_at end;

alter table public.invoices
  alter column currency set not null,
  alter column customer_code_snapshot set not null,
  alter column customer_name_snapshot set not null,
  alter column gross_amount set not null,
  alter column net_amount set not null,
  alter column total_amount set not null;

alter table public.invoices
  drop constraint if exists invoices_amount_check,
  drop constraint if exists invoices_currency_check,
  drop constraint if exists invoices_number_length_check,
  drop constraint if exists invoices_description_length_check,
  drop constraint if exists invoices_notes_length_check,
  drop constraint if exists invoices_due_date_check,
  drop constraint if exists invoices_totals_check,
  drop constraint if exists invoices_version_check,
  drop constraint if exists invoices_void_shape,
  add constraint invoices_amount_check check (amount >= 0),
  add constraint invoices_currency_check check (currency ~ '^[A-Z]{3}$'),
  add constraint invoices_number_length_check check (char_length(trim(number)) between 4 and 64),
  add constraint invoices_description_length_check check (char_length(trim(description)) between 1 and 500),
  add constraint invoices_notes_length_check check (notes is null or char_length(notes) <= 2000),
  add constraint invoices_due_date_check check (due_at >= issued_at),
  add constraint invoices_totals_check check (
    gross_amount >= 0 and discount_amount >= 0 and discount_amount <= gross_amount
    and net_amount >= 0 and vat_amount >= 0 and total_amount >= 0
    and round(net_amount + vat_amount, 4) = round(total_amount, 4)
    and round(amount, 4) = round(total_amount, 4)
  ),
  add constraint invoices_version_check check (version > 0),
  add constraint invoices_void_shape check (
    (status = 'void'::public.invoice_status and voided_at is not null and voided_by is not null and void_reason is not null)
    or (status <> 'void'::public.invoice_status and voided_at is null and voided_by is null and void_reason is null)
  );

alter table public.invoices
  drop constraint if exists invoices_workspace_source_sale_fkey,
  add constraint invoices_workspace_source_sale_fkey
    foreign key (workspace_id, source_sale_id)
    references public.sales(workspace_id, id) on delete restrict;

create unique index if not exists invoices_workspace_active_sale_idx
  on public.invoices(workspace_id, source_sale_id)
  where source_sale_id is not null and status <> 'void'::public.invoice_status;
create index if not exists invoices_workspace_customer_due_idx on public.invoices(workspace_id, customer_id, due_at, created_at desc);
create index if not exists invoices_source_sale_idx on public.invoices(workspace_id, source_sale_id) where source_sale_id is not null;
create index if not exists invoices_created_by_idx on public.invoices(created_by) where created_by is not null;
create index if not exists invoices_updated_by_idx on public.invoices(updated_by) where updated_by is not null;
create index if not exists invoices_issued_by_idx on public.invoices(issued_by) where issued_by is not null;
create index if not exists invoices_voided_by_idx on public.invoices(voided_by) where voided_by is not null;

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at before update on public.invoices for each row execute function private.touch_updated_at();

create table public.invoice_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_type text not null check (line_type in ('product', 'service', 'manual')),
  source_sale_line_id uuid,
  product_id uuid,
  service_id uuid,
  code_snapshot text not null check (char_length(trim(code_snapshot)) between 1 and 64),
  description_snapshot text not null check (char_length(trim(description_snapshot)) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  gross_amount numeric(14,4) not null check (gross_amount >= 0),
  discount_amount numeric(14,4) not null default 0 check (discount_amount >= 0 and discount_amount <= gross_amount),
  net_amount numeric(14,4) not null check (net_amount >= 0),
  vat_rate numeric(5,2) not null check (vat_rate between 0 and 100),
  vat_amount numeric(14,4) not null check (vat_amount >= 0),
  total_amount numeric(14,4) not null check (total_amount >= 0 and round(net_amount + vat_amount, 4) = round(total_amount, 4)),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, invoice_id, line_number),
  foreign key (workspace_id, invoice_id) references public.invoices(workspace_id, id) on delete cascade,
  foreign key (workspace_id, source_sale_line_id) references public.sale_lines(workspace_id, id) on delete restrict,
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id) references public.services(workspace_id, id) on delete restrict,
  constraint invoice_lines_identity_shape check (
    (line_type = 'product' and product_id is not null and service_id is null)
    or (line_type = 'service' and service_id is not null and product_id is null)
    or (line_type = 'manual' and product_id is null and service_id is null and source_sale_line_id is null)
  )
);

create index invoice_lines_invoice_idx on public.invoice_lines(workspace_id, invoice_id, line_number);
create index invoice_lines_sale_line_idx on public.invoice_lines(workspace_id, source_sale_line_id) where source_sale_line_id is not null;
create index invoice_lines_product_idx on public.invoice_lines(workspace_id, product_id) where product_id is not null;
create index invoice_lines_service_idx on public.invoice_lines(workspace_id, service_id) where service_id is not null;

create or replace function private.enforce_invoice_line_mutability()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invoice_status_value public.invoice_status;
begin
  select invoice.status into invoice_status_value
  from public.invoices invoice
  where invoice.workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and invoice.id = coalesce(new.invoice_id, old.invoice_id);
  if invoice_status_value <> 'draft'::public.invoice_status then raise exception 'Issued Invoice lines are immutable'; end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_lines_enforce_mutability before update or delete on public.invoice_lines
for each row execute function private.enforce_invoice_line_mutability();

commit;


begin;

create table public.payments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(trim(reference)) between 8 and 64),
  customer_id uuid not null,
  customer_code_snapshot text not null check (char_length(trim(customer_code_snapshot)) between 1 and 64),
  customer_name_snapshot text not null check (char_length(trim(customer_name_snapshot)) between 1 and 160),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,4) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'other')),
  external_reference text check (external_reference is null or char_length(external_reference) <= 160),
  notes text check (notes is null or char_length(notes) <= 2000),
  received_at timestamptz not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  version integer not null default 1 check (version > 0),
  posted_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  constraint payments_reversal_shape check (
    (status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null)
  )
);

create index payments_workspace_customer_time_idx on public.payments(workspace_id, customer_id, received_at desc, id desc);
create index payments_workspace_status_time_idx on public.payments(workspace_id, status, received_at desc, id desc);
create index payments_posted_by_idx on public.payments(posted_by, received_at desc);
create index payments_reversed_by_idx on public.payments(reversed_by, reversed_at desc) where reversed_by is not null;

create table public.payment_allocations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  allocation_type text not null check (allocation_type in ('allocation', 'reversal')),
  amount_delta numeric(14,4) not null check (amount_delta <> 0),
  reversal_of_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, payment_id) references public.payments(workspace_id, id) on delete restrict,
  foreign key (workspace_id, invoice_id) references public.invoices(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reversal_of_id) references public.payment_allocations(workspace_id, id) on delete restrict,
  constraint payment_allocations_shape check (
    (allocation_type = 'allocation' and amount_delta > 0 and reversal_of_id is null and reason is null)
    or (allocation_type = 'reversal' and amount_delta < 0 and reversal_of_id is not null and reason is not null)
  )
);

create unique index payment_allocations_one_reversal_idx on public.payment_allocations(workspace_id, reversal_of_id) where reversal_of_id is not null;
create index payment_allocations_invoice_idx on public.payment_allocations(workspace_id, invoice_id, occurred_at, id);
create index payment_allocations_payment_idx on public.payment_allocations(workspace_id, payment_id, occurred_at, id);
create index payment_allocations_actor_idx on public.payment_allocations(actor_user_id, occurred_at desc);

create table public.accounts_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  entity_type text not null check (entity_type in ('invoice', 'payment', 'allocation')),
  entity_id uuid not null,
  action text not null check (action in (
    'create_manual_invoice', 'create_sale_invoice', 'update_invoice', 'issue_invoice', 'void_invoice',
    'record_payment', 'allocate_payment', 'reverse_allocation', 'reverse_payment'
  )),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);
create index accounts_command_receipts_entity_idx on public.accounts_command_receipts(workspace_id, entity_type, entity_id, created_at desc);

create or replace function private.enforce_payment_mutability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Posted Payments are immutable'; end if;
  if old.status = 'posted'
     and new.status = 'reversed'
     and new.workspace_id = old.workspace_id
     and new.reference = old.reference
     and new.customer_id = old.customer_id
     and new.customer_code_snapshot = old.customer_code_snapshot
     and new.customer_name_snapshot = old.customer_name_snapshot
     and new.currency = old.currency
     and new.amount = old.amount
     and new.payment_method = old.payment_method
     and new.external_reference is not distinct from old.external_reference
     and new.notes is not distinct from old.notes
     and new.received_at = old.received_at
     and new.posted_by = old.posted_by
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and new.version = old.version + 1 then return new;
  end if;
  raise exception 'Posted Payments are immutable';
end;
$$;
create trigger payments_enforce_mutability before update or delete on public.payments
for each row execute function private.enforce_payment_mutability();

create or replace function private.enforce_payment_allocation_immutability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Payment allocations are append-only'; end;
$$;
create trigger payment_allocations_enforce_immutability before update or delete on public.payment_allocations
for each row execute function private.enforce_payment_allocation_immutability();

commit;


begin;

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id = allocation.workspace_id
   and payment.id = allocation.payment_id
  where payment.status = 'posted'
  group by allocation.workspace_id, allocation.invoice_id
)
select invoice.*,
       coalesce(total.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0)::numeric(14,4) as outstanding_amount,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0) = 0 then 'paid'
         when coalesce(total.allocated_amount, 0) > 0 then 'partially_paid'
         else 'unpaid'
       end as payment_status,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when greatest(round(invoice.total_amount - coalesce(total.allocated_amount, 0), 4), 0) = 0 then 'paid'
         when invoice.due_at < current_date then 'overdue'
         else 'sent'
       end as display_status
from public.invoices invoice
left join allocation_totals total
  on total.workspace_id = invoice.workspace_id
 and total.invoice_id = invoice.id;

create or replace view public.payment_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id,
         allocation.payment_id,
         round(coalesce(sum(allocation.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation
  group by allocation.workspace_id, allocation.payment_id
)
select payment.*,
       case when payment.status = 'posted' then coalesce(total.allocated_amount, 0) else 0 end::numeric(14,4) as allocated_amount,
       case when payment.status = 'posted'
         then greatest(round(payment.amount - coalesce(total.allocated_amount, 0), 4), 0)
         else 0
       end::numeric(14,4) as unallocated_amount
from public.payments payment
left join allocation_totals total
  on total.workspace_id = payment.workspace_id
 and total.payment_id = payment.id;

create or replace view public.customer_account_balances
with (security_invoker = true)
as
with invoice_totals as (
  select invoice.workspace_id,
         invoice.customer_id,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.total_amount else 0 end), 4) as issued_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.allocated_amount else 0 end), 4) as allocated_amount,
         round(sum(case when invoice.status::text not in ('draft', 'void') then invoice.outstanding_amount else 0 end), 4) as outstanding_amount
  from public.invoice_account_balances invoice
  group by invoice.workspace_id, invoice.customer_id
), payment_totals as (
  select payment.workspace_id,
         payment.customer_id,
         round(sum(case when payment.status = 'posted' then payment.amount else 0 end), 4) as received_amount,
         round(sum(payment.unallocated_amount), 4) as unallocated_credit
  from public.payment_account_balances payment
  group by payment.workspace_id, payment.customer_id
)
select customer.workspace_id,
       customer.id as customer_id,
       customer.code as customer_code,
       customer.name as customer_name,
       customer.company,
       coalesce(invoice.issued_amount, 0)::numeric(14,4) as issued_amount,
       coalesce(payment.received_amount, 0)::numeric(14,4) as received_amount,
       coalesce(invoice.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       coalesce(invoice.outstanding_amount, 0)::numeric(14,4) as outstanding_amount,
       coalesce(payment.unallocated_credit, 0)::numeric(14,4) as unallocated_credit,
       round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4)::numeric(14,4) as net_balance,
       case
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) > 0 then 'amount_due'
         when round(coalesce(invoice.outstanding_amount, 0) - coalesce(payment.unallocated_credit, 0), 4) < 0 then 'customer_credit'
         else 'clear'
       end as balance_status
from public.customers customer
left join invoice_totals invoice
  on invoice.workspace_id = customer.workspace_id
 and invoice.customer_id = customer.id
left join payment_totals payment
  on payment.workspace_id = customer.workspace_id
 and payment.customer_id = customer.id;

create or replace view public.sale_account_status
with (security_invoker = true)
as
select sale.workspace_id,
       sale.id as sale_id,
       sale.reference as sale_reference,
       sale.customer_id,
       sale.currency,
       sale.total_amount as sale_total_amount,
       invoice.id as invoice_id,
       invoice.number as invoice_number,
       invoice.display_status as invoice_status,
       invoice.allocated_amount,
       invoice.outstanding_amount,
       case
         when sale.status = 'reversed' then 'reversed'
         when invoice.id is null then 'not_invoiced'
         when invoice.display_status = 'void' then 'invoice_void'
         when invoice.outstanding_amount = 0 then 'paid'
         when invoice.allocated_amount > 0 then 'partially_paid'
         else 'invoiced'
       end as account_status
from public.sales sale
left join lateral (
  select balance.*
  from public.invoice_account_balances balance
  where balance.workspace_id = sale.workspace_id
    and balance.source_sale_id = sale.id
  order by (balance.status <> 'void'::public.invoice_status) desc, balance.created_at desc
  limit 1
) invoice on true;

alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.accounts_command_receipts enable row level security;

drop policy if exists "Accounts permission insert" on public.invoices;
drop policy if exists "Accounts permission update" on public.invoices;
drop policy if exists "Accounts permission delete" on public.invoices;
drop policy if exists "Accounts permission read" on public.invoices;
create policy "Accounts permission read" on public.invoices for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create policy "Invoice lines permission read" on public.invoice_lines for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Payments permission read" on public.payments for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));
create policy "Payment allocations permission read" on public.payment_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
revoke all on public.invoice_lines from anon, authenticated;
grant select on public.invoice_lines to authenticated;
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
revoke all on public.payment_allocations from anon, authenticated;
grant select on public.payment_allocations to authenticated;
revoke all on public.accounts_command_receipts from anon, authenticated;
revoke all on public.invoice_account_balances from anon;
revoke all on public.payment_account_balances from anon;
revoke all on public.customer_account_balances from anon;
revoke all on public.sale_account_status from anon;
grant select on public.invoice_account_balances to authenticated;
grant select on public.payment_account_balances to authenticated;
grant select on public.customer_account_balances to authenticated;
grant select on public.sale_account_status to authenticated;

commit;


begin;

create or replace function private.accounts_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'accounts',
    target_action
  );
$$;

create or replace function private.write_manual_invoice_lines(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_value jsonb;
  line_id uuid;
  line_number_value integer := 0;
  description_value text;
  code_value text;
  quantity_value numeric;
  unit_price_value numeric;
  discount_value numeric;
  vat_rate_value numeric;
  gross_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  gross_total numeric := 0;
  discount_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'An Invoice must contain between 1 and 100 lines';
  end if;

  delete from public.invoice_lines line
  where line.workspace_id = p_workspace_id and line.invoice_id = p_invoice_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin
      line_id := (line_value->>'id')::uuid;
    exception when others then
      raise exception 'Invoice line identity is invalid';
    end;
    description_value := trim(coalesce(line_value->>'description', ''));
    code_value := trim(coalesce(line_value->>'code', ''));
    if description_value = '' or char_length(description_value) > 240 then raise exception 'Invoice line description is invalid'; end if;
    if code_value = '' then code_value := 'LINE-' || lpad(line_number_value::text, 2, '0'); end if;
    if char_length(code_value) > 64 then raise exception 'Invoice line code is invalid'; end if;

    begin
      quantity_value := (line_value->>'quantity')::numeric;
      unit_price_value := (line_value->>'unitPrice')::numeric;
      discount_value := coalesce(nullif(line_value->>'discountAmount', '')::numeric, 0);
      vat_rate_value := coalesce(nullif(line_value->>'vatRate', '')::numeric, 0);
    exception when others then
      raise exception 'Invoice line amount is invalid';
    end;

    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then raise exception 'Invoice line quantity is invalid'; end if;
    if unit_price_value is null or unit_price_value < 0 then raise exception 'Invoice line price is invalid'; end if;
    if vat_rate_value < 0 or vat_rate_value > 100 then raise exception 'Invoice line VAT rate is invalid'; end if;

    gross_value := round(quantity_value * unit_price_value, 4);
    if discount_value < 0 or discount_value > gross_value then raise exception 'Invoice line discount is invalid'; end if;
    total_value := round(gross_value - discount_value, 4);
    vat_value := case when vat_rate_value = 0 then 0 else round(total_value * vat_rate_value / (100 + vat_rate_value), 4) end;
    net_value := round(total_value - vat_value, 4);

    insert into public.invoice_lines (
      id, workspace_id, invoice_id, line_number, line_type,
      code_snapshot, description_snapshot, quantity, unit_price,
      gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
    ) values (
      line_id, p_workspace_id, p_invoice_id, line_number_value, 'manual',
      code_value, description_value, quantity_value, unit_price_value,
      gross_value, discount_value, net_value, vat_rate_value, vat_value, total_value
    );

    gross_total := gross_total + gross_value;
    discount_total := discount_total + discount_value;
    net_total := net_total + net_value;
    vat_total := vat_total + vat_value;
    invoice_total := invoice_total + total_value;
  end loop;

  return jsonb_build_object(
    'gross', round(gross_total, 4),
    'discount', round(discount_total, 4),
    'net', round(net_total, 4),
    'vat', round(vat_total, 4),
    'total', round(invoice_total, 4),
    'lineCount', line_number_value
  );
end;
$$;

create or replace function private.refresh_invoice_payment_status(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_record public.invoices;
  allocated_value numeric;
  outstanding_value numeric;
begin
  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then return; end if;

  select coalesce(sum(allocation.amount_delta), 0) into allocated_value
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id = allocation.workspace_id and payment.id = allocation.payment_id
  where allocation.workspace_id = p_workspace_id
    and allocation.invoice_id = p_invoice_id
    and payment.status = 'posted';
  outstanding_value := greatest(round(invoice_record.total_amount - allocated_value, 4), 0);

  update public.invoices
  set status = case
        when outstanding_value = 0 then 'paid'::public.invoice_status
        when due_at < current_date then 'overdue'::public.invoice_status
        else 'sent'::public.invoice_status
      end,
      updated_by = p_actor_user_id
  where workspace_id = p_workspace_id and id = p_invoice_id;
end;
$$;

create or replace function public.apply_invoice_command(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_source_sale_id uuid default null,
  p_customer_id uuid default null,
  p_due_at date default null,
  p_description text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  invoice_record public.invoices;
  sale_record public.sales;
  customer_record public.customers;
  totals jsonb;
  prefix_value text;
  currency_value text;
  invoice_number text;
  permission_action text;
  activity_action text;
  line_count integer;
  allocated_value numeric;
begin
  if p_action not in ('create_manual', 'create_from_sale', 'update', 'issue', 'void') then raise exception 'Unsupported Invoice action'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Invoice idempotency key is invalid'; end if;

  select receipt.result into previous_result
  from public.accounts_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  permission_action := case
    when p_action in ('create_manual', 'create_from_sale') then 'create'
    when p_action = 'update' then 'edit'
    else 'approve'
  end;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, permission_action) then raise exception 'Accounts Invoice access denied'; end if;

  if p_action in ('create_manual', 'create_from_sale') then
    if exists (select 1 from public.invoices where id = p_invoice_id) then raise exception 'Invoice identity conflict'; end if;
    select upper(regexp_replace(coalesce(settings.invoice_prefix, 'INV'), '[^A-Za-z0-9]', '', 'g')),
           upper(settings.currency)
      into prefix_value, currency_value
    from public.workspace_settings settings
    where settings.workspace_id = p_workspace_id;
    prefix_value := coalesce(nullif(prefix_value, ''), 'INV');
    currency_value := coalesce(currency_value, 'EUR');
    invoice_number := left(prefix_value, 12) || '-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(right(replace(p_invoice_id::text, '-', ''), 8));

    if p_action = 'create_from_sale' then
      select * into sale_record
      from public.sales sale
      where sale.workspace_id = p_workspace_id and sale.id = p_source_sale_id
      for update;
      if sale_record.id is null or sale_record.status <> 'completed' then raise exception 'Completed Sale is unavailable for invoicing'; end if;
      if sale_record.customer_id is null then raise exception 'A Sale must have a Customer before invoicing'; end if;
      if exists (
        select 1 from public.invoices invoice
        where invoice.workspace_id = p_workspace_id and invoice.source_sale_id = p_source_sale_id and invoice.status <> 'void'::public.invoice_status
      ) then raise exception 'This Sale already has an active Invoice'; end if;
      select * into customer_record from public.customers customer
      where customer.workspace_id = p_workspace_id and customer.id = sale_record.customer_id;
      currency_value := sale_record.currency;

      insert into public.invoices (
        id, workspace_id, number, customer_id, source_sale_id, issued_at, due_at,
        description, amount, status, currency, customer_code_snapshot, customer_name_snapshot,
        gross_amount, discount_amount, net_amount, vat_amount, total_amount,
        notes, version, created_by, updated_by
      ) values (
        p_invoice_id, p_workspace_id, invoice_number, sale_record.customer_id, sale_record.id, current_date,
        coalesce(p_due_at, current_date + 14), coalesce(nullif(trim(p_description), ''), 'Sale ' || sale_record.reference),
        sale_record.total_amount, 'draft', currency_value, customer_record.code, customer_record.name,
        sale_record.gross_amount, sale_record.discount_amount, sale_record.net_amount, sale_record.vat_amount, sale_record.total_amount,
        nullif(trim(p_notes), ''), 1, p_actor_user_id, p_actor_user_id
      ) returning * into invoice_record;

      insert into public.invoice_lines (
        id, workspace_id, invoice_id, line_number, line_type, source_sale_line_id,
        product_id, service_id, code_snapshot, description_snapshot, quantity, unit_price,
        gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      )
      select gen_random_uuid(), line.workspace_id, p_invoice_id, line.line_number, line.line_type, line.id,
             line.product_id, line.service_id, line.code_snapshot, line.description_snapshot, line.quantity, line.unit_price,
             line.gross_amount, line.discount_amount, line.net_amount, line.vat_rate, line.vat_amount, line.total_amount
      from public.sale_lines line
      where line.workspace_id = p_workspace_id and line.sale_id = sale_record.id
      order by line.line_number;
      activity_action := 'Sale Invoice draft created';
    else
      select * into customer_record from public.customers customer
      where customer.workspace_id = p_workspace_id and customer.id = p_customer_id and customer.status = 'active';
      if customer_record.id is null then raise exception 'Invoice Customer is unavailable'; end if;
      if p_description is null or char_length(trim(p_description)) not between 1 and 500 then raise exception 'Invoice description is invalid'; end if;

      insert into public.invoices (
        id, workspace_id, number, customer_id, issued_at, due_at, description, amount, status,
        currency, customer_code_snapshot, customer_name_snapshot, gross_amount, discount_amount,
        net_amount, vat_amount, total_amount, notes, version, created_by, updated_by
      ) values (
        p_invoice_id, p_workspace_id, invoice_number, customer_record.id, current_date,
        coalesce(p_due_at, current_date + 14), trim(p_description), 0, 'draft', currency_value,
        customer_record.code, customer_record.name, 0, 0, 0, 0, 0,
        nullif(trim(p_notes), ''), 1, p_actor_user_id, p_actor_user_id
      ) returning * into invoice_record;
      totals := private.write_manual_invoice_lines(p_workspace_id, p_invoice_id, p_lines);
      update public.invoices
      set gross_amount = (totals->>'gross')::numeric,
          discount_amount = (totals->>'discount')::numeric,
          net_amount = (totals->>'net')::numeric,
          vat_amount = (totals->>'vat')::numeric,
          total_amount = (totals->>'total')::numeric,
          amount = (totals->>'total')::numeric
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Manual Invoice draft created';
    end if;
  else
    select * into invoice_record
    from public.invoices invoice
    where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
    for update;
    if invoice_record.id is null then raise exception 'Invoice not found'; end if;
    if p_expected_version is null or invoice_record.version <> p_expected_version then raise exception 'Invoice changed on another device; refresh before saving'; end if;

    if p_action = 'update' then
      if invoice_record.status <> 'draft'::public.invoice_status then raise exception 'Only draft Invoices can be edited'; end if;
      if p_due_at is not null and p_due_at < invoice_record.issued_at then raise exception 'Invoice due date is invalid'; end if;
      if p_description is not null and char_length(trim(p_description)) not between 1 and 500 then raise exception 'Invoice description is invalid'; end if;
      if invoice_record.source_sale_id is not null and p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
        raise exception 'Sale-derived Invoice lines cannot be edited';
      end if;
      if invoice_record.source_sale_id is null and p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
        totals := private.write_manual_invoice_lines(p_workspace_id, p_invoice_id, p_lines);
      end if;
      update public.invoices
      set due_at = coalesce(p_due_at, due_at),
          description = coalesce(nullif(trim(p_description), ''), description),
          notes = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
          gross_amount = case when totals is null then gross_amount else (totals->>'gross')::numeric end,
          discount_amount = case when totals is null then discount_amount else (totals->>'discount')::numeric end,
          net_amount = case when totals is null then net_amount else (totals->>'net')::numeric end,
          vat_amount = case when totals is null then vat_amount else (totals->>'vat')::numeric end,
          total_amount = case when totals is null then total_amount else (totals->>'total')::numeric end,
          amount = case when totals is null then amount else (totals->>'total')::numeric end,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice draft updated';
    elsif p_action = 'issue' then
      if invoice_record.status <> 'draft'::public.invoice_status then raise exception 'Only draft Invoices can be issued'; end if;
      select count(*) into line_count from public.invoice_lines where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
      if line_count < 1 then raise exception 'Invoice has no lines'; end if;
      update public.invoices
      set status = 'sent', sent_at = now(), issued_by = p_actor_user_id,
          updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice issued';
    else
      if invoice_record.status in ('paid'::public.invoice_status, 'void'::public.invoice_status) then raise exception 'Invoice is unavailable for voiding'; end if;
      if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Invoice void reason is required'; end if;
      select coalesce(sum(amount_delta), 0) into allocated_value from public.payment_allocations
      where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
      if allocated_value <> 0 then raise exception 'Reverse Invoice Payment allocations before voiding'; end if;
      update public.invoices
      set status = 'void', voided_at = now(), voided_by = p_actor_user_id,
          void_reason = trim(p_reason), updated_by = p_actor_user_id, version = version + 1
      where workspace_id = p_workspace_id and id = p_invoice_id
      returning * into invoice_record;
      activity_action := 'Invoice voided';
    end if;
  end if;

  select count(*) into line_count from public.invoice_lines where workspace_id = p_workspace_id and invoice_id = p_invoice_id;
  command_result := jsonb_build_object(
    'action', p_action,
    'invoice', to_jsonb(invoice_record),
    'lineCount', line_count
  );
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (
    p_workspace_id, trim(p_idempotency_key), 'invoice', p_invoice_id,
    case p_action when 'create_manual' then 'create_manual_invoice' when 'create_from_sale' then 'create_sale_invoice'
      when 'update' then 'update_invoice' when 'issue' then 'issue_invoice' else 'void_invoice' end,
    command_result
  );
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    invoice_record.number || ' · ' || invoice_record.currency || ' ' || invoice_record.total_amount::text,
    case when p_action = 'void' then 'neutral' when p_action = 'issue' then 'green' else 'gold' end,
    'invoice', p_invoice_id::text, p_command_id,
    jsonb_build_object('invoice_number', invoice_record.number, 'customer_id', invoice_record.customer_id, 'source_sale_id', invoice_record.source_sale_id, 'status', invoice_record.status, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

revoke all on function public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text) to service_role;

commit;


begin;

create or replace function private.insert_payment_allocation(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz
)
returns public.payment_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_record public.payments;
  invoice_record public.invoices;
  payment_allocated numeric;
  invoice_allocated numeric;
  payment_available numeric;
  invoice_outstanding numeric;
  allocation_record public.payment_allocations;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Payment allocation amount is invalid'; end if;

  select * into payment_record
  from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = p_payment_id
  for update;
  if payment_record.id is null or payment_record.status <> 'posted' then raise exception 'Payment is unavailable for allocation'; end if;

  select * into invoice_record
  from public.invoices invoice
  where invoice.workspace_id = p_workspace_id and invoice.id = p_invoice_id
  for update;
  if invoice_record.id is null or invoice_record.status in ('draft'::public.invoice_status, 'void'::public.invoice_status) then raise exception 'Invoice is unavailable for allocation'; end if;
  if invoice_record.customer_id <> payment_record.customer_id then raise exception 'Payment and Invoice must belong to the same Customer'; end if;
  if invoice_record.currency <> payment_record.currency then raise exception 'Payment and Invoice currencies must match'; end if;

  select coalesce(sum(amount_delta), 0) into payment_allocated
  from public.payment_allocations where workspace_id = p_workspace_id and payment_id = p_payment_id;
  select coalesce(sum(amount_delta), 0) into invoice_allocated
  from public.payment_allocations allocation
  join public.payments payment on payment.workspace_id = allocation.workspace_id and payment.id = allocation.payment_id
  where allocation.workspace_id = p_workspace_id and allocation.invoice_id = p_invoice_id and payment.status = 'posted';

  payment_available := round(payment_record.amount - payment_allocated, 4);
  invoice_outstanding := round(invoice_record.total_amount - invoice_allocated, 4);
  if p_amount > payment_available then raise exception 'Payment allocation exceeds the unallocated Payment amount'; end if;
  if p_amount > invoice_outstanding then raise exception 'Payment allocation exceeds the Invoice outstanding amount'; end if;

  insert into public.payment_allocations (
    id, workspace_id, payment_id, invoice_id, allocation_type, amount_delta,
    actor_user_id, command_id, occurred_at
  ) values (
    p_allocation_id, p_workspace_id, p_payment_id, p_invoice_id, 'allocation', round(p_amount, 4),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into allocation_record;

  perform private.refresh_invoice_payment_status(p_workspace_id, p_invoice_id, p_actor_user_id);
  return allocation_record;
end;
$$;

create or replace function public.record_payment(
  p_workspace_id uuid,
  p_payment_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_received_at timestamptz,
  p_external_reference text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  payment_record public.payments;
  customer_record public.customers;
  allocation_value jsonb;
  allocation_id uuid;
  invoice_id uuid;
  allocation_amount numeric;
  allocation_count integer := 0;
  currency_value text;
  reference_value text;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then raise exception 'Accounts Payment access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount is invalid'; end if;
  if p_payment_method not in ('cash', 'card', 'bank_transfer', 'cheque', 'other') then raise exception 'Payment method is invalid'; end if;
  if exists (select 1 from public.payments where id = p_payment_id) then raise exception 'Payment identity conflict'; end if;

  select * into customer_record from public.customers customer
  where customer.workspace_id = p_workspace_id and customer.id = p_customer_id and customer.status = 'active';
  if customer_record.id is null then raise exception 'Payment Customer is unavailable'; end if;
  select upper(settings.currency) into currency_value from public.workspace_settings settings where settings.workspace_id = p_workspace_id;
  currency_value := coalesce(currency_value, 'EUR');
  reference_value := 'PAY-' || to_char(coalesce(p_received_at, now()) at time zone 'UTC', 'YYYYMMDD') || '-' || upper(right(replace(p_payment_id::text, '-', ''), 8));

  insert into public.payments (
    id, workspace_id, reference, customer_id, customer_code_snapshot, customer_name_snapshot,
    currency, amount, payment_method, external_reference, notes, received_at, posted_by
  ) values (
    p_payment_id, p_workspace_id, reference_value, customer_record.id, customer_record.code, customer_record.name,
    currency_value, round(p_amount, 4), p_payment_method, nullif(trim(p_external_reference), ''),
    nullif(trim(p_notes), ''), coalesce(p_received_at, now()), p_actor_user_id
  ) returning * into payment_record;

  if p_allocations is not null then
    if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) > 100 then raise exception 'Payment allocations are invalid'; end if;
    for allocation_value in select value from jsonb_array_elements(p_allocations)
    loop
      begin
        allocation_id := (allocation_value->>'id')::uuid;
        invoice_id := (allocation_value->>'invoiceId')::uuid;
        allocation_amount := (allocation_value->>'amount')::numeric;
      exception when others then raise exception 'Payment allocation details are invalid'; end;
      perform private.insert_payment_allocation(
        p_workspace_id, allocation_id, p_payment_id, invoice_id, allocation_amount,
        p_actor_user_id, p_command_id, coalesce(p_received_at, now())
      );
      allocation_count := allocation_count + 1;
    end loop;
  end if;

  select * into payment_record from public.payments where workspace_id = p_workspace_id and id = p_payment_id;
  command_result := jsonb_build_object('action', 'record_payment', 'payment', to_jsonb(payment_record), 'allocationCount', allocation_count);
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'payment', p_payment_id, 'record_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment recorded',
    reference_value || ' · ' || currency_value || ' ' || round(p_amount, 4)::text,
    'green', 'payment', p_payment_id::text, p_command_id,
    jsonb_build_object('customer_id', p_customer_id, 'amount', round(p_amount,4), 'allocation_count', allocation_count, 'payment_method', p_payment_method, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.allocate_payment(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  allocation_record public.payment_allocations;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment allocation idempotency key is invalid'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment allocation access denied'; end if;

  allocation_record := private.insert_payment_allocation(
    p_workspace_id, p_allocation_id, p_payment_id, p_invoice_id, p_amount,
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  );
  command_result := jsonb_build_object('action', 'allocate_payment', 'allocation', to_jsonb(allocation_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'allocation', p_allocation_id, 'allocate_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment allocated',
    allocation_record.amount_delta::text || ' allocated to Invoice ' || p_invoice_id::text,
    'green', 'payment_allocation', p_allocation_id::text, p_command_id,
    jsonb_build_object('payment_id', p_payment_id, 'invoice_id', p_invoice_id, 'amount', allocation_record.amount_delta, 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.reverse_payment_allocation(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_allocation_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  original_record public.payment_allocations;
  reversal_record public.payment_allocations;
  payment_record public.payments;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Allocation reversal idempotency key is invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Allocation reversal reason is required'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment allocation reversal access denied'; end if;

  select * into original_record from public.payment_allocations allocation
  where allocation.workspace_id = p_workspace_id and allocation.id = p_allocation_id
  for update;
  if original_record.id is null or original_record.allocation_type <> 'allocation' then raise exception 'Payment allocation is unavailable for reversal'; end if;
  if exists (select 1 from public.payment_allocations where workspace_id = p_workspace_id and reversal_of_id = p_allocation_id) then raise exception 'Payment allocation has already been reversed'; end if;
  select * into payment_record from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = original_record.payment_id
  for update;
  if payment_record.status <> 'posted' then raise exception 'Payment is unavailable for allocation reversal'; end if;

  insert into public.payment_allocations (
    id, workspace_id, payment_id, invoice_id, allocation_type, amount_delta,
    reversal_of_id, reason, actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.payment_id, original_record.invoice_id,
    'reversal', -abs(original_record.amount_delta), original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  ) returning * into reversal_record;
  perform private.refresh_invoice_payment_status(p_workspace_id, original_record.invoice_id, p_actor_user_id);

  command_result := jsonb_build_object('action', 'reverse_allocation', 'allocation', to_jsonb(reversal_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'allocation', p_reversal_id, 'reverse_allocation', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment allocation reversed',
    abs(reversal_record.amount_delta)::text || ' released from Invoice ' || original_record.invoice_id::text,
    'neutral', 'payment_allocation', p_reversal_id::text, p_command_id,
    jsonb_build_object('payment_id', original_record.payment_id, 'invoice_id', original_record.invoice_id, 'original_allocation_id', original_record.id, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

create or replace function public.reverse_payment(
  p_workspace_id uuid,
  p_payment_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  command_result jsonb;
  payment_record public.payments;
  allocated_value numeric;
begin
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then raise exception 'Payment reversal idempotency key is invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Payment reversal reason is required'; end if;
  select result into previous_result from public.accounts_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Payment reversal access denied'; end if;

  select * into payment_record from public.payments payment
  where payment.workspace_id = p_workspace_id and payment.id = p_payment_id
  for update;
  if payment_record.id is null or payment_record.status <> 'posted' then raise exception 'Payment is unavailable for reversal'; end if;
  select coalesce(sum(amount_delta), 0) into allocated_value from public.payment_allocations
  where workspace_id = p_workspace_id and payment_id = p_payment_id;
  if allocated_value <> 0 then raise exception 'Reverse Payment allocations before reversing the Payment'; end if;

  update public.payments
  set status = 'reversed', reversed_at = now(), reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason), version = version + 1
  where workspace_id = p_workspace_id and id = p_payment_id
  returning * into payment_record;

  command_result := jsonb_build_object('action', 'reverse_payment', 'payment', to_jsonb(payment_record));
  insert into public.accounts_command_receipts (workspace_id, idempotency_key, entity_type, entity_id, action, result)
  values (p_workspace_id, trim(p_idempotency_key), 'payment', p_payment_id, 'reverse_payment', command_result);
  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone, entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Payment reversed',
    payment_record.reference || ' · ' || payment_record.currency || ' ' || payment_record.amount::text,
    'neutral', 'payment', p_payment_id::text, p_command_id,
    jsonb_build_object('customer_id', payment_record.customer_id, 'amount', payment_record.amount, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  );
  return command_result;
end;
$$;

revoke all on function public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.allocate_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.reverse_payment(uuid,uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_payment(uuid,uuid,text,uuid,uuid,uuid,numeric,text,timestamp with time zone,text,text,jsonb) to service_role;
grant execute on function public.allocate_payment(uuid,uuid,uuid,uuid,numeric,text,uuid,uuid,timestamp with time zone) to service_role;
grant execute on function public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone) to service_role;
grant execute on function public.reverse_payment(uuid,uuid,text,uuid,uuid,text) to service_role;

commit;


do $$
declare
  definition text;
  function_oid oid;
begin
  foreach function_oid in array array[
    'public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure::oid,
    'public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure::oid,
    'public.reverse_payment(uuid,uuid,text,uuid,uuid,text)'::regprocedure::oid
  ]
  loop
    select pg_get_functiondef(function_oid) into definition;
    execute replace(definition, '''red''', '''neutral''');
  end loop;
end;
$$;


drop index if exists public.invoice_lines_invoice_idx;
