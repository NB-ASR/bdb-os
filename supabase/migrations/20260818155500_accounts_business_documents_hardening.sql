begin;

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
  line_type_value text;
  product_id_value uuid;
  service_id_value uuid;
  product_record public.products;
  service_record public.services;
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
      product_id_value := nullif(line_value->>'productId','')::uuid;
      service_id_value := nullif(line_value->>'serviceId','')::uuid;
    exception when others then
      raise exception 'Invoice line identity is invalid';
    end;

    if product_id_value is not null and service_id_value is not null then raise exception 'Invoice line cannot reference both Product and Service'; end if;

    if product_id_value is not null then
      select * into product_record from public.products where workspace_id=p_workspace_id and id=product_id_value and status='active';
      if product_record.id is null then raise exception 'Invoice Product is unavailable'; end if;
      line_type_value := 'product';
      code_value := product_record.sku::text;
      description_value := product_record.name;
      vat_rate_value := coalesce(nullif(line_value->>'vatRate','')::numeric, product_record.vat_rate);
      unit_price_value := coalesce(nullif(line_value->>'unitPrice','')::numeric, product_record.selling_price);
    elsif service_id_value is not null then
      select * into service_record from public.services where workspace_id=p_workspace_id and id=service_id_value and status='active';
      if service_record.id is null then raise exception 'Invoice Service is unavailable'; end if;
      line_type_value := 'service';
      code_value := service_record.code::text;
      description_value := service_record.name;
      vat_rate_value := coalesce(nullif(line_value->>'vatRate','')::numeric, service_record.vat_rate);
      unit_price_value := coalesce(nullif(line_value->>'unitPrice','')::numeric, service_record.price);
    else
      line_type_value := 'manual';
      description_value := trim(coalesce(line_value->>'description',''));
      code_value := trim(coalesce(line_value->>'code',''));
      if code_value='' then code_value := 'LINE-'||lpad(line_number_value::text,2,'0'); end if;
      begin
        vat_rate_value := coalesce(nullif(line_value->>'vatRate','')::numeric,0);
        unit_price_value := (line_value->>'unitPrice')::numeric;
      exception when others then raise exception 'Invoice line amount is invalid'; end;
    end if;

    begin
      quantity_value := (line_value->>'quantity')::numeric;
      discount_value := coalesce(nullif(line_value->>'discountAmount','')::numeric,0);
    exception when others then raise exception 'Invoice line amount is invalid'; end;

    if description_value='' or char_length(description_value)>240 then raise exception 'Invoice line description is invalid'; end if;
    if code_value='' or char_length(code_value)>64 then raise exception 'Invoice line code is invalid'; end if;
    if quantity_value is null or quantity_value<=0 or quantity_value>100000 then raise exception 'Invoice line quantity is invalid'; end if;
    if unit_price_value is null or unit_price_value<0 then raise exception 'Invoice line price is invalid'; end if;
    if vat_rate_value is null or vat_rate_value<0 or vat_rate_value>100 then raise exception 'Invoice line VAT rate is invalid'; end if;

    gross_value := round(quantity_value*unit_price_value,4);
    if discount_value<0 or discount_value>gross_value then raise exception 'Invoice line discount is invalid'; end if;
    total_value := round(gross_value-discount_value,4);
    vat_value := case when vat_rate_value=0 then 0 else round(total_value*vat_rate_value/(100+vat_rate_value),4) end;
    net_value := round(total_value-vat_value,4);

    insert into public.invoice_lines(
      id,workspace_id,invoice_id,line_number,line_type,product_id,service_id,
      code_snapshot,description_snapshot,quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
    ) values (
      line_id,p_workspace_id,p_invoice_id,line_number_value,line_type_value,product_id_value,service_id_value,
      code_value,description_value,quantity_value,unit_price_value,gross_value,discount_value,net_value,vat_rate_value,vat_value,total_value
    );

    gross_total := gross_total+gross_value;
    discount_total := discount_total+discount_value;
    net_total := net_total+net_value;
    vat_total := vat_total+vat_value;
    invoice_total := invoice_total+total_value;
  end loop;

  return jsonb_build_object('gross',round(gross_total,4),'discount',round(discount_total,4),'net',round(net_total,4),'vat',round(vat_total,4),'total',round(invoice_total,4),'lineCount',line_number_value);
end;
$$;

create or replace function public.update_business_document_settings(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_business_address text,
  p_vat_number text,
  p_credit_note_prefix text,
  p_delivery_note_prefix text,
  p_default_payment_terms_days integer,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.actor_has_workspace_permission(p_workspace_id,p_actor_user_id,'accounts','approve') then raise exception 'Business document settings access denied'; end if;
  if char_length(btrim(coalesce(p_business_address,'')))<1 or char_length(p_business_address)>500 then raise exception 'Business address is invalid'; end if;
  if char_length(btrim(coalesce(p_vat_number,'')))<2 or char_length(p_vat_number)>40 then raise exception 'Business VAT number is invalid'; end if;
  if upper(p_credit_note_prefix)!~'^[A-Z0-9]{1,8}$' or upper(p_delivery_note_prefix)!~'^[A-Z0-9]{1,8}$' then raise exception 'Document prefix is invalid'; end if;
  if p_default_payment_terms_days<0 or p_default_payment_terms_days>365 then raise exception 'Payment terms are invalid'; end if;

  update public.workspace_settings
  set business_address=btrim(p_business_address),vat_number=btrim(p_vat_number),credit_note_prefix=upper(p_credit_note_prefix),delivery_note_prefix=upper(p_delivery_note_prefix),default_payment_terms_days=p_default_payment_terms_days,updated_at=now()
  where workspace_id=p_workspace_id;

  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_user_id,'accounts.document_settings_updated','workspace',p_workspace_id,jsonb_build_object('command_id',p_command_id));

  return jsonb_build_object('workspaceId',p_workspace_id,'updated',true);
end;
$$;

create or replace function public.update_customer_vat_number(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid,
  p_vat_number text,
  p_expected_version integer,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  customer_record public.customers;
begin
  if not private.actor_has_workspace_permission(p_workspace_id,p_actor_user_id,'customers','edit') then raise exception 'Customer access denied'; end if;
  select * into customer_record from public.customers where workspace_id=p_workspace_id and id=p_customer_id for update;
  if customer_record.id is null then raise exception 'Customer not found'; end if;
  if customer_record.version<>p_expected_version then raise exception 'Customer changed on another device'; end if;
  if p_vat_number is not null and (char_length(btrim(p_vat_number))<2 or char_length(p_vat_number)>40) then raise exception 'Customer VAT number is invalid'; end if;
  update public.customers set vat_number=nullif(btrim(p_vat_number),''),version=version+1,updated_by=p_actor_user_id,updated_at=now() where workspace_id=p_workspace_id and id=p_customer_id;
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_user_id,'customer.vat_number_updated','customer',p_customer_id,jsonb_build_object('command_id',p_command_id));
  return jsonb_build_object('id',p_customer_id,'version',p_expected_version+1);
end;
$$;

create or replace function private.enforce_credit_note_immutability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.status<>'draft' and tg_op='DELETE' then raise exception 'Issued Credit Notes are immutable'; end if;
  if tg_op='UPDATE' and old.status<>'draft' and not (old.status='issued' and new.status='void') then raise exception 'Issued Credit Notes are immutable'; end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists credit_notes_enforce_immutability on public.credit_notes;
create trigger credit_notes_enforce_immutability before update or delete on public.credit_notes for each row execute function private.enforce_credit_note_immutability();

create or replace function private.enforce_credit_note_line_immutability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare status_value text;
begin
  select status into status_value from public.credit_notes where workspace_id=coalesce(new.workspace_id,old.workspace_id) and id=coalesce(new.credit_note_id,old.credit_note_id);
  if status_value<>'draft' then raise exception 'Issued Credit Note lines are immutable'; end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists credit_note_lines_enforce_immutability on public.credit_note_lines;
create trigger credit_note_lines_enforce_immutability before update or delete on public.credit_note_lines for each row execute function private.enforce_credit_note_line_immutability();

create or replace function private.enforce_delivery_note_immutability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.status<>'draft' and tg_op='DELETE' then raise exception 'Issued Delivery Notes are immutable'; end if;
  if tg_op='UPDATE' and old.status<>'draft' and not (old.status='issued' and new.status='void') then raise exception 'Issued Delivery Notes are immutable'; end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists delivery_notes_enforce_immutability on public.delivery_notes;
create trigger delivery_notes_enforce_immutability before update or delete on public.delivery_notes for each row execute function private.enforce_delivery_note_immutability();

create or replace function private.enforce_delivery_note_line_immutability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare status_value text;
begin
  select status into status_value from public.delivery_notes where workspace_id=coalesce(new.workspace_id,old.workspace_id) and id=coalesce(new.delivery_note_id,old.delivery_note_id);
  if status_value<>'draft' then raise exception 'Issued Delivery Note lines are immutable'; end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists delivery_note_lines_enforce_immutability on public.delivery_note_lines;
create trigger delivery_note_lines_enforce_immutability before update or delete on public.delivery_note_lines for each row execute function private.enforce_delivery_note_line_immutability();

revoke all on function public.update_business_document_settings(uuid,uuid,text,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.update_business_document_settings(uuid,uuid,text,text,text,text,integer,uuid) to service_role;
revoke all on function public.update_customer_vat_number(uuid,uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.update_customer_vat_number(uuid,uuid,uuid,text,integer,uuid) to service_role;

commit;
