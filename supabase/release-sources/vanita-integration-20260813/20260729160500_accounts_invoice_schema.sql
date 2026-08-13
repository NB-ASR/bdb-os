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
