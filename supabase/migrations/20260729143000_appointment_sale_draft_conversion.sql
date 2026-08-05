begin;

create table public.sale_drafts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null check (char_length(trim(reference)) between 8 and 64),
  source_appointment_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  customer_name_snapshot text not null check (char_length(trim(customer_name_snapshot)) between 1 and 200),
  service_code_snapshot text not null check (char_length(trim(service_code_snapshot)) between 1 and 64),
  service_name_snapshot text not null check (char_length(trim(service_name_snapshot)) between 1 and 240),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  discount_amount numeric(16,4) not null default 0 check (discount_amount >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  occurred_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'open' check (status in ('open', 'discarded', 'converted')),
  version integer not null default 1 check (version > 0),
  converted_sale_id uuid,
  converted_at timestamptz,
  converted_by uuid references auth.users(id) on delete restrict,
  discarded_at timestamptz,
  discarded_by uuid references auth.users(id) on delete restrict,
  discard_reason text check (discard_reason is null or char_length(discard_reason) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  unique (workspace_id, source_appointment_id),
  foreign key (workspace_id, source_appointment_id)
    references public.bookings(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, service_id)
    references public.services(workspace_id, id) on delete restrict,
  foreign key (workspace_id, converted_sale_id)
    references public.sales(workspace_id, id) on delete restrict,
  constraint sale_drafts_discount_check check (
    unit_price is null or discount_amount <= round(quantity * unit_price, 4)
  ),
  constraint sale_drafts_status_shape check (
    (
      status = 'open'
      and converted_sale_id is null and converted_at is null and converted_by is null
      and discarded_at is null and discarded_by is null and discard_reason is null
    )
    or (
      status = 'discarded'
      and converted_sale_id is null and converted_at is null and converted_by is null
      and discarded_at is not null and discarded_by is not null and discard_reason is not null
    )
    or (
      status = 'converted'
      and converted_sale_id is not null and converted_at is not null and converted_by is not null
      and discarded_at is null and discarded_by is null and discard_reason is null
    )
  )
);

create index sale_drafts_workspace_status_time_idx
  on public.sale_drafts(workspace_id, status, occurred_at desc, id desc);
create index sale_drafts_workspace_customer_idx
  on public.sale_drafts(workspace_id, customer_id, occurred_at desc);
create index sale_drafts_workspace_service_idx
  on public.sale_drafts(workspace_id, service_id, occurred_at desc);
create unique index sale_drafts_converted_sale_idx
  on public.sale_drafts(workspace_id, converted_sale_id)
  where converted_sale_id is not null;
create index sale_drafts_created_by_idx on public.sale_drafts(created_by);
create index sale_drafts_updated_by_idx on public.sale_drafts(updated_by);
create index sale_drafts_converted_by_idx on public.sale_drafts(converted_by) where converted_by is not null;
create index sale_drafts_discarded_by_idx on public.sale_drafts(discarded_by) where discarded_by is not null;

create table public.sale_draft_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  draft_id uuid not null,
  action text not null check (action in ('create', 'update', 'discard', 'restore', 'complete')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, draft_id)
    references public.sale_drafts(workspace_id, id) on delete cascade
);

create index sale_draft_command_receipts_draft_idx
  on public.sale_draft_command_receipts(workspace_id, draft_id, created_at desc);

create trigger sale_drafts_touch_updated_at
before update on public.sale_drafts
for each row execute function private.touch_updated_at();

create or replace function public.apply_appointment_sale_draft_command(
  p_workspace_id uuid,
  p_draft_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer default null,
  p_appointment_id uuid default null,
  p_sale_id uuid default null,
  p_unit_price numeric default null,
  p_discount_amount numeric default 0,
  p_occurred_at timestamptz default null,
  p_notes text default null,
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
  draft_record public.sale_drafts;
  appointment_record public.bookings;
  sale_record public.sales;
  currency_value text;
  gross_value numeric;
  discount_value numeric;
  total_value numeric;
  vat_value numeric;
  net_value numeric;
  activity_action text;
  activity_tone text;
  sale_line_id uuid;
begin
  if p_action not in ('create', 'update', 'discard', 'restore', 'complete') then
    raise exception 'Unsupported Appointment Sale draft action';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Appointment Sale draft idempotency key is invalid';
  end if;

  select receipt.result into previous_result
  from public.sale_draft_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = trim(p_idempotency_key);
  if previous_result is not null then return previous_result; end if;

  if not private.sales_actor_can_write(p_workspace_id, p_actor_user_id, 'complete') then
    raise exception 'Appointment Sale draft access denied';
  end if;

  if p_action = 'create' then
    if p_appointment_id is null then raise exception 'Completed Appointment is required'; end if;

    select * into draft_record
    from public.sale_drafts draft
    where draft.workspace_id = p_workspace_id
      and draft.source_appointment_id = p_appointment_id
    for update;

    if draft_record.id is not null then
      command_result := jsonb_build_object('action', 'create', 'draft', to_jsonb(draft_record), 'existing', true);
      insert into public.sale_draft_command_receipts (workspace_id, idempotency_key, draft_id, action, result)
      values (p_workspace_id, trim(p_idempotency_key), draft_record.id, 'create', command_result);
      return command_result;
    end if;

    select * into appointment_record
    from public.bookings booking
    where booking.workspace_id = p_workspace_id
      and booking.id = p_appointment_id
    for update;

    if appointment_record.id is null then raise exception 'Appointment not found'; end if;
    if appointment_record.status::text <> 'completed' or appointment_record.completed_at is null then
      raise exception 'Only completed Appointments can create Sale drafts';
    end if;
    if appointment_record.customer_id is null or appointment_record.service_id is null then
      raise exception 'Appointment Customer and Service are required for a Sale draft';
    end if;

    select upper(trim(settings.currency)) into currency_value
    from public.workspace_settings settings
    where settings.workspace_id = p_workspace_id;
    if currency_value is null or currency_value !~ '^[A-Z]{3}$' then
      raise exception 'Workspace currency is unavailable';
    end if;

    insert into public.sale_drafts (
      id, workspace_id, reference, source_appointment_id, customer_id, service_id,
      customer_name_snapshot, service_code_snapshot, service_name_snapshot,
      currency, quantity, unit_price, discount_amount, vat_rate, occurred_at,
      notes, created_by, updated_by
    ) values (
      p_draft_id, p_workspace_id,
      'SD-' || upper(right(replace(p_draft_id::text, '-', ''), 16)),
      appointment_record.id, appointment_record.customer_id, appointment_record.service_id,
      coalesce(nullif(trim(appointment_record.customer_name_snapshot), ''), 'Customer'),
      coalesce(nullif(trim(appointment_record.service_code_snapshot), ''), 'SERVICE'),
      appointment_record.title,
      currency_value, 1, appointment_record.price_snapshot, 0,
      appointment_record.vat_rate_snapshot, appointment_record.completed_at,
      'Created from Appointment ' || appointment_record.reference,
      p_actor_user_id, p_actor_user_id
    ) returning * into draft_record;

    activity_action := 'Appointment Sale draft created';
    activity_tone := 'blue';

  else
    select * into draft_record
    from public.sale_drafts draft
    where draft.workspace_id = p_workspace_id
      and draft.id = p_draft_id
    for update;

    if draft_record.id is null then raise exception 'Appointment Sale draft not found'; end if;

    if p_action = 'complete' and draft_record.status = 'converted' then
      select * into sale_record
      from public.sales sale
      where sale.workspace_id = p_workspace_id
        and sale.id = draft_record.converted_sale_id;
      command_result := jsonb_build_object(
        'action', 'complete',
        'draft', to_jsonb(draft_record),
        'sale', to_jsonb(sale_record),
        'existing', true,
        'inventoryMovementCount', 0
      );
      insert into public.sale_draft_command_receipts (workspace_id, idempotency_key, draft_id, action, result)
      values (p_workspace_id, trim(p_idempotency_key), draft_record.id, 'complete', command_result);
      return command_result;
    end if;

    if p_expected_version is null or draft_record.version <> p_expected_version then
      raise exception 'Appointment Sale draft changed on another device; refresh before saving';
    end if;

    if p_action = 'update' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be edited'; end if;
      if p_unit_price is null or p_unit_price < 0 then raise exception 'Appointment Sale draft price is required'; end if;
      if p_discount_amount is null or p_discount_amount < 0
        or p_discount_amount > round(draft_record.quantity * p_unit_price, 4) then
        raise exception 'Appointment Sale draft discount is invalid';
      end if;
      if p_occurred_at is null then raise exception 'Appointment Sale date and time are required'; end if;
      if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Appointment Sale notes are too long'; end if;

      update public.sale_drafts
      set unit_price = round(p_unit_price, 4),
          discount_amount = round(p_discount_amount, 4),
          occurred_at = p_occurred_at,
          notes = nullif(trim(p_notes), ''),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft updated';
      activity_tone := 'blue';

    elsif p_action = 'discard' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be discarded'; end if;
      if p_reason is null or char_length(trim(p_reason)) not between 2 and 500 then
        raise exception 'Appointment Sale draft discard reason is required';
      end if;
      update public.sale_drafts
      set status = 'discarded',
          discarded_at = now(),
          discarded_by = p_actor_user_id,
          discard_reason = trim(p_reason),
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft discarded';
      activity_tone := 'gold';

    elsif p_action = 'restore' then
      if draft_record.status <> 'discarded' then raise exception 'Only discarded Appointment Sale drafts can be restored'; end if;
      update public.sale_drafts
      set status = 'open',
          discarded_at = null,
          discarded_by = null,
          discard_reason = null,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;
      activity_action := 'Appointment Sale draft restored';
      activity_tone := 'green';

    elsif p_action = 'complete' then
      if draft_record.status <> 'open' then raise exception 'Only open Appointment Sale drafts can be completed'; end if;
      if p_sale_id is null then raise exception 'Sale identity is required'; end if;
      if draft_record.unit_price is null then raise exception 'Review and set the Appointment Sale price before completion'; end if;
      if exists (select 1 from public.sales where id = p_sale_id) then raise exception 'Sale identity conflict'; end if;

      gross_value := round(draft_record.quantity * draft_record.unit_price, 4);
      discount_value := round(draft_record.discount_amount, 4);
      if discount_value > gross_value then raise exception 'Appointment Sale draft discount is invalid'; end if;
      total_value := round(gross_value - discount_value, 4);
      vat_value := case
        when draft_record.vat_rate = 0 then 0
        else round(total_value * draft_record.vat_rate / (100 + draft_record.vat_rate), 4)
      end;
      net_value := round(total_value - vat_value, 4);
      sale_line_id := gen_random_uuid();

      insert into public.sales (
        id, workspace_id, reference, customer_id, channel, currency,
        gross_amount, discount_amount, net_amount, vat_amount, total_amount,
        inventory_location_id, notes, occurred_at, completed_by
      ) values (
        p_sale_id, p_workspace_id, 'SALE-PENDING', draft_record.customer_id,
        'appointment', draft_record.currency,
        gross_value, discount_value, net_value, vat_value, total_value,
        null, draft_record.notes, draft_record.occurred_at, p_actor_user_id
      ) returning * into sale_record;

      insert into public.sale_lines (
        id, workspace_id, sale_id, line_number, line_type,
        product_id, service_id, code_snapshot, description_snapshot,
        quantity, unit_price, unit_cost_snapshot, gross_amount,
        discount_amount, net_amount, vat_rate, vat_amount, total_amount
      ) values (
        sale_line_id, p_workspace_id, sale_record.id, 1, 'service',
        null, draft_record.service_id, draft_record.service_code_snapshot,
        draft_record.service_name_snapshot, draft_record.quantity,
        draft_record.unit_price, null, gross_value, discount_value,
        net_value, draft_record.vat_rate, vat_value, total_value
      );

      update public.sale_drafts
      set status = 'converted',
          converted_sale_id = sale_record.id,
          converted_at = now(),
          converted_by = p_actor_user_id,
          updated_by = p_actor_user_id,
          version = version + 1
      where workspace_id = p_workspace_id and id = p_draft_id
      returning * into draft_record;

      insert into public.activity_items (
        workspace_id, actor_user_id, action, detail, tone,
        entity_type, entity_id, command_id, metadata
      ) values (
        p_workspace_id, p_actor_user_id, 'Sale completed from Appointment',
        sale_record.reference || ' · ' || draft_record.service_name_snapshot || ' · ' || draft_record.currency || ' ' || total_value::text,
        'green', 'sale', sale_record.id::text, p_command_id,
        jsonb_build_object(
          'sale_id', sale_record.id,
          'sale_reference', sale_record.reference,
          'sale_draft_id', draft_record.id,
          'appointment_id', draft_record.source_appointment_id,
          'customer_id', draft_record.customer_id,
          'service_id', draft_record.service_id,
          'line_count', 1,
          'inventory_movement_count', 0,
          'total_amount', total_value,
          'settlement_status', 'not_recorded',
          'idempotency_key', p_idempotency_key
        )
      );

      activity_action := 'Appointment Sale draft converted';
      activity_tone := 'green';
    else
      raise exception 'Unsupported Appointment Sale draft action';
    end if;
  end if;

  command_result := case
    when p_action = 'complete' then jsonb_build_object(
      'action', p_action,
      'draft', to_jsonb(draft_record),
      'sale', to_jsonb(sale_record),
      'inventoryMovementCount', 0
    )
    else jsonb_build_object('action', p_action, 'draft', to_jsonb(draft_record))
  end;

  insert into public.sale_draft_command_receipts (
    workspace_id, idempotency_key, draft_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), draft_record.id, p_action, command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, activity_action,
    draft_record.reference || ' · ' || draft_record.customer_name_snapshot || ' · ' || draft_record.service_name_snapshot,
    activity_tone, 'sale_draft', draft_record.id::text, p_command_id,
    jsonb_build_object(
      'sale_draft_id', draft_record.id,
      'appointment_id', draft_record.source_appointment_id,
      'sale_id', draft_record.converted_sale_id,
      'status', draft_record.status,
      'version', draft_record.version,
      'idempotency_key', p_idempotency_key
    )
  );

  return command_result;
end;
$$;

revoke all on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) to service_role;

revoke all on table public.sale_drafts, public.sale_draft_command_receipts from anon, authenticated;
grant select on table public.sale_drafts to authenticated;

alter table public.sale_drafts enable row level security;
alter table public.sale_draft_command_receipts enable row level security;

create policy "Sales permission read Appointment Sale drafts"
on public.sale_drafts for select to authenticated
using (private.has_workspace_permission(workspace_id, 'sales', 'view'));

comment on table public.sale_drafts is
  'Sales-owned review drafts created one-to-one from completed Appointments. Draft creation has no Inventory, Payment, invoice or Banking side effects.';
comment on table public.sale_draft_command_receipts is
  'Service-role-only idempotency receipts for Appointment-to-Sale draft commands.';
comment on function public.apply_appointment_sale_draft_command(
  uuid, uuid, text, text, uuid, uuid, integer, uuid, uuid, numeric, numeric, timestamptz, text, text
) is
  'Creates, reviews, discards, restores or completes one Sales-owned draft from a completed Appointment. Completion creates one immutable service-only Sale with no settlement or Inventory movement.';

commit;