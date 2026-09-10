begin;

-- The Customer register is a composed read model. Canonical Customer identity
-- remains in public.customers; unresolved import exceptions remain in
-- public.customer_import_review_items until a human resolves or dismisses them.
--
-- This function is SECURITY DEFINER deliberately: the previous SECURITY INVOKER
-- page function caused the Customer RLS permission function to execute once per
-- scanned row. The register now validates the authenticated workspace permission
-- once at the function boundary, then performs a strictly workspace-scoped read.
-- Customer mutation paths remain unchanged and continue to use their command
-- receipts/idempotency boundaries.

create index if not exists customer_import_review_items_workspace_pending_created_idx
  on public.customer_import_review_items (workspace_id, created_at, id)
  where status = 'pending';

create or replace function public.read_customer_register_page(
  p_workspace_id uuid,
  p_page integer default 1,
  p_limit integer default 50,
  p_search text default null,
  p_filter text default 'active',
  p_include_summary boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_total bigint := 0;
  v_total_pages integer := 1;
  v_offset integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := null;
  v_active_count bigint := 0;
  v_archived_count bigint := 0;
  v_imported_count bigint := 0;
  v_company_count bigint := 0;
  v_review_count bigint := 0;
begin
  if p_workspace_id is null then
    raise exception 'Customer register workspace is required' using errcode = '22023';
  end if;
  if v_actor_user_id is null then
    raise exception 'Customer register authentication is required' using errcode = '28000';
  end if;
  if p_filter not in ('active', 'archived', 'review', 'all') then
    raise exception 'Customer register filter is invalid' using errcode = '22023';
  end if;
  if not private.has_workspace_permission(p_workspace_id, 'customers', 'view') then
    raise exception 'Customer register access denied' using errcode = '42501';
  end if;

  if p_filter = 'active' then
    if v_search is null then
      select count(*) into v_total
      from public.customers customer
      where customer.workspace_id = p_workspace_id
        and customer.status = 'active';
    else
      select count(*) into v_total
      from public.customers customer
      where customer.workspace_id = p_workspace_id
        and customer.status = 'active'
        and customer.search_text like '%' || v_search || '%';
    end if;
  elsif p_filter = 'archived' then
    if v_search is null then
      select count(*) into v_total
      from public.customers customer
      where customer.workspace_id = p_workspace_id
        and customer.status = 'archived';
    else
      select count(*) into v_total
      from public.customers customer
      where customer.workspace_id = p_workspace_id
        and customer.status = 'archived'
        and customer.search_text like '%' || v_search || '%';
    end if;
  elsif p_filter = 'review' then
    if v_search is null then
      select count(*) into v_total
      from public.customer_import_review_items review
      where review.workspace_id = p_workspace_id
        and review.status = 'pending';
    else
      select count(*) into v_total
      from public.customer_import_review_items review
      where review.workspace_id = p_workspace_id
        and review.status = 'pending'
        and lower(concat_ws(' ', review.source_file, review.issue_message, review.payload::text)) like '%' || v_search || '%';
    end if;
  else
    if v_search is null then
      select
        (select count(*) from public.customers customer where customer.workspace_id = p_workspace_id)
        +
        (select count(*) from public.customer_import_review_items review where review.workspace_id = p_workspace_id and review.status = 'pending')
      into v_total;
    else
      select
        (select count(*) from public.customers customer
          where customer.workspace_id = p_workspace_id
            and customer.search_text like '%' || v_search || '%')
        +
        (select count(*) from public.customer_import_review_items review
          where review.workspace_id = p_workspace_id
            and review.status = 'pending'
            and lower(concat_ws(' ', review.source_file, review.issue_message, review.payload::text)) like '%' || v_search || '%')
      into v_total;
    end if;
  end if;

  v_total_pages := greatest(1, ceil(v_total::numeric / v_limit)::integer);
  v_page := least(v_page, v_total_pages);
  v_offset := (v_page - 1) * v_limit;

  if p_filter in ('active', 'archived') then
    if v_search is null then
      select coalesce(jsonb_agg(page.item order by page.sort_name, page.record_id), '[]'::jsonb)
      into v_items
      from (
        select
          customer.name as sort_name,
          customer.id as record_id,
          jsonb_build_object(
            'rowKind', 'customer',
            'id', customer.id,
            'customer', jsonb_build_object(
              'id', customer.id,
              'workspace_id', customer.workspace_id,
              'code', customer.code,
              'name', customer.name,
              'company', customer.company,
              'email', customer.email,
              'phone', customer.phone,
              'address', customer.address,
              'vat_number', customer.vat_number,
              'notes', customer.notes,
              'preferences', customer.preferences,
              'status', customer.status,
              'version', customer.version,
              'legacy_source', customer.legacy_source,
              'legacy_id', customer.legacy_id,
              'migration_batch_id', customer.migration_batch_id,
              'needs_review', customer.needs_review,
              'created_at', customer.created_at,
              'updated_at', customer.updated_at
            )
          ) as item
        from public.customers customer
        where customer.workspace_id = p_workspace_id
          and customer.status = p_filter
        order by customer.name, customer.id
        limit v_limit offset v_offset
      ) page;
    else
      select coalesce(jsonb_agg(page.item order by page.sort_name, page.record_id), '[]'::jsonb)
      into v_items
      from (
        select
          customer.name as sort_name,
          customer.id as record_id,
          jsonb_build_object(
            'rowKind', 'customer',
            'id', customer.id,
            'customer', jsonb_build_object(
              'id', customer.id,
              'workspace_id', customer.workspace_id,
              'code', customer.code,
              'name', customer.name,
              'company', customer.company,
              'email', customer.email,
              'phone', customer.phone,
              'address', customer.address,
              'vat_number', customer.vat_number,
              'notes', customer.notes,
              'preferences', customer.preferences,
              'status', customer.status,
              'version', customer.version,
              'legacy_source', customer.legacy_source,
              'legacy_id', customer.legacy_id,
              'migration_batch_id', customer.migration_batch_id,
              'needs_review', customer.needs_review,
              'created_at', customer.created_at,
              'updated_at', customer.updated_at
            )
          ) as item
        from public.customers customer
        where customer.workspace_id = p_workspace_id
          and customer.status = p_filter
          and customer.search_text like '%' || v_search || '%'
        order by customer.name, customer.id
        limit v_limit offset v_offset
      ) page;
    end if;
  elsif p_filter = 'review' then
    select coalesce(jsonb_agg(page.item order by page.sort_name, page.record_id), '[]'::jsonb)
    into v_items
    from (
      select
        lower(coalesce(
          nullif(trim(review.payload->>'name'), ''),
          nullif(trim(review.payload->>'full_name'), ''),
          nullif(trim(review.payload->>'customer_name'), ''),
          nullif(trim(review.payload->>'client_name'), ''),
          nullif(trim(concat_ws(' ', review.payload->>'first_name', review.payload->>'last_name')), ''),
          review.source_file || ' row ' || review.source_row::text
        )) as sort_name,
        review.id as record_id,
        jsonb_build_object(
          'rowKind', 'import_review',
          'id', review.id,
          'review', jsonb_build_object(
            'id', review.id,
            'source_file', review.source_file,
            'source_row', review.source_row,
            'payload', review.payload,
            'issue_code', review.issue_code,
            'issue_message', review.issue_message,
            'created_at', review.created_at
          )
        ) as item
      from public.customer_import_review_items review
      where review.workspace_id = p_workspace_id
        and review.status = 'pending'
        and (v_search is null or lower(concat_ws(' ', review.source_file, review.issue_message, review.payload::text)) like '%' || v_search || '%')
      order by sort_name, review.id
      limit v_limit offset v_offset
    ) page;
  else
    select coalesce(jsonb_agg(page.item order by page.sort_name, page.row_kind, page.record_id), '[]'::jsonb)
    into v_items
    from (
      select register_row.*
      from (
        select
          customer.name as sort_name,
          'customer'::text as row_kind,
          customer.id as record_id,
          jsonb_build_object(
            'rowKind', 'customer',
            'id', customer.id,
            'customer', jsonb_build_object(
              'id', customer.id,
              'workspace_id', customer.workspace_id,
              'code', customer.code,
              'name', customer.name,
              'company', customer.company,
              'email', customer.email,
              'phone', customer.phone,
              'address', customer.address,
              'vat_number', customer.vat_number,
              'notes', customer.notes,
              'preferences', customer.preferences,
              'status', customer.status,
              'version', customer.version,
              'legacy_source', customer.legacy_source,
              'legacy_id', customer.legacy_id,
              'migration_batch_id', customer.migration_batch_id,
              'needs_review', customer.needs_review,
              'created_at', customer.created_at,
              'updated_at', customer.updated_at
            )
          ) as item
        from public.customers customer
        where customer.workspace_id = p_workspace_id
          and (v_search is null or customer.search_text like '%' || v_search || '%')

        union all

        select
          lower(coalesce(
            nullif(trim(review.payload->>'name'), ''),
            nullif(trim(review.payload->>'full_name'), ''),
            nullif(trim(review.payload->>'customer_name'), ''),
            nullif(trim(review.payload->>'client_name'), ''),
            nullif(trim(concat_ws(' ', review.payload->>'first_name', review.payload->>'last_name')), ''),
            review.source_file || ' row ' || review.source_row::text
          )) as sort_name,
          'import_review'::text as row_kind,
          review.id as record_id,
          jsonb_build_object(
            'rowKind', 'import_review',
            'id', review.id,
            'review', jsonb_build_object(
              'id', review.id,
              'source_file', review.source_file,
              'source_row', review.source_row,
              'payload', review.payload,
              'issue_code', review.issue_code,
              'issue_message', review.issue_message,
              'created_at', review.created_at
            )
          ) as item
        from public.customer_import_review_items review
        where review.workspace_id = p_workspace_id
          and review.status = 'pending'
          and (v_search is null or lower(concat_ws(' ', review.source_file, review.issue_message, review.payload::text)) like '%' || v_search || '%')
      ) register_row
      order by register_row.sort_name, register_row.row_kind, register_row.record_id
      limit v_limit offset v_offset
    ) page;
  end if;

  if p_include_summary then
    select
      count(*) filter (where customer.status = 'active'),
      count(*) filter (where customer.status = 'archived'),
      count(*) filter (where customer.legacy_source is not null),
      count(distinct nullif(trim(customer.company), ''))
    into v_active_count, v_archived_count, v_imported_count, v_company_count
    from public.customers customer
    where customer.workspace_id = p_workspace_id;

    select count(*) into v_review_count
    from public.customer_import_review_items review
    where review.workspace_id = p_workspace_id
      and review.status = 'pending';

    v_summary := jsonb_build_object(
      'activeCount', v_active_count,
      'archivedCount', v_archived_count,
      'importedCount', v_imported_count,
      'companyCount', v_company_count,
      'reviewCount', v_review_count
    );
  end if;

  return jsonb_build_object(
    'items', v_items,
    'page', jsonb_build_object(
      'number', v_page,
      'limit', v_limit,
      'totalFiltered', v_total,
      'totalPages', v_total_pages,
      'hasPrevious', v_page > 1,
      'hasNext', v_page < v_total_pages
    ),
    'summary', v_summary
  );
end;
$$;

revoke all on function public.read_customer_register_page(uuid,integer,integer,text,text,boolean)
  from public, anon;
grant execute on function public.read_customer_register_page(uuid,integer,integer,text,text,boolean)
  to authenticated, service_role;

comment on function public.read_customer_register_page(uuid,integer,integer,text,text,boolean) is
  'Authorized Customer register read model. Review means unresolved import exceptions only; All composes Customers plus pending import review rows. Permission is checked once before workspace-scoped SECURITY DEFINER reads to avoid row-by-row RLS permission evaluation.';

commit;
