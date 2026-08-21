-- Accounts Engine Hardening V1 — Pass 2: Document Permanence
--
-- Issued business documents must render from captured issue-time data, never from
-- mutable workspace/customer settings. Legacy issued documents freeze the values
-- they render today where no historical snapshot existed; existing snapshots are
-- never overwritten.

-- ---------------------------------------------------------------------------
-- Snapshot columns
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists supplier_email_snapshot text,
  add column if not exists supplier_phone_snapshot text,
  add column if not exists document_footer_snapshot text,
  add column if not exists document_permanence_snapshot_at timestamptz;

alter table public.credit_notes
  add column if not exists document_footer_snapshot text,
  add column if not exists document_permanence_snapshot_at timestamptz;

alter table public.delivery_notes
  add column if not exists supplier_name_snapshot text,
  add column if not exists supplier_address_snapshot text,
  add column if not exists supplier_vat_number_snapshot text,
  add column if not exists supplier_registration_number_snapshot text,
  add column if not exists customer_address_snapshot text,
  add column if not exists customer_vat_number_snapshot text,
  add column if not exists document_footer_snapshot text,
  add column if not exists document_permanence_snapshot_at timestamptz;

-- ---------------------------------------------------------------------------
-- Freeze legacy issued records at their currently rendered values.
-- Existing legal/customer snapshots win; only missing values are filled.
--
-- Credit Notes and Delivery Notes already reject every UPDATE after issue. This
-- migration is the one controlled exception required to freeze the values those
-- historical rows render today. The trigger disable/enable is transactional: if
-- any backfill statement fails, PostgreSQL rolls the migration back and restores
-- the original trigger state.
-- ---------------------------------------------------------------------------

alter table public.credit_notes disable trigger credit_notes_immutability;
alter table public.delivery_notes disable trigger delivery_notes_immutability;

update public.invoices invoice
set
  supplier_name_snapshot = coalesce(invoice.supplier_name_snapshot, coalesce(nullif(workspace.legal_name, ''), workspace.name)),
  supplier_address_snapshot = coalesce(invoice.supplier_address_snapshot, settings.business_address),
  supplier_vat_number_snapshot = coalesce(invoice.supplier_vat_number_snapshot, settings.vat_number),
  supplier_registration_number_snapshot = coalesce(invoice.supplier_registration_number_snapshot, settings.company_registration_number),
  supplier_email_snapshot = coalesce(invoice.supplier_email_snapshot, settings.email::text),
  supplier_phone_snapshot = coalesce(invoice.supplier_phone_snapshot, settings.phone),
  customer_name_snapshot = coalesce(nullif(invoice.customer_name_snapshot, ''), customer.name),
  customer_address_snapshot = coalesce(invoice.customer_address_snapshot, customer.address),
  customer_vat_number_snapshot = coalesce(invoice.customer_vat_number_snapshot, customer.vat_number),
  document_footer_snapshot = coalesce(invoice.document_footer_snapshot, settings.document_footer),
  document_permanence_snapshot_at = coalesce(invoice.document_permanence_snapshot_at, now())
from public.workspace_settings settings,
     public.workspaces workspace,
     public.customers customer
where invoice.workspace_id = settings.workspace_id
  and invoice.workspace_id = workspace.id
  and invoice.workspace_id = customer.workspace_id
  and invoice.customer_id = customer.id
  and invoice.status::text <> 'draft';

update public.credit_notes note
set
  supplier_name_snapshot = coalesce(note.supplier_name_snapshot, coalesce(nullif(workspace.legal_name, ''), workspace.name)),
  supplier_address_snapshot = coalesce(note.supplier_address_snapshot, settings.business_address),
  supplier_vat_number_snapshot = coalesce(note.supplier_vat_number_snapshot, settings.vat_number),
  supplier_registration_number_snapshot = coalesce(note.supplier_registration_number_snapshot, settings.company_registration_number),
  customer_name_snapshot = coalesce(nullif(note.customer_name_snapshot, ''), customer.name),
  customer_address_snapshot = coalesce(note.customer_address_snapshot, customer.address),
  customer_vat_number_snapshot = coalesce(note.customer_vat_number_snapshot, customer.vat_number),
  document_footer_snapshot = coalesce(note.document_footer_snapshot, settings.document_footer),
  document_permanence_snapshot_at = coalesce(note.document_permanence_snapshot_at, now())
from public.workspace_settings settings,
     public.workspaces workspace,
     public.customers customer
where note.workspace_id = settings.workspace_id
  and note.workspace_id = workspace.id
  and note.workspace_id = customer.workspace_id
  and note.customer_id = customer.id
  and note.status = 'issued';

update public.delivery_notes note
set
  supplier_name_snapshot = coalesce(note.supplier_name_snapshot, coalesce(nullif(workspace.legal_name, ''), workspace.name)),
  supplier_address_snapshot = coalesce(note.supplier_address_snapshot, settings.business_address),
  supplier_vat_number_snapshot = coalesce(note.supplier_vat_number_snapshot, settings.vat_number),
  supplier_registration_number_snapshot = coalesce(note.supplier_registration_number_snapshot, settings.company_registration_number),
  customer_name_snapshot = coalesce(nullif(note.customer_name_snapshot, ''), customer.name),
  customer_address_snapshot = coalesce(note.customer_address_snapshot, customer.address),
  customer_vat_number_snapshot = coalesce(note.customer_vat_number_snapshot, customer.vat_number),
  document_footer_snapshot = coalesce(note.document_footer_snapshot, settings.document_footer),
  document_permanence_snapshot_at = coalesce(note.document_permanence_snapshot_at, now())
from public.workspace_settings settings,
     public.workspaces workspace,
     public.customers customer
where note.workspace_id = settings.workspace_id
  and note.workspace_id = workspace.id
  and note.workspace_id = customer.workspace_id
  and note.customer_id = customer.id
  and note.status = 'issued';

alter table public.credit_notes enable trigger credit_notes_immutability;
alter table public.delivery_notes enable trigger delivery_notes_immutability;

-- ---------------------------------------------------------------------------
-- Future issue-time capture and post-issue snapshot preservation
-- ---------------------------------------------------------------------------

create or replace function private.snapshot_invoice_document_permanence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings_record public.workspace_settings;
begin
  if tg_op = 'INSERT' then
    if new.status::text <> 'draft' then
      select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
      new.supplier_email_snapshot := settings_record.email::text;
      new.supplier_phone_snapshot := settings_record.phone;
      new.document_footer_snapshot := settings_record.document_footer;
      new.document_permanence_snapshot_at := now();
    end if;
    return new;
  end if;

  if old.status::text <> 'draft' then
    new.supplier_name_snapshot := old.supplier_name_snapshot;
    new.supplier_address_snapshot := old.supplier_address_snapshot;
    new.supplier_vat_number_snapshot := old.supplier_vat_number_snapshot;
    new.supplier_registration_number_snapshot := old.supplier_registration_number_snapshot;
    new.supplier_email_snapshot := old.supplier_email_snapshot;
    new.supplier_phone_snapshot := old.supplier_phone_snapshot;
    new.customer_name_snapshot := old.customer_name_snapshot;
    new.customer_address_snapshot := old.customer_address_snapshot;
    new.customer_vat_number_snapshot := old.customer_vat_number_snapshot;
    new.document_footer_snapshot := old.document_footer_snapshot;
    new.document_permanence_snapshot_at := old.document_permanence_snapshot_at;
    return new;
  end if;

  if old.status::text = 'draft' and new.status::text <> 'draft' then
    select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
    new.supplier_email_snapshot := settings_record.email::text;
    new.supplier_phone_snapshot := settings_record.phone;
    new.document_footer_snapshot := settings_record.document_footer;
    new.document_permanence_snapshot_at := now();
  end if;
  return new;
end;
$function$;

create or replace function private.snapshot_credit_note_document_permanence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings_record public.workspace_settings;
begin
  if tg_op = 'INSERT' then
    if new.status = 'issued' then
      select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
      new.document_footer_snapshot := settings_record.document_footer;
      new.document_permanence_snapshot_at := now();
    end if;
    return new;
  end if;

  if old.status = 'issued' then
    new.supplier_name_snapshot := old.supplier_name_snapshot;
    new.supplier_address_snapshot := old.supplier_address_snapshot;
    new.supplier_vat_number_snapshot := old.supplier_vat_number_snapshot;
    new.supplier_registration_number_snapshot := old.supplier_registration_number_snapshot;
    new.customer_name_snapshot := old.customer_name_snapshot;
    new.customer_address_snapshot := old.customer_address_snapshot;
    new.customer_vat_number_snapshot := old.customer_vat_number_snapshot;
    new.document_footer_snapshot := old.document_footer_snapshot;
    new.document_permanence_snapshot_at := old.document_permanence_snapshot_at;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'issued' then
    select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
    new.document_footer_snapshot := settings_record.document_footer;
    new.document_permanence_snapshot_at := now();
  end if;
  return new;
end;
$function$;

create or replace function private.snapshot_delivery_note_document_permanence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings_record public.workspace_settings;
  workspace_record public.workspaces;
  customer_record public.customers;
begin
  if tg_op = 'UPDATE' and old.status = 'issued' then
    new.supplier_name_snapshot := old.supplier_name_snapshot;
    new.supplier_address_snapshot := old.supplier_address_snapshot;
    new.supplier_vat_number_snapshot := old.supplier_vat_number_snapshot;
    new.supplier_registration_number_snapshot := old.supplier_registration_number_snapshot;
    new.customer_name_snapshot := old.customer_name_snapshot;
    new.customer_address_snapshot := old.customer_address_snapshot;
    new.customer_vat_number_snapshot := old.customer_vat_number_snapshot;
    new.document_footer_snapshot := old.document_footer_snapshot;
    new.document_permanence_snapshot_at := old.document_permanence_snapshot_at;
    return new;
  end if;

  if (tg_op = 'INSERT' and new.status = 'issued')
     or (tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'issued') then
    select * into settings_record from public.workspace_settings where workspace_id = new.workspace_id;
    select * into workspace_record from public.workspaces where id = new.workspace_id;
    select * into customer_record from public.customers where workspace_id = new.workspace_id and id = new.customer_id;

    new.supplier_name_snapshot := coalesce(nullif(workspace_record.legal_name, ''), workspace_record.name);
    new.supplier_address_snapshot := settings_record.business_address;
    new.supplier_vat_number_snapshot := settings_record.vat_number;
    new.supplier_registration_number_snapshot := settings_record.company_registration_number;
    new.customer_name_snapshot := customer_record.name;
    new.customer_address_snapshot := customer_record.address;
    new.customer_vat_number_snapshot := customer_record.vat_number;
    new.document_footer_snapshot := settings_record.document_footer;
    new.document_permanence_snapshot_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists invoices_snapshot_document_permanence on public.invoices;
create trigger invoices_snapshot_document_permanence
before insert or update on public.invoices
for each row execute function private.snapshot_invoice_document_permanence();

drop trigger if exists credit_notes_snapshot_document_permanence on public.credit_notes;
create trigger credit_notes_snapshot_document_permanence
before insert or update on public.credit_notes
for each row execute function private.snapshot_credit_note_document_permanence();

drop trigger if exists delivery_notes_snapshot_document_permanence on public.delivery_notes;
create trigger delivery_notes_snapshot_document_permanence
before insert or update on public.delivery_notes
for each row execute function private.snapshot_delivery_note_document_permanence();

revoke all on function private.snapshot_invoice_document_permanence() from public, anon, authenticated;
revoke all on function private.snapshot_credit_note_document_permanence() from public, anon, authenticated;
revoke all on function private.snapshot_delivery_note_document_permanence() from public, anon, authenticated;
grant execute on function private.snapshot_invoice_document_permanence() to service_role;
grant execute on function private.snapshot_credit_note_document_permanence() to service_role;
grant execute on function private.snapshot_delivery_note_document_permanence() to service_role;

-- ---------------------------------------------------------------------------
-- Invoice rendering reads through this balance view, so expose the new immutable
-- document snapshots without changing any existing balance semantics.
-- ---------------------------------------------------------------------------

create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation.workspace_id, allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta),0),4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment
    on payment.workspace_id=allocation.workspace_id and payment.id=allocation.payment_id
  where payment.status='posted'
  group by allocation.workspace_id, allocation.invoice_id
), credit_totals as (
  select workspace_id,invoice_id,round(coalesce(sum(total_amount),0),4) as credited_amount
  from public.credit_notes
  where status='issued'
  group by workspace_id,invoice_id
)
select
  invoice.id,
  invoice.workspace_id,
  invoice.number,
  invoice.customer_id,
  invoice.issued_at,
  invoice.due_at,
  invoice.description,
  invoice.amount,
  invoice.status,
  invoice.created_at,
  invoice.updated_at,
  invoice.source_sale_id,
  invoice.currency,
  invoice.customer_code_snapshot,
  invoice.customer_name_snapshot,
  invoice.gross_amount,
  invoice.discount_amount,
  invoice.net_amount,
  invoice.vat_amount,
  invoice.total_amount,
  invoice.notes,
  invoice.version,
  invoice.created_by,
  invoice.updated_by,
  invoice.issued_by,
  invoice.sent_at,
  invoice.voided_at,
  invoice.voided_by,
  invoice.void_reason,
  coalesce(allocation.allocated_amount,0)::numeric(14,4) as allocated_amount,
  case when invoice.status::text in ('draft','void') then 0
       else greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)
  end::numeric(14,4) as outstanding_amount,
  case when invoice.status::text='void' then 'void'
       when invoice.status::text='draft' then 'draft'
       when coalesce(credit.credited_amount,0)>=invoice.total_amount then 'cancelled'
       when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
       when coalesce(allocation.allocated_amount,0)>0 then 'partially_paid'
       else 'unpaid' end as payment_status,
  case when invoice.status::text='void' then 'void'
       when invoice.status::text='draft' then 'draft'
       when coalesce(credit.credited_amount,0)>=invoice.total_amount then 'cancelled'
       when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
       when invoice.due_at<current_date then 'overdue'
       else 'sent' end as display_status,
  invoice.supplier_name_snapshot,
  invoice.supplier_address_snapshot,
  invoice.supplier_vat_number_snapshot,
  invoice.supplier_registration_number_snapshot,
  invoice.customer_address_snapshot,
  invoice.customer_vat_number_snapshot,
  invoice.supply_date,
  invoice.legal_snapshot_at,
  invoice.final_number_assigned_at,
  coalesce(credit.credited_amount,0)::numeric(14,4) as credited_amount,
  greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0),4),0)::numeric(14,4) as adjusted_total_amount,
  case when invoice.status::text in ('draft','void') then 0
       else greatest(round(coalesce(allocation.allocated_amount,0)-greatest(invoice.total_amount-coalesce(credit.credited_amount,0),0),4),0)
  end::numeric(14,4) as overallocated_credit,
  invoice.sales_order_reference,
  invoice.supplier_email_snapshot,
  invoice.supplier_phone_snapshot,
  invoice.document_footer_snapshot,
  invoice.document_permanence_snapshot_at
from public.invoices invoice
left join allocation_totals allocation
  on allocation.workspace_id=invoice.workspace_id and allocation.invoice_id=invoice.id
left join credit_totals credit
  on credit.workspace_id=invoice.workspace_id and credit.invoice_id=invoice.id;
