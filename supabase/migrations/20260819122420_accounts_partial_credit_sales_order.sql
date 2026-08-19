begin;

-- BDB OS V1 Accounts workflow:
-- - Product Invoices require a Sales Order (SO) reference before issue.
-- - Service-only Invoices do not require an SO reference.
-- - Credit Notes inherit the Invoice SO reference automatically.
-- - Credit Notes may be created by entering an exact monetary amount; BDB OS
--   allocates that amount proportionally across remaining authoritative Invoice
--   line/VAT values and reconciles the Credit Note total exactly.

alter table public.invoices
  add column if not exists sales_order_reference text;

alter table public.invoices
  drop constraint if exists invoices_sales_order_reference_check;
alter table public.invoices
  add constraint invoices_sales_order_reference_check
  check (
    sales_order_reference is null
    or char_length(trim(sales_order_reference)) between 1 and 64
  );

alter table public.credit_notes
  add column if not exists sales_order_reference text;

alter table public.credit_notes
  drop constraint if exists credit_notes_sales_order_reference_check;
alter table public.credit_notes
  add constraint credit_notes_sales_order_reference_check
  check (
    sales_order_reference is null
    or char_length(trim(sales_order_reference)) between 1 and 64
  );

-- Amount-based credits can represent a proportional part of a source quantity.
-- Keep more internal precision than the normal three-decimal quantity UI.
alter table public.credit_note_lines
  alter column quantity type numeric(14,6)
  using quantity::numeric(14,6);

create or replace function private.enforce_invoice_sales_order_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft'::public.invoice_status
     and new.status in (
       'sent'::public.invoice_status,
       'overdue'::public.invoice_status,
       'paid'::public.invoice_status
     )
     and exists (
       select 1
       from public.invoice_lines line
       where line.workspace_id = new.workspace_id
         and line.invoice_id = new.id
         and line.line_type = 'product'
     )
     and nullif(trim(new.sales_order_reference), '') is null then
    raise exception 'A Sales Order (SO) number is required because this Invoice contains Products';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_invoice_sales_order_on_issue()
from public, anon, authenticated;

drop trigger if exists invoices_require_sales_order on public.invoices;
create trigger invoices_require_sales_order
before update of status on public.invoices
for each row execute function private.enforce_invoice_sales_order_on_issue();

create or replace function private.snapshot_credit_note_sales_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select invoice.sales_order_reference
    into new.sales_order_reference
  from public.invoices invoice
  where invoice.workspace_id = new.workspace_id
    and invoice.id = new.invoice_id;
  return new;
end;
$$;

revoke all on function private.snapshot_credit_note_sales_order()
from public, anon, authenticated;

drop trigger if exists credit_notes_snapshot_sales_order on public.credit_notes;
create trigger credit_notes_snapshot_sales_order
before insert on public.credit_notes
for each row execute function private.snapshot_credit_note_sales_order();

-- Preserve the existing explicit line/quantity credit path for migration safety.
alter function private.write_credit_note_lines(uuid,uuid,uuid,jsonb)
  rename to write_credit_note_lines_by_quantity;

create or replace function private.write_credit_note_amount_lines(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_requested_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_record public.invoices;
  target_amount numeric := round(p_requested_amount, 4);
  previous_credit numeric := 0;
  remaining_invoice_total numeric := 0;
  remaining_source_total numeric := 0;
  allocation_factor numeric := 0;
  source_row record;
  line_number_value integer := 0;
  quantity_value numeric;
  gross_value numeric;
  discount_value numeric;
  net_value numeric;
  vat_value numeric;
  total_value numeric;
  inserted_total numeric := 0;
  residual numeric := 0;
  last_line_id uuid;
  totals record;
begin
  if target_amount <= 0 then
    raise exception 'Credit Note amount must be greater than zero';
  end if;

  select * into invoice_record
  from public.invoices
  where workspace_id = p_workspace_id
    and id = p_invoice_id
  for update;
  if invoice_record.id is null then
    raise exception 'Credit Note Invoice not found';
  end if;

  select coalesce(sum(note.total_amount), 0)
    into previous_credit
  from public.credit_notes note
  where note.workspace_id = p_workspace_id
    and note.invoice_id = p_invoice_id
    and note.status = 'issued';

  remaining_invoice_total := greatest(
    round(invoice_record.total_amount - previous_credit, 4),
    0
  );
  if target_amount > remaining_invoice_total then
    raise exception 'Credit Note amount exceeds the uncredited Invoice balance';
  end if;

  delete from public.credit_note_lines
  where workspace_id = p_workspace_id
    and credit_note_id = p_credit_note_id;

  if not exists (
    select 1
    from public.invoice_lines
    where workspace_id = p_workspace_id
      and invoice_id = p_invoice_id
  ) then
    -- Historical Invoice with no authoritative stored line detail.
    insert into public.credit_note_lines (
      id, workspace_id, credit_note_id, line_number, line_type,
      code_snapshot, description_snapshot, quantity, unit_price,
      gross_amount, discount_amount, net_amount, vat_rate,
      vat_amount, total_amount
    ) values (
      gen_random_uuid(), p_workspace_id, p_credit_note_id, 1, 'manual',
      'ADJUSTMENT', 'Credit against Invoice ' || invoice_record.number,
      1, target_amount, target_amount, 0, target_amount, 0, 0, target_amount
    );
  else
    -- Work from what remains after all issued source-linked credits.
    select coalesce(sum(greatest(
      round(line.total_amount - coalesce(credited.total_amount, 0), 4),
      0
    )), 0)
      into remaining_source_total
    from public.invoice_lines line
    left join (
      select credit_line.source_invoice_line_id,
             round(sum(credit_line.total_amount), 4) as total_amount
      from public.credit_note_lines credit_line
      join public.credit_notes note
        on note.workspace_id = credit_line.workspace_id
       and note.id = credit_line.credit_note_id
      where note.workspace_id = p_workspace_id
        and note.invoice_id = p_invoice_id
        and note.status = 'issued'
        and credit_line.source_invoice_line_id is not null
      group by credit_line.source_invoice_line_id
    ) credited on credited.source_invoice_line_id = line.id
    where line.workspace_id = p_workspace_id
      and line.invoice_id = p_invoice_id;

    if remaining_source_total <= 0
       or target_amount > remaining_source_total then
      raise exception 'Credit Note amount exceeds the remaining Invoice line value';
    end if;

    allocation_factor := target_amount / remaining_source_total;

    for source_row in
      select line.*,
             coalesce(credited.quantity, 0) as credited_quantity,
             coalesce(credited.gross_amount, 0) as credited_gross,
             coalesce(credited.discount_amount, 0) as credited_discount,
             coalesce(credited.net_amount, 0) as credited_net,
             coalesce(credited.vat_amount, 0) as credited_vat,
             coalesce(credited.total_amount, 0) as credited_total
      from public.invoice_lines line
      left join (
        select credit_line.source_invoice_line_id,
               sum(credit_line.quantity) as quantity,
               round(sum(credit_line.gross_amount), 4) as gross_amount,
               round(sum(credit_line.discount_amount), 4) as discount_amount,
               round(sum(credit_line.net_amount), 4) as net_amount,
               round(sum(credit_line.vat_amount), 4) as vat_amount,
               round(sum(credit_line.total_amount), 4) as total_amount
        from public.credit_note_lines credit_line
        join public.credit_notes note
          on note.workspace_id = credit_line.workspace_id
         and note.id = credit_line.credit_note_id
        where note.workspace_id = p_workspace_id
          and note.invoice_id = p_invoice_id
          and note.status = 'issued'
          and credit_line.source_invoice_line_id is not null
        group by credit_line.source_invoice_line_id
      ) credited on credited.source_invoice_line_id = line.id
      where line.workspace_id = p_workspace_id
        and line.invoice_id = p_invoice_id
        and round(line.total_amount - coalesce(credited.total_amount, 0), 4) > 0
      order by line.line_number
    loop
      line_number_value := line_number_value + 1;
      quantity_value := greatest(
        round(
          (source_row.quantity - source_row.credited_quantity)
          * allocation_factor,
          6
        ),
        0.000001
      );
      gross_value := round(
        greatest(source_row.gross_amount - source_row.credited_gross, 0)
        * allocation_factor,
        4
      );
      discount_value := round(
        greatest(source_row.discount_amount - source_row.credited_discount, 0)
        * allocation_factor,
        4
      );
      net_value := round(
        greatest(source_row.net_amount - source_row.credited_net, 0)
        * allocation_factor,
        4
      );
      vat_value := round(
        greatest(source_row.vat_amount - source_row.credited_vat, 0)
        * allocation_factor,
        4
      );
      total_value := round(net_value + vat_value, 4);

      insert into public.credit_note_lines (
        id, workspace_id, credit_note_id, source_invoice_line_id,
        line_number, line_type, product_id, service_id,
        code_snapshot, description_snapshot, quantity, unit_price,
        gross_amount, discount_amount, net_amount, vat_rate,
        vat_amount, total_amount
      ) values (
        gen_random_uuid(), p_workspace_id, p_credit_note_id, source_row.id,
        line_number_value, source_row.line_type,
        source_row.product_id, source_row.service_id,
        source_row.code_snapshot, source_row.description_snapshot,
        quantity_value, source_row.unit_price,
        gross_value, discount_value, net_value, source_row.vat_rate,
        vat_value, total_value
      ) returning id into last_line_id;
    end loop;

    if line_number_value < 1 then
      raise exception 'Credit Note has no remaining Invoice value to credit';
    end if;

    -- Independent four-decimal component rounding can leave a tiny residual.
    -- Apply that residual to the final source line so the requested CN amount
    -- is exact while retaining the original line/VAT relationship.
    select round(coalesce(sum(total_amount), 0), 4)
      into inserted_total
    from public.credit_note_lines
    where workspace_id = p_workspace_id
      and credit_note_id = p_credit_note_id;

    residual := round(target_amount - inserted_total, 4);
    if residual <> 0 and last_line_id is not null then
      update public.credit_note_lines
      set vat_amount = case
            when vat_rate > 0 and vat_amount + residual >= 0
              then vat_amount + residual
            else vat_amount
          end,
          net_amount = case
            when not (vat_rate > 0 and vat_amount + residual >= 0)
              then net_amount + residual
            else net_amount
          end,
          gross_amount = case
            when not (vat_rate > 0 and vat_amount + residual >= 0)
              then gross_amount + residual
            else gross_amount
          end,
          total_amount = total_amount + residual
      where workspace_id = p_workspace_id
        and id = last_line_id;
    end if;
  end if;

  select round(sum(gross_amount), 4) as gross,
         round(sum(discount_amount), 4) as discount,
         round(sum(net_amount), 4) as net,
         round(sum(vat_amount), 4) as vat,
         round(sum(total_amount), 4) as total,
         count(*)::integer as line_count
    into totals
  from public.credit_note_lines
  where workspace_id = p_workspace_id
    and credit_note_id = p_credit_note_id;

  if totals.total <> target_amount then
    raise exception 'Credit Note amount allocation did not reconcile exactly';
  end if;

  return jsonb_build_object(
    'gross', totals.gross,
    'discount', totals.discount,
    'net', totals.net,
    'vat', totals.vat,
    'total', totals.total,
    'lineCount', totals.line_count
  );
end;
$$;

revoke all on function private.write_credit_note_amount_lines(uuid,uuid,uuid,numeric)
from public, anon, authenticated;
grant execute on function private.write_credit_note_amount_lines(uuid,uuid,uuid,numeric)
to service_role;

create or replace function private.write_credit_note_lines(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_amount numeric;
begin
  if p_lines is not null
     and jsonb_typeof(p_lines) = 'array'
     and jsonb_array_length(p_lines) = 1
     and nullif(p_lines->0->>'amount', '') is not null
     and nullif(p_lines->0->>'sourceInvoiceLineId', '') is null then
    begin
      requested_amount := (p_lines->0->>'amount')::numeric;
    exception when others then
      raise exception 'Credit Note amount is invalid';
    end;
    return private.write_credit_note_amount_lines(
      p_workspace_id,
      p_credit_note_id,
      p_invoice_id,
      requested_amount
    );
  end if;

  return private.write_credit_note_lines_by_quantity(
    p_workspace_id,
    p_credit_note_id,
    p_invoice_id,
    p_lines
  );
end;
$$;

revoke all on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb)
from public, anon, authenticated;
grant execute on function private.write_credit_note_lines(uuid,uuid,uuid,jsonb)
to service_role;

-- Extend the final-first Invoice command with a durable SO reference while
-- preserving the existing caller shape through a defaulted final parameter.
drop function public.create_and_issue_invoice_command(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb
);

create function public.create_and_issue_invoice_command(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_source text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_source_sale_id uuid default null,
  p_customer_id uuid default null,
  p_due_at date default null,
  p_description text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_sales_order_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
  issued jsonb;
  created_version integer;
  create_action text;
  normalized_so text := nullif(trim(p_sales_order_reference), '');
begin
  if p_source not in ('manual','sale') then
    raise exception 'Invoice source is invalid';
  end if;
  if normalized_so is not null and char_length(normalized_so) > 64 then
    raise exception 'Sales Order (SO) number is invalid';
  end if;

  create_action := case
    when p_source = 'manual' then 'create_manual'
    else 'create_from_sale'
  end;

  created := public.apply_invoice_command(
    p_workspace_id,
    p_invoice_id,
    create_action,
    p_idempotency_key || ':create',
    p_actor_user_id,
    p_command_id,
    null,
    p_source_sale_id,
    p_customer_id,
    p_due_at,
    p_description,
    p_notes,
    p_lines,
    null
  );

  update public.invoices
  set sales_order_reference = normalized_so
  where workspace_id = p_workspace_id
    and id = p_invoice_id
    and status = 'draft'::public.invoice_status;

  if exists (
    select 1
    from public.invoice_lines line
    where line.workspace_id = p_workspace_id
      and line.invoice_id = p_invoice_id
      and line.line_type = 'product'
  ) and normalized_so is null then
    raise exception 'A Sales Order (SO) number is required because this Invoice contains Products';
  end if;

  created_version := (created #>> '{invoice,version}')::integer;
  issued := public.apply_invoice_command(
    p_workspace_id,
    p_invoice_id,
    'issue',
    p_idempotency_key || ':issue',
    p_actor_user_id,
    p_command_id,
    created_version,
    null,
    null,
    null,
    null,
    null,
    '[]'::jsonb,
    null
  );
  return issued;
end;
$$;

revoke all on function public.create_and_issue_invoice_command(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.create_and_issue_invoice_command(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb,text
) to service_role;

-- Keep Accounts reads RLS-safe and append the SO snapshot to the existing view.
create or replace view public.invoice_account_balances
with (security_invoker = true)
as
with allocation_totals as (
  select allocation_1.workspace_id,
         allocation_1.invoice_id,
         round(coalesce(sum(allocation_1.amount_delta), 0), 4) as allocated_amount
  from public.payment_allocations allocation_1
  join public.payments payment
    on payment.workspace_id = allocation_1.workspace_id
   and payment.id = allocation_1.payment_id
  where payment.status = 'posted'
  group by allocation_1.workspace_id, allocation_1.invoice_id
), credit_totals as (
  select credit_notes.workspace_id,
         credit_notes.invoice_id,
         round(coalesce(sum(credit_notes.total_amount), 0), 4) as credited_amount
  from public.credit_notes
  where credit_notes.status = 'issued'
  group by credit_notes.workspace_id, credit_notes.invoice_id
)
select invoice.id,
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
       coalesce(allocation.allocated_amount, 0)::numeric(14,4) as allocated_amount,
       (case
          when invoice.status::text in ('draft','void') then 0
          else greatest(round(
            invoice.total_amount
            - coalesce(credit.credited_amount, 0)
            - coalesce(allocation.allocated_amount, 0),
            4
          ), 0)
        end)::numeric(14,4) as outstanding_amount,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when coalesce(credit.credited_amount, 0) >= invoice.total_amount then 'cancelled'
         when greatest(round(
           invoice.total_amount
           - coalesce(credit.credited_amount, 0)
           - coalesce(allocation.allocated_amount, 0),
           4
         ), 0) = 0 then 'paid'
         when coalesce(allocation.allocated_amount, 0) > 0 then 'partially_paid'
         else 'unpaid'
       end as payment_status,
       case
         when invoice.status::text = 'void' then 'void'
         when invoice.status::text = 'draft' then 'draft'
         when coalesce(credit.credited_amount, 0) >= invoice.total_amount then 'cancelled'
         when greatest(round(
           invoice.total_amount
           - coalesce(credit.credited_amount, 0)
           - coalesce(allocation.allocated_amount, 0),
           4
         ), 0) = 0 then 'paid'
         when invoice.due_at < current_date then 'overdue'
         else 'sent'
       end as display_status,
       invoice.supplier_name_snapshot,
       invoice.supplier_address_snapshot,
       invoice.supplier_vat_number_snapshot,
       invoice.supplier_registration_number_snapshot,
       invoice.customer_address_snapshot,
       invoice.customer_vat_number_snapshot,
       invoice.supply_date,
       invoice.legal_snapshot_at,
       invoice.final_number_assigned_at,
       coalesce(credit.credited_amount, 0)::numeric(14,4) as credited_amount,
       greatest(round(
         invoice.total_amount - coalesce(credit.credited_amount, 0),
         4
       ), 0)::numeric(14,4) as adjusted_total_amount,
       (case
          when invoice.status::text in ('draft','void') then 0
          else greatest(round(
            coalesce(allocation.allocated_amount, 0)
            - greatest(invoice.total_amount - coalesce(credit.credited_amount, 0), 0),
            4
          ), 0)
        end)::numeric(14,4) as overallocated_credit,
       invoice.sales_order_reference
from public.invoices invoice
left join allocation_totals allocation
  on allocation.workspace_id = invoice.workspace_id
 and allocation.invoice_id = invoice.id
left join credit_totals credit
  on credit.workspace_id = invoice.workspace_id
 and credit.invoice_id = invoice.id;

grant select on public.invoice_account_balances to authenticated;

commit;
