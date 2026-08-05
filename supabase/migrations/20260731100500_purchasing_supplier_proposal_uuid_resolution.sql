begin;

create or replace function public.apply_supplier_document_review_with_supplier_proposal(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_header jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_record public.supplier_documents;
  previous_result jsonb;
  adjusted_header jsonb := coalesce(p_header, '{}'::jsonb);
  requested_supplier_id uuid;
  resolved_supplier_id uuid;
  extracted_supplier_name text;
  normalized_supplier_name text;
  matching_supplier_count integer := 0;
  supplier_code_base text;
  supplier_code text;
  supplier_code_suffix integer := 1;
  created_supplier public.suppliers;
begin
  if p_action not in ('save_review', 'approve') then
    raise exception 'Unsupported supplier document action';
  end if;

  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then
    return previous_result;
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id
    and id = p_document_id
  for update;

  if document_record.id is null then
    raise exception 'Supplier document not found';
  end if;

  requested_supplier_id := nullif(adjusted_header->>'supplierId', '')::uuid;

  if requested_supplier_id = p_document_id
     and not exists (
       select 1
       from public.suppliers supplier
       where supplier.workspace_id = p_workspace_id
         and supplier.id = requested_supplier_id
     ) then
    if p_action = 'save_review' then
      adjusted_header := jsonb_set(adjusted_header, '{supplierId}', '""'::jsonb, true);
    else
      extracted_supplier_name := nullif(trim(document_record.extracted_supplier_text), '');
      normalized_supplier_name := private.normalise_supplier_identity_name(extracted_supplier_name);

      if extracted_supplier_name is null
         or char_length(extracted_supplier_name) not between 2 and 160
         or normalized_supplier_name is null then
        raise exception 'The extracted Supplier name must be confirmed before creating a Supplier';
      end if;

      if not private.supplier_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
        raise exception 'Supplier creation access denied';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_workspace_id::text || ':' || normalized_supplier_name, 0)
      );

      select count(*)
      into matching_supplier_count
      from public.suppliers supplier
      where supplier.workspace_id = p_workspace_id
        and supplier.status = 'active'
        and supplier.supplier_type = 'product'
        and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name;

      if matching_supplier_count > 1 then
        raise exception 'Several Suppliers match the extracted name; choose the correct Supplier explicitly';
      end if;

      if matching_supplier_count = 1 then
        select supplier.id
        into resolved_supplier_id
        from public.suppliers supplier
        where supplier.workspace_id = p_workspace_id
          and supplier.status = 'active'
          and supplier.supplier_type = 'product'
          and private.normalise_supplier_identity_name(supplier.name) = normalized_supplier_name
        order by supplier.id::text
        limit 1;
      else
        supplier_code_base := upper(regexp_replace(extracted_supplier_name, '[^A-Za-z0-9]+', '', 'g'));
        supplier_code_base := left(coalesce(nullif(supplier_code_base, ''), 'SUPPLIER'), 56);
        supplier_code := supplier_code_base;

        while exists (
          select 1
          from public.suppliers supplier
          where supplier.workspace_id = p_workspace_id
            and supplier.code = supplier_code
        ) loop
          supplier_code := left(supplier_code_base, greatest(1, 56 - char_length(supplier_code_suffix::text) - 1))
            || '-' || supplier_code_suffix::text;
          supplier_code_suffix := supplier_code_suffix + 1;
        end loop;

        insert into public.suppliers (
          id, workspace_id, code, name, supplier_type, payment_terms_days,
          default_discount, document_currency, notes, created_by, updated_by
        ) values (
          gen_random_uuid(), p_workspace_id, supplier_code, extracted_supplier_name,
          'product', 0, 0,
          upper(coalesce(nullif(trim(adjusted_header->>'currency'), ''), document_record.currency, 'EUR')),
          'Created from approved supplier document ' || coalesce(
            nullif(trim(adjusted_header->>'documentNumber'), ''), p_document_id::text
          ),
          p_actor_user_id, p_actor_user_id
        ) returning * into created_supplier;

        resolved_supplier_id := created_supplier.id;

        insert into public.activity_items (
          workspace_id, actor_user_id, action, detail, tone,
          entity_type, entity_id, command_id, metadata
        ) values (
          p_workspace_id, p_actor_user_id,
          'Supplier created from supplier document',
          created_supplier.name || ' · ' || created_supplier.code::text,
          'blue', 'supplier', created_supplier.id::text, p_command_id,
          jsonb_build_object(
            'supplier_id', created_supplier.id,
            'supplier_document_id', p_document_id,
            'source', 'supplier_document_approval',
            'extracted_name', extracted_supplier_name
          )
        );
      end if;

      adjusted_header := jsonb_set(
        adjusted_header, '{supplierId}', to_jsonb(resolved_supplier_id::text), true
      );
    end if;
  end if;

  return public.apply_supplier_document_review(
    p_workspace_id, p_document_id, p_action, p_idempotency_key,
    p_actor_user_id, p_command_id, p_expected_version, adjusted_header, p_lines
  );
end;
$$;

revoke all on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) to service_role;

comment on function public.apply_supplier_document_review_with_supplier_proposal(
  uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb
) is
  'Approves a human-confirmed extracted Supplier proposal and resolves an exact existing Supplier UUID without unsupported UUID aggregates.';

commit;
