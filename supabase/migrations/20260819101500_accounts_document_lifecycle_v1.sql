begin;

-- BDB OS V1 business-document lifecycle hardening.
-- Financial documents are final-first in the normal UI. Legacy drafts remain supported
-- for backwards compatibility, but new create flows can create + issue atomically.
-- Delivery Notes may be standalone and post-issue operational comments are stored
-- separately so the issued document itself remains immutable.

alter table public.delivery_notes
  drop constraint if exists delivery_notes_source_shape;
alter table public.delivery_notes
  add constraint delivery_notes_source_shape check (
    (((source_invoice_id is not null))::integer + ((source_sale_id is not null))::integer) <= 1
  );

alter table public.delivery_note_lines
  drop constraint if exists delivery_note_lines_source_shape;
alter table public.delivery_note_lines
  add constraint delivery_note_lines_source_shape check (
    (((source_invoice_line_id is not null))::integer + ((source_sale_line_id is not null))::integer) <= 1
  );

create table if not exists public.business_document_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice','credit_note','delivery_note')),
  document_id uuid not null,
  note text not null check (char_length(trim(note)) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index if not exists business_document_notes_lookup_idx
  on public.business_document_notes(workspace_id, document_type, document_id, created_at desc);

alter table public.business_document_notes enable row level security;
revoke all on public.business_document_notes from public, anon, authenticated;
grant select on public.business_document_notes to authenticated;

create policy "Business document notes Accounts read"
on public.business_document_notes for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

create or replace function public.add_business_document_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_note text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  note_record public.business_document_notes;
  document_number text;
begin
  if p_document_type not in ('invoice','credit_note','delivery_note') then
    raise exception 'Business document type is invalid';
  end if;
  if p_note is null or char_length(trim(p_note)) not between 1 and 2000 then
    raise exception 'Business document note is invalid';
  end if;
  if not private.accounts_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Accounts document note access denied';
  end if;

  if p_document_type = 'invoice' then
    select number into document_number from public.invoices
      where workspace_id=p_workspace_id and id=p_document_id;
  elsif p_document_type = 'credit_note' then
    select number into document_number from public.credit_notes
      where workspace_id=p_workspace_id and id=p_document_id;
  else
    select number into document_number from public.delivery_notes
      where workspace_id=p_workspace_id and id=p_document_id;
  end if;
  if document_number is null then raise exception 'Business document not found'; end if;

  insert into public.business_document_notes(id,workspace_id,document_type,document_id,note,created_by)
  values(p_note_id,p_workspace_id,p_document_type,p_document_id,trim(p_note),p_actor_user_id)
  returning * into note_record;

  insert into public.activity_items(workspace_id,actor_user_id,action,detail,tone,entity_type,entity_id,command_id,metadata)
  values(p_workspace_id,p_actor_user_id,'Document note added',document_number || ' · ' || left(trim(p_note),120),'neutral',p_document_type,p_document_id::text,p_command_id,
    jsonb_build_object('document_type',p_document_type,'document_number',document_number));

  return jsonb_build_object('note',to_jsonb(note_record));
end;
$$;

revoke all on function public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.add_business_document_note(uuid,uuid,text,uuid,text,uuid,uuid) to service_role;

create or replace function public.create_and_issue_invoice_command(
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
  p_lines jsonb default '[]'::jsonb
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
begin
  if p_source not in ('manual','sale') then raise exception 'Invoice source is invalid'; end if;
  create_action := case when p_source='manual' then 'create_manual' else 'create_from_sale' end;
  created := public.apply_invoice_command(
    p_workspace_id,p_invoice_id,create_action,p_idempotency_key || ':create',p_actor_user_id,p_command_id,
    null,p_source_sale_id,p_customer_id,p_due_at,p_description,p_notes,p_lines,null
  );
  created_version := (created #>> '{invoice,version}')::integer;
  issued := public.apply_invoice_command(
    p_workspace_id,p_invoice_id,'issue',p_idempotency_key || ':issue',p_actor_user_id,p_command_id,
    created_version,null,null,null,null,null,'[]'::jsonb,null
  );
  return issued;
end;
$$;

revoke all on function public.create_and_issue_invoice_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_and_issue_invoice_command(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,text,text,jsonb) to service_role;

create or replace function public.create_and_issue_credit_note_command(
  p_workspace_id uuid,
  p_credit_note_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_lines jsonb
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
begin
  created := public.apply_credit_note_command(
    p_workspace_id,p_credit_note_id,'create',p_idempotency_key || ':create',p_actor_user_id,p_command_id,
    null,p_invoice_id,p_reason,p_lines
  );
  created_version := (created #>> '{creditNote,version}')::integer;
  issued := public.apply_credit_note_command(
    p_workspace_id,p_credit_note_id,'issue',p_idempotency_key || ':issue',p_actor_user_id,p_command_id,
    created_version,null,null,'[]'::jsonb
  );
  return issued;
end;
$$;

revoke all on function public.create_and_issue_credit_note_command(uuid,uuid,text,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_and_issue_credit_note_command(uuid,uuid,text,uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.create_and_issue_delivery_note_command(
  p_workspace_id uuid,
  p_delivery_note_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_source_type text,
  p_source_id uuid default null,
  p_customer_id uuid default null,
  p_delivery_date date default null,
  p_delivery_address text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb
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
  customer_record public.customers;
  settings_record public.workspace_settings;
  note_record public.delivery_notes;
  line_value jsonb;
  line_number_value integer := 0;
  line_id uuid;
  code_value text;
  description_value text;
  quantity_value numeric;
  result_payload jsonb;
begin
  if p_source_type in ('invoice','sale') then
    if p_source_id is null then raise exception 'Delivery Note source is required'; end if;
    created := public.apply_delivery_note_command(
      p_workspace_id,p_delivery_note_id,'create',p_idempotency_key || ':create',p_actor_user_id,p_command_id,
      null,p_source_type,p_source_id,p_delivery_date,p_delivery_address,p_notes,p_lines
    );
    created_version := (created #>> '{deliveryNote,version}')::integer;
    issued := public.apply_delivery_note_command(
      p_workspace_id,p_delivery_note_id,'issue',p_idempotency_key || ':issue',p_actor_user_id,p_command_id,
      created_version,null,null,null,null,null,'[]'::jsonb
    );
    return issued;
  end if;

  if p_source_type <> 'manual' then raise exception 'Delivery Note source type is invalid'; end if;
  if not private.accounts_actor_can_write(p_workspace_id,p_actor_user_id,'create') then raise exception 'Accounts Delivery Note access denied'; end if;
  if p_customer_id is null then raise exception 'Delivery Note Customer is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'A Delivery Note must contain between 1 and 100 lines';
  end if;

  select * into customer_record from public.customers
  where workspace_id=p_workspace_id and id=p_customer_id and status='active';
  if customer_record.id is null then raise exception 'Delivery Note Customer is unavailable'; end if;
  select * into settings_record from public.workspace_settings where workspace_id=p_workspace_id;

  insert into public.delivery_notes(
    id,workspace_id,number,source_invoice_id,source_sale_id,customer_id,customer_name_snapshot,
    delivery_address,delivery_date,status,notes,version,created_by,updated_by,issued_by,issued_at
  ) values(
    p_delivery_note_id,p_workspace_id,
    private.next_business_document_number(p_workspace_id,'delivery_note',coalesce(settings_record.delivery_note_prefix,'DN'),coalesce(p_delivery_date,current_date)),
    null,null,customer_record.id,customer_record.name,
    coalesce(nullif(trim(p_delivery_address),''),customer_record.address),coalesce(p_delivery_date,current_date),'issued',
    nullif(trim(p_notes),''),1,p_actor_user_id,p_actor_user_id,p_actor_user_id,now()
  ) returning * into note_record;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    line_number_value := line_number_value + 1;
    begin line_id := (line_value->>'id')::uuid; exception when others then raise exception 'Delivery Note line identity is invalid'; end;
    code_value := trim(coalesce(line_value->>'code',''));
    if code_value='' then code_value := 'LINE-' || lpad(line_number_value::text,2,'0'); end if;
    description_value := trim(coalesce(line_value->>'description',''));
    begin quantity_value := (line_value->>'quantity')::numeric; exception when others then raise exception 'Delivery Note quantity is invalid'; end;
    if char_length(code_value) > 64 then raise exception 'Delivery Note line code is invalid'; end if;
    if description_value='' or char_length(description_value) > 240 then raise exception 'Delivery Note line description is invalid'; end if;
    if quantity_value is null or quantity_value <= 0 or quantity_value > 100000 then raise exception 'Delivery Note quantity is invalid'; end if;

    insert into public.delivery_note_lines(
      id,workspace_id,delivery_note_id,line_number,line_type,code_snapshot,description_snapshot,quantity
    ) values(
      line_id,p_workspace_id,p_delivery_note_id,line_number_value,'manual',code_value,description_value,quantity_value
    );
  end loop;

  result_payload := jsonb_build_object('action','issue','deliveryNote',to_jsonb(note_record));
  insert into public.accounts_command_receipts(workspace_id,idempotency_key,entity_type,entity_id,action,result)
  values(p_workspace_id,p_idempotency_key,'delivery_note',p_delivery_note_id,'issue_delivery_note',result_payload)
  on conflict (workspace_id,idempotency_key) do nothing;
  insert into public.activity_items(workspace_id,actor_user_id,action,detail,tone,entity_type,entity_id,command_id,metadata)
  values(p_workspace_id,p_actor_user_id,'Standalone Delivery Note issued',note_record.number || ' · ' || note_record.customer_name_snapshot,'blue','delivery_note',p_delivery_note_id::text,p_command_id,
    jsonb_build_object('customer_id',note_record.customer_id,'standalone',true,'idempotency_key',p_idempotency_key));
  return result_payload;
end;
$$;

revoke all on function public.create_and_issue_delivery_note_command(uuid,uuid,text,uuid,uuid,text,uuid,uuid,date,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_and_issue_delivery_note_command(uuid,uuid,text,uuid,uuid,text,uuid,uuid,date,text,text,jsonb) to service_role;

-- A fully credited invoice is cancelled through its Credit Note history, never by deletion/voiding.
create or replace view public.invoice_account_balances as
with allocation_totals as (
  select allocation.workspace_id, allocation.invoice_id,
         round(coalesce(sum(allocation.amount_delta),0),4) as allocated_amount
  from public.payment_allocations allocation
  join public.payments payment on payment.workspace_id=allocation.workspace_id and payment.id=allocation.payment_id
  where payment.status='posted'
  group by allocation.workspace_id, allocation.invoice_id
), credit_totals as (
  select workspace_id, invoice_id, round(coalesce(sum(total_amount),0),4) as credited_amount
  from public.credit_notes where status='issued'
  group by workspace_id, invoice_id
)
select invoice.*,
  coalesce(allocation.allocated_amount,0)::numeric(14,4) as allocated_amount,
  (case when invoice.status::text in ('draft','void') then 0
        else greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0) end)::numeric(14,4) as outstanding_amount,
  case
    when invoice.status::text='void' then 'void'
    when invoice.status::text='draft' then 'draft'
    when coalesce(credit.credited_amount,0) >= invoice.total_amount then 'cancelled'
    when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
    when coalesce(allocation.allocated_amount,0)>0 then 'partially_paid'
    else 'unpaid'
  end as payment_status,
  case
    when invoice.status::text='void' then 'void'
    when invoice.status::text='draft' then 'draft'
    when coalesce(credit.credited_amount,0) >= invoice.total_amount then 'cancelled'
    when greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0)-coalesce(allocation.allocated_amount,0),4),0)=0 then 'paid'
    when invoice.due_at < current_date then 'overdue'
    else 'sent'
  end as display_status,
  coalesce(credit.credited_amount,0)::numeric(14,4) as credited_amount,
  greatest(round(invoice.total_amount-coalesce(credit.credited_amount,0),4),0)::numeric(14,4) as adjusted_total_amount,
  (case when invoice.status::text in ('draft','void') then 0
        else greatest(round(coalesce(allocation.allocated_amount,0)-greatest(invoice.total_amount-coalesce(credit.credited_amount,0),0),4),0) end)::numeric(14,4) as overallocated_credit
from public.invoices invoice
left join allocation_totals allocation on allocation.workspace_id=invoice.workspace_id and allocation.invoice_id=invoice.id
left join credit_totals credit on credit.workspace_id=invoice.workspace_id and credit.invoice_id=invoice.id;

create or replace view public.business_document_index as
select invoice.workspace_id,'invoice'::text as document_type,invoice.id,invoice.number,invoice.customer_id,
       invoice.customer_name_snapshot as customer_name,invoice.issued_at as document_date,invoice.display_status as status,
       invoice.currency,invoice.adjusted_total_amount as total_amount,invoice.outstanding_amount as balance_amount,
       invoice.id as source_invoice_id,invoice.source_sale_id,null::text as reason
from public.invoice_account_balances invoice
union all
select note.workspace_id,'credit_note'::text,note.id,note.number,note.customer_id,note.customer_name_snapshot,note.issued_at,note.status,
       note.currency,note.total_amount,null::numeric,note.invoice_id,null::uuid,note.reason
from public.credit_notes note
union all
select note.workspace_id,'delivery_note'::text,note.id,note.number,note.customer_id,note.customer_name_snapshot,note.delivery_date,note.status,
       null::text,null::numeric,null::numeric,note.source_invoice_id,note.source_sale_id,null::text
from public.delivery_notes note;

grant select on public.invoice_account_balances, public.business_document_index to authenticated;

commit;
