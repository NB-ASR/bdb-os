begin;

create or replace function public.apply_supplier_document_review(
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
  command_result jsonb;
  line_item jsonb;
  line_count integer := 0;
  created_product_count integer := 0;
  created_relationship_count integer := 0;
  supplier_uuid uuid;
  supplier_record public.suppliers;
  product_uuid uuid;
  relationship_uuid uuid;
  line_uuid uuid;
  line_kind_value text;
  document_type_value text;
  document_date_value date;
  due_date_value date;
  product_sku text;
  product_name text;
  product_barcode text;
  product_unit_cost numeric;
  product_selling_price numeric;
  product_vat_rate numeric;
  supplier_sku_value text;
  sku_base text;
  sku_suffix integer;
  generated_product public.products;
  generated_relationship public.product_suppliers;
begin
  if p_action not in ('save_review', 'approve') then raise exception 'Unsupported supplier document action'; end if;
  select receipt.result into previous_result
  from public.supplier_document_command_receipts receipt
  where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.supplier_document_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Supplier document write access denied';
  end if;

  select * into document_record
  from public.supplier_documents
  where workspace_id = p_workspace_id and id = p_document_id
  for update;
  if document_record.id is null then raise exception 'Supplier document not found'; end if;
  if document_record.status in ('approved', 'archived') then raise exception 'Approved or archived supplier documents cannot be edited'; end if;
  if p_expected_version is null or p_expected_version <> document_record.version then
    raise exception 'Supplier document changed on another device; refresh before saving';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Supplier document lines are invalid'; end if;

  supplier_uuid := nullif(p_header->>'supplierId', '')::uuid;
  document_type_value := coalesce(nullif(p_header->>'documentType', ''), 'other');
  if document_type_value not in ('invoice', 'credit_note', 'other') then raise exception 'Supplier document type is invalid'; end if;
  document_date_value := case when coalesce(p_header->>'documentDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_header->>'documentDate')::date else null end;
  due_date_value := case when coalesce(p_header->>'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_header->>'dueDate')::date else null end;

  if supplier_uuid is not null then
    select * into supplier_record
    from public.suppliers supplier
    where supplier.workspace_id = p_workspace_id and supplier.id = supplier_uuid and supplier.status = 'active';
    if supplier_record.id is null then raise exception 'Supplier document Supplier is invalid'; end if;
    if supplier_record.supplier_type <> 'product' then raise exception 'Only Product suppliers can be used for Product invoice lines'; end if;
  end if;

  delete from public.supplier_document_lines
  where workspace_id = p_workspace_id and document_id = p_document_id;

  for line_item in select value from jsonb_array_elements(p_lines) value
  loop
    line_count := line_count + 1;
    line_kind_value := coalesce(nullif(line_item->>'lineKind', ''), 'product');
    if line_kind_value not in ('product', 'expense') then raise exception 'Supplier document line kind is invalid'; end if;
    line_uuid := coalesce(nullif(line_item->>'id', '')::uuid, gen_random_uuid());
    product_uuid := nullif(line_item->>'matchedProductId', '')::uuid;
    relationship_uuid := nullif(line_item->>'matchedProductSupplierId', '')::uuid;

    if line_kind_value = 'product' and p_action = 'approve' and product_uuid is null then
      raise exception 'Every Product line must be linked to an existing Product or marked to create a new Product before approval';
    end if;

    if line_kind_value = 'product' and product_uuid is not null and not exists (
      select 1 from public.products product
      where product.workspace_id = p_workspace_id and product.id = product_uuid and product.status = 'active'
    ) then
      if p_action <> 'approve' or product_uuid <> line_uuid then
        raise exception 'Supplier document Product match is invalid';
      end if;
      if supplier_uuid is null then raise exception 'A Supplier is required before creating Products from invoice lines'; end if;
      if not private.product_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
        raise exception 'Product creation access denied';
      end if;
      if not private.product_supplier_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
        raise exception 'Product Supplier creation access denied';
      end if;

      product_name := coalesce(nullif(trim(line_item->>'description'), ''), 'Reviewed invoice Product');
      supplier_sku_value := nullif(trim(line_item->>'supplierSku'), '');
      product_barcode := nullif(trim(line_item->>'barcode'), '');
      product_unit_cost := coalesce(nullif(line_item->>'unitCost', '')::numeric, 0);
      product_selling_price := nullif(line_item->>'rrp', '')::numeric;
      product_vat_rate := coalesce(nullif(p_header->>'vatRate', '')::numeric, 0);

      if product_barcode is not null and exists (
        select 1 from public.products product
        where product.workspace_id = p_workspace_id and product.barcode = product_barcode
      ) then
        raise exception 'An existing Product already uses this barcode; select that Product before approval';
      end if;

      sku_base := upper(regexp_replace(
        coalesce(nullif(trim(supplier_record.code::text), ''), 'PRODUCT') || '-' ||
        coalesce(supplier_sku_value, right(replace(line_uuid::text, '-', ''), 8)),
        '[^A-Z0-9_-]+', '-', 'g'
      ));
      sku_base := left(trim(both '-' from sku_base), 56);
      if sku_base = '' then sku_base := 'PRODUCT-' || right(replace(line_uuid::text, '-', ''), 8); end if;
      product_sku := sku_base;
      sku_suffix := 1;
      while exists (
        select 1 from public.products product
        where product.workspace_id = p_workspace_id and product.sku = product_sku
      ) loop
        product_sku := left(sku_base, 56) || '-' || sku_suffix::text;
        sku_suffix := sku_suffix + 1;
      end loop;

      insert into public.products (
        id, workspace_id, sku, name, barcode, purpose, unit_label,
        unit_cost, selling_price, vat_rate, reorder_level, notes,
        created_by, updated_by
      ) values (
        product_uuid, p_workspace_id, product_sku, product_name, product_barcode,
        'resale', 'unit', product_unit_cost, product_selling_price,
        greatest(least(product_vat_rate, 100), 0), 0,
        'Created from supplier document ' || coalesce(nullif(trim(p_header->>'documentNumber'), ''), p_document_id::text) ||
          ' line ' || line_count::text,
        p_actor_user_id, p_actor_user_id
      ) returning * into generated_product;
      created_product_count := created_product_count + 1;

      insert into public.activity_items (
        workspace_id, actor_user_id, action, detail, tone,
        entity_type, entity_id, command_id, metadata
      ) values (
        p_workspace_id, p_actor_user_id, 'Product created from supplier document',
        generated_product.name || ' · ' || generated_product.sku::text,
        'blue', 'product', generated_product.id::text, p_command_id,
        jsonb_build_object(
          'product_id', generated_product.id,
          'supplier_document_id', p_document_id,
          'supplier_document_line_id', line_uuid,
          'source', 'supplier_document_approval'
        )
      );
    end if;

    if line_kind_value = 'product' and product_uuid is not null then
      if not exists (
        select 1 from public.products product
        where product.workspace_id = p_workspace_id and product.id = product_uuid and product.status = 'active'
      ) then raise exception 'Supplier document Product match is invalid'; end if;

      if supplier_uuid is not null then
        select relationship.id into relationship_uuid
        from public.product_suppliers relationship
        where relationship.workspace_id = p_workspace_id
          and relationship.product_id = product_uuid
          and relationship.supplier_id = supplier_uuid
          and relationship.status = 'active'
        limit 1;

        if relationship_uuid is null and p_action = 'approve' then
          if not private.product_supplier_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
            raise exception 'Product Supplier creation access denied';
          end if;
          supplier_sku_value := nullif(trim(line_item->>'supplierSku'), '');
          if supplier_sku_value is not null and exists (
            select 1 from public.product_suppliers relationship
            where relationship.workspace_id = p_workspace_id
              and relationship.supplier_id = supplier_uuid
              and relationship.supplier_sku = supplier_sku_value
              and relationship.product_id <> product_uuid
              and relationship.status = 'active'
          ) then
            raise exception 'This Supplier SKU is already linked to another Product';
          end if;

          insert into public.product_suppliers (
            id, workspace_id, product_id, supplier_id, supplier_sku,
            supplier_cost, currency, is_preferred, lead_time_days,
            minimum_order_quantity, notes, created_by, updated_by
          ) values (
            gen_random_uuid(), p_workspace_id, product_uuid, supplier_uuid,
            supplier_sku_value, nullif(line_item->>'unitCost', '')::numeric,
            upper(coalesce(nullif(trim(p_header->>'currency'), ''), 'EUR')),
            not exists (
              select 1 from public.product_suppliers relationship
              where relationship.workspace_id = p_workspace_id
                and relationship.product_id = product_uuid
                and relationship.status = 'active'
            ),
            0, 1,
            'Created from supplier document ' || coalesce(nullif(trim(p_header->>'documentNumber'), ''), p_document_id::text),
            p_actor_user_id, p_actor_user_id
          ) returning * into generated_relationship;
          relationship_uuid := generated_relationship.id;
          created_relationship_count := created_relationship_count + 1;

          insert into public.activity_items (
            workspace_id, actor_user_id, action, detail, tone,
            entity_type, entity_id, command_id, metadata
          ) values (
            p_workspace_id, p_actor_user_id, 'Product supplier linked from supplier document',
            product_name || ' · ' || supplier_record.name,
            'blue', 'product_supplier', generated_relationship.id::text, p_command_id,
            jsonb_build_object(
              'product_id', product_uuid,
              'supplier_id', supplier_uuid,
              'supplier_document_id', p_document_id,
              'supplier_document_line_id', line_uuid,
              'source', 'supplier_document_approval'
            )
          );
        end if;
      end if;
    end if;

    insert into public.supplier_document_lines (
      id, workspace_id, document_id, line_number, line_kind, printed_description,
      supplier_sku, barcode, quantity, unit_cost, rrp, matched_product_id,
      matched_product_supplier_id, match_method, match_confidence, review_status, notes
    ) values (
      line_uuid, p_workspace_id, p_document_id, line_count, line_kind_value,
      coalesce(nullif(trim(line_item->>'description'), ''), 'Reviewed line'),
      nullif(trim(line_item->>'supplierSku'), ''), nullif(trim(line_item->>'barcode'), ''),
      greatest(coalesce(nullif(line_item->>'quantity', '')::numeric, 1), 0.0001),
      nullif(line_item->>'unitCost', '')::numeric, nullif(line_item->>'rrp', '')::numeric,
      case when line_kind_value = 'product' then product_uuid else null end,
      case when line_kind_value = 'product' then relationship_uuid else null end,
      case when line_kind_value = 'expense' then 'manual'
           when product_uuid = line_uuid and created_product_count > 0 then 'manual'
           when product_uuid is not null then 'manual' else 'none' end,
      case when product_uuid is not null then 1 else null end,
      case when line_kind_value = 'expense' then 'non_stock'
           when product_uuid is not null then 'matched' else 'needs_review' end,
      nullif(trim(line_item->>'notes'), '')
    );
  end loop;

  if p_action = 'approve' then
    if supplier_uuid is null then raise exception 'A Supplier is required before approval'; end if;
    if document_type_value not in ('invoice', 'credit_note') then raise exception 'Invoice or Credit Note type is required before approval'; end if;
    if nullif(trim(p_header->>'documentNumber'), '') is null then raise exception 'Document number is required before approval'; end if;
    if document_date_value is null then raise exception 'Document date is required before approval'; end if;
    if line_count = 0 then raise exception 'At least one reviewed line is required before approval'; end if;
  end if;

  update public.supplier_documents
  set supplier_id = supplier_uuid,
      document_type = document_type_value,
      document_number = nullif(trim(p_header->>'documentNumber'), ''),
      document_date = document_date_value,
      due_date = due_date_value,
      currency = upper(coalesce(nullif(trim(p_header->>'currency'), ''), currency)),
      subtotal_before_discount = nullif(p_header->>'subtotalBeforeDiscount', '')::numeric,
      discount_amount = nullif(p_header->>'discountAmount', '')::numeric,
      net_after_discount = nullif(p_header->>'netAfterDiscount', '')::numeric,
      vat_rate = nullif(p_header->>'vatRate', '')::numeric,
      vat_amount = nullif(p_header->>'vatAmount', '')::numeric,
      gross_amount = nullif(p_header->>'grossAmount', '')::numeric,
      status = case when p_action = 'approve' then 'approved' else 'review_required' end,
      approved_at = case when p_action = 'approve' then now() else null end,
      approved_by = case when p_action = 'approve' then p_actor_user_id else null end,
      updated_by = p_actor_user_id,
      version = version + 1
  where workspace_id = p_workspace_id and id = p_document_id
  returning * into document_record;

  command_result := jsonb_build_object(
    'action', p_action,
    'document', to_jsonb(document_record),
    'lineCount', line_count,
    'createdProductCount', created_product_count,
    'createdRelationshipCount', created_relationship_count
  );
  insert into public.supplier_document_command_receipts (
    workspace_id, idempotency_key, document_id, action, result
  ) values (p_workspace_id, trim(p_idempotency_key), p_document_id, p_action, command_result);

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id,
    case when p_action = 'approve' then 'Supplier document approved' else 'Supplier document review saved' end,
    coalesce(document_record.document_number, document_record.file_name),
    case when p_action = 'approve' then 'green' else 'blue' end,
    'supplier_document', p_document_id::text, p_command_id,
    jsonb_build_object(
      'status', document_record.status,
      'lines', line_count,
      'created_products', created_product_count,
      'created_supplier_relationships', created_relationship_count,
      'inventoryPosting', document_record.inventory_posting_status,
      'accountsPosting', document_record.accounts_posting_status
    )
  );

  return command_result;
end;
$$;

revoke all on function public.apply_supplier_document_review(uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_supplier_document_review(uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb) to service_role;

comment on function public.apply_supplier_document_review(uuid, uuid, text, text, uuid, uuid, integer, jsonb, jsonb) is
  'Reviews supplier documents. During approval, a Product line whose proposed Product ID equals its line ID creates a new Product and Product-Supplier relationship atomically.';

commit;