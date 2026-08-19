begin;

-- BDB OS V1 Accounts correction:
-- 1. Credit Notes reverse the authoritative Invoice line values proportionally,
--    including VAT, so a full credit always cancels the exact Invoice amount.
-- 2. Customer-facing business-document numbers use simple workspace-scoped series:
--    INV001, CN001 and DN001, without a visible year or forced six-digit padding.

alter table public.business_document_sequences
  drop constraint if exists business_document_sequences_series_year_check;
alter table public.business_document_sequences
  add constraint business_document_sequences_series_year_check
  check (series_year = 0 or series_year between 2000 and 9999);

update public.workspace_settings
set invoice_prefix = 'INV',
    credit_note_prefix = 'CN',
    delivery_note_prefix = 'DN';

create or replace function private.next_business_document_number(
  p_workspace_id uuid,
  p_document_type text,
  p_prefix text,
  p_issue_date date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_prefix text := upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9-]', '', 'g'));
  next_value bigint;
  candidate text;
begin
  if p_document_type not in ('invoice', 'credit_note', 'delivery_note') then
    raise exception 'Unsupported business document type';
  end if;
  if normalized_prefix = '' or char_length(normalized_prefix) > 12 then
    raise exception 'Business document prefix is invalid';
  end if;

  loop
    insert into public.business_document_sequences (
      workspace_id, document_type, series_year, prefix, last_value, updated_at
    ) values (
      p_workspace_id, p_document_type, 0, normalized_prefix, 1, now()
    )
    on conflict (workspace_id, document_type, series_year, prefix) do update
    set last_value = public.business_document_sequences.last_value + 1,
        updated_at = now()
    returning last_value into next_value;

    candidate := normalized_prefix || case
      when next_value < 1000 then lpad(next_value::text, 3, '0')
      else next_value::text
    end;

    if p_document_type = 'invoice' then
      if not exists (
        select 1 from public.invoices
        where workspace_id = p_workspace_id and number = candidate
      ) then return candidate; end if;
    elsif p_document_type = 'credit_note' then
      if not exists (
        select 1 from public.credit_notes
        where workspace_id = p_workspace_id and number = candidate
      ) then return candidate; end if;
    else
      if not exists (
        select 1 from public.delivery_notes
        where workspace_id = p_workspace_id and number = candidate
      ) then return candidate; end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.next_business_document_number(uuid,text,text,date) from public, anon, authenticated;
grant execute on function private.next_business_document_number(uuid,text,text,date) to service_role;

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
  line_value jsonb;
  source_line public.invoice_lines;
  invoice_record public.invoices;
  line_id uuid;
  source_id uuid;
  requested_quantity numeric;
  requested_amount numeric;
  credited_quantity numeric;
  prior_legacy_credit numeric;
  line_number_value integer := 0;
  factor numeric;
  gross_value numeric;
  discount_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  gross_total numeric := 0;
  discount_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  credit_total numeric := 0;
  invoice_line_count integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Credit Note must contain between 1 and 100 lines';
  end if;

  select * into invoice_record from public.invoices
  where workspace_id = p_workspace_id and id = p_invoice_id;
  if invoice_record.id is null then raise exception 'Credit Note Invoice not found'; end if;

  select count(*) into invoice_line_count from public.invoice_lines
  where workspace_id = p_workspace_id and invoice_id = p_invoice_id;

  delete from public.credit_note_lines
  where workspace_id = p_workspace_id and credit_note_id = p_credit_note_id;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin line_id := (line_value->>'id')::uuid; exception when others then raise exception 'Credit Note line identity is invalid'; end;

    if invoice_line_count > 0 then
      begin source_id := (line_value->>'sourceInvoiceLineId')::uuid; exception when others then raise exception 'Credit Note source line is invalid'; end;
      select * into source_line from public.invoice_lines
      where workspace_id = p_workspace_id and id = source_id and invoice_id = p_invoice_id;
      if source_line.id is null then raise exception 'Credit Note source line is unavailable'; end if;

      begin requested_quantity := (line_value->>'quantity')::numeric; exception when others then raise exception 'Credit Note quantity is invalid'; end;
      if requested_quantity <= 0 then raise exception 'Credit Note quantity must be greater than zero'; end if;

      select coalesce(sum(line.quantity), 0) into credited_quantity
      from public.credit_note_lines line
      join public.credit_notes note
        on note.workspace_id = line.workspace_id and note.id = line.credit_note_id
      where line.workspace_id = p_workspace_id
        and line.source_invoice_line_id = source_id
        and note.status = 'issued';

      if requested_quantity + credited_quantity > source_line.quantity then
        raise exception 'Credit Note quantity exceeds the uncredited Invoice quantity';
      end if;

      factor := requested_quantity / source_line.quantity;

      -- Reverse the Invoice's authoritative stored values. Do not independently
      -- reinterpret VAT here: a full credit must exactly equal the Invoice line.
      gross_value := round(source_line.gross_amount * factor, 4);
      discount_value := round(source_line.discount_amount * factor, 4);
      net_value := round(source_line.net_amount * factor, 4);
      vat_value := round(source_line.vat_amount * factor, 4);
      total_value := round(net_value + vat_value, 4);

      insert into public.credit_note_lines (
        id, workspace_id, credit_note_id, source_invoice_line_id, line_number, line_type,
        product_id, service_id, code_snapshot, description_snapshot, quantity, unit_price,
        gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        line_id, p_workspace_id, p_credit_note_id, source_id, line_number_value, source_line.line_type,
        source_line.product_id, source_line.service_id, source_line.code_snapshot, source_line.description_snapshot,
        requested_quantity, source_line.unit_price, gross_value, discount_value, net_value,
        source_line.vat_rate, vat_value, total_value
      );
    else
      begin requested_amount := (line_value->>'amount')::numeric; exception when others then raise exception 'Legacy Credit Note amount is invalid'; end;
      if requested_amount <= 0 then raise exception 'Legacy Credit Note amount must be greater than zero'; end if;

      select coalesce(sum(line.total_amount), 0) into prior_legacy_credit
      from public.credit_note_lines line
      join public.credit_notes note
        on note.workspace_id = line.workspace_id and note.id = line.credit_note_id
      where note.workspace_id = p_workspace_id
        and note.invoice_id = p_invoice_id
        and note.status = 'issued';

      if requested_amount + prior_legacy_credit > invoice_record.total_amount then
        raise exception 'Credit Note amount exceeds the uncredited Invoice balance';
      end if;

      gross_value := requested_amount;
      discount_value := 0;
      net_value := requested_amount;
      vat_value := 0;
      total_value := requested_amount;

      insert into public.credit_note_lines (
        id, workspace_id, credit_note_id, line_number, line_type, code_snapshot, description_snapshot,
        quantity, unit_price, gross_amount, discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        line_id, p_workspace_id, p_credit_note_id, line_number_value, 'manual', 'ADJUSTMENT',
        'Credit against Invoice ' || invoice_record.number, 1, requested_amount,
        gross_value, 0, net_value, 0, 0, total_value
      );
    end if;

    gross_total := gross_total + gross_value;
    discount_total := discount_total + discount_value;
    net_total := net_total + net_value;
    vat_total := vat_total + vat_value;
    credit_total := credit_total + total_value;
  end loop;

  return jsonb_build_object(
    'gross', round(gross_total, 4),
    'discount', round(discount_total, 4),
    'net', round(net_total, 4),
    'vat', round(vat_total, 4),
    'total', round(credit_total, 4),
    'lineCount', line_number_value
  );
end;
$$;

-- Repair already-created line-linked Credit Notes, including issued test documents,
-- using the same authoritative proportional reversal. Legacy amount-only notes remain unchanged.
alter table public.credit_note_lines disable trigger credit_note_lines_immutability;
alter table public.credit_notes disable trigger credit_notes_immutability;

update public.credit_note_lines credit_line
set gross_amount = round(source_line.gross_amount * (credit_line.quantity / source_line.quantity), 4),
    discount_amount = round(source_line.discount_amount * (credit_line.quantity / source_line.quantity), 4),
    net_amount = round(source_line.net_amount * (credit_line.quantity / source_line.quantity), 4),
    vat_amount = round(source_line.vat_amount * (credit_line.quantity / source_line.quantity), 4),
    total_amount = round(
      round(source_line.net_amount * (credit_line.quantity / source_line.quantity), 4)
      + round(source_line.vat_amount * (credit_line.quantity / source_line.quantity), 4),
      4
    )
from public.invoice_lines source_line
where credit_line.workspace_id = source_line.workspace_id
  and credit_line.source_invoice_line_id = source_line.id
  and source_line.quantity > 0;

with corrected_totals as (
  select
    line.workspace_id,
    line.credit_note_id,
    round(sum(line.gross_amount), 4) as gross_amount,
    round(sum(line.discount_amount), 4) as discount_amount,
    round(sum(line.net_amount), 4) as net_amount,
    round(sum(line.vat_amount), 4) as vat_amount,
    round(sum(line.total_amount), 4) as total_amount
  from public.credit_note_lines line
  group by line.workspace_id, line.credit_note_id
)
update public.credit_notes note
set gross_amount = totals.gross_amount,
    discount_amount = totals.discount_amount,
    net_amount = totals.net_amount,
    vat_amount = totals.vat_amount,
    total_amount = totals.total_amount,
    updated_at = now()
from corrected_totals totals
where note.workspace_id = totals.workspace_id
  and note.id = totals.credit_note_id
  and (
    note.gross_amount is distinct from totals.gross_amount
    or note.discount_amount is distinct from totals.discount_amount
    or note.net_amount is distinct from totals.net_amount
    or note.vat_amount is distinct from totals.vat_amount
    or note.total_amount is distinct from totals.total_amount
  );

alter table public.credit_note_lines enable trigger credit_note_lines_immutability;
alter table public.credit_notes enable trigger credit_notes_immutability;

commit;
