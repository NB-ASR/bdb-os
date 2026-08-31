begin;

-- Catalogue Engine V1 Pass 3: bounded operational reads and indexed search.
-- Existing list/read contracts remain untouched so downstream departments are not
-- silently broken while Catalogue screens move onto the scalable contracts.

create extension if not exists pg_trgm with schema extensions;

-- Stable keyset pagination indexes. The status-specific variants support the
-- normal Active/Archived filters without large OFFSET scans.
create index if not exists products_workspace_name_cursor_idx
  on public.products(workspace_id, name, id);
create index if not exists products_workspace_status_name_cursor_idx
  on public.products(workspace_id, status, name, id);
create index if not exists products_workspace_status_purpose_name_cursor_idx
  on public.products(workspace_id, status, purpose, name, id);
create index if not exists services_workspace_name_cursor_idx
  on public.services(workspace_id, name, id);
create index if not exists services_workspace_status_name_cursor_idx
  on public.services(workspace_id, status, name, id);
create index if not exists services_workspace_status_booking_name_cursor_idx
  on public.services(workspace_id, status, booking_mode, name, id);
create index if not exists suppliers_workspace_product_status_name_cursor_idx
  on public.suppliers(workspace_id, supplier_type, status, name, id);

-- One indexed search expression per register is deliberately preferred over
-- several OR-ed ILIKE predicates. It preserves one simple V1 search box while
-- giving PostgreSQL a predictable trigram plan at scale.
create index if not exists products_catalogue_search_trgm_idx
  on public.products using gin ((
    lower(
      name || ' ' || sku::text || ' ' || coalesce(barcode::text, '') || ' '
      || coalesce(brand, '') || ' ' || coalesce(category, '') || ' ' || purpose
    )
  ) extensions.gin_trgm_ops);
create index if not exists services_catalogue_search_trgm_idx
  on public.services using gin ((
    lower(
      name || ' ' || code::text || ' ' || coalesce(category, '') || ' '
      || coalesce(description, '') || ' ' || booking_mode
    )
  ) extensions.gin_trgm_ops);
create index if not exists suppliers_catalogue_search_trgm_idx
  on public.suppliers using gin ((lower(name || ' ' || code::text)) extensions.gin_trgm_ops);

create or replace function public.catalogue_product_page(
  p_workspace_id uuid,
  p_limit integer default 101,
  p_after_name text default null,
  p_after_id uuid default null,
  p_query text default null,
  p_status text default null,
  p_purpose text default null
)
returns setof public.products
language sql
stable
security invoker
set search_path = ''
as $$
  select product.*
  from public.products product
  where product.workspace_id = p_workspace_id
    and (p_status is null or product.status = p_status)
    and (p_purpose is null or product.purpose = p_purpose)
    and (
      nullif(trim(p_query), '') is null
      or lower(
        product.name || ' ' || product.sku::text || ' ' || coalesce(product.barcode::text, '') || ' '
        || coalesce(product.brand, '') || ' ' || coalesce(product.category, '') || ' ' || product.purpose
      ) like '%' || lower(trim(p_query)) || '%'
    )
    and (
      p_after_name is null
      or p_after_id is null
      or (product.name, product.id) > (p_after_name, p_after_id)
    )
  order by product.name asc, product.id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

create or replace function public.catalogue_product_summary(p_workspace_id uuid)
returns table (
  total_count bigint,
  active_count bigint,
  archived_count bigint,
  resale_count bigint,
  supply_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where product.status = 'active')::bigint,
    count(*) filter (where product.status = 'archived')::bigint,
    count(*) filter (where product.status = 'active' and product.purpose = 'resale')::bigint,
    count(*) filter (where product.status = 'active' and product.purpose = 'supply')::bigint
  from public.products product
  where product.workspace_id = p_workspace_id;
$$;

create or replace function public.catalogue_service_page(
  p_workspace_id uuid,
  p_limit integer default 101,
  p_after_name text default null,
  p_after_id uuid default null,
  p_query text default null,
  p_status text default null,
  p_booking_mode text default null
)
returns setof public.services
language sql
stable
security invoker
set search_path = ''
as $$
  select service.*
  from public.services service
  where service.workspace_id = p_workspace_id
    and (p_status is null or service.status = p_status)
    and (p_booking_mode is null or service.booking_mode = p_booking_mode)
    and (
      nullif(trim(p_query), '') is null
      or lower(
        service.name || ' ' || service.code::text || ' ' || coalesce(service.category, '') || ' '
        || coalesce(service.description, '') || ' ' || service.booking_mode
      ) like '%' || lower(trim(p_query)) || '%'
    )
    and (
      p_after_name is null
      or p_after_id is null
      or (service.name, service.id) > (p_after_name, p_after_id)
    )
  order by service.name asc, service.id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

create or replace function public.catalogue_service_summary(p_workspace_id uuid)
returns table (
  total_count bigint,
  active_count bigint,
  archived_count bigint,
  customer_bookable_count bigint,
  staff_only_count bigint,
  priced_count bigint,
  active_duration_minutes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where service.status = 'active')::bigint,
    count(*) filter (where service.status = 'archived')::bigint,
    count(*) filter (where service.status = 'active' and service.booking_mode = 'customer')::bigint,
    count(*) filter (where service.status = 'active' and service.booking_mode = 'staff')::bigint,
    count(*) filter (where service.status = 'active' and service.price is not null)::bigint,
    coalesce(sum(service.duration_minutes) filter (where service.status = 'active'), 0)::bigint
  from public.services service
  where service.workspace_id = p_workspace_id;
$$;

create or replace function public.catalogue_supplier_terms_page(
  p_workspace_id uuid,
  p_limit integer default 101,
  p_after_name text default null,
  p_after_id uuid default null,
  p_query text default null
)
returns table (
  product_id uuid,
  sku text,
  name text,
  active_supplier_count bigint,
  preferred_supplier_id uuid,
  preferred_supplier_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    product.id,
    product.sku::text,
    product.name,
    (
      select count(*)::bigint
      from public.product_suppliers relationship
      where relationship.workspace_id = p_workspace_id
        and relationship.product_id = product.id
        and relationship.status = 'active'
    ) as active_supplier_count,
    preferred_relationship.supplier_id,
    preferred_supplier.name
  from public.products product
  left join lateral (
    select relationship.supplier_id
    from public.product_suppliers relationship
    where relationship.workspace_id = p_workspace_id
      and relationship.product_id = product.id
      and relationship.status = 'active'
      and relationship.is_preferred
    limit 1
  ) preferred_relationship on true
  left join public.suppliers preferred_supplier
    on preferred_supplier.workspace_id = p_workspace_id
   and preferred_supplier.id = preferred_relationship.supplier_id
  where product.workspace_id = p_workspace_id
    and product.status = 'active'
    and (
      nullif(trim(p_query), '') is null
      or lower(
        product.name || ' ' || product.sku::text || ' ' || coalesce(product.barcode::text, '') || ' '
        || coalesce(product.brand, '') || ' ' || coalesce(product.category, '') || ' ' || product.purpose
      ) like '%' || lower(trim(p_query)) || '%'
    )
    and (
      p_after_name is null
      or p_after_id is null
      or (product.name, product.id) > (p_after_name, p_after_id)
    )
  order by product.name asc, product.id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

create or replace function public.catalogue_product_supplier_options_page(
  p_workspace_id uuid,
  p_limit integer default 101,
  p_after_name text default null,
  p_after_id uuid default null,
  p_query text default null
)
returns setof public.suppliers
language sql
stable
security invoker
set search_path = ''
as $$
  select supplier.*
  from public.suppliers supplier
  where supplier.workspace_id = p_workspace_id
    and supplier.supplier_type = 'product'
    and supplier.status = 'active'
    and (
      nullif(trim(p_query), '') is null
      or lower(supplier.name || ' ' || supplier.code::text)
        like '%' || lower(trim(p_query)) || '%'
    )
    and (
      p_after_name is null
      or p_after_id is null
      or (supplier.name, supplier.id) > (p_after_name, p_after_id)
    )
  order by supplier.name asc, supplier.id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

revoke all on function public.catalogue_product_page(uuid, integer, text, uuid, text, text, text) from public, anon;
revoke all on function public.catalogue_product_summary(uuid) from public, anon;
revoke all on function public.catalogue_service_page(uuid, integer, text, uuid, text, text, text) from public, anon;
revoke all on function public.catalogue_service_summary(uuid) from public, anon;
revoke all on function public.catalogue_supplier_terms_page(uuid, integer, text, uuid, text) from public, anon;
revoke all on function public.catalogue_product_supplier_options_page(uuid, integer, text, uuid, text) from public, anon;

grant execute on function public.catalogue_product_page(uuid, integer, text, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.catalogue_product_summary(uuid) to authenticated, service_role;
grant execute on function public.catalogue_service_page(uuid, integer, text, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.catalogue_service_summary(uuid) to authenticated, service_role;
grant execute on function public.catalogue_supplier_terms_page(uuid, integer, text, uuid, text) to authenticated, service_role;
grant execute on function public.catalogue_product_supplier_options_page(uuid, integer, text, uuid, text) to authenticated, service_role;

comment on function public.catalogue_product_page(uuid, integer, text, uuid, text, text, text) is
  'Catalogue V1 Pass 3 bounded Product register read using stable name/id keyset pagination, server-side purpose/status filters and one indexed search expression.';
comment on function public.catalogue_service_page(uuid, integer, text, uuid, text, text, text) is
  'Catalogue V1 Pass 3 bounded Service register read using stable name/id keyset pagination, server-side booking/status filters and one indexed search expression.';
comment on function public.catalogue_supplier_terms_page(uuid, integer, text, uuid, text) is
  'Catalogue V1 Pass 3 Product Supplier register projection; returns only page-level relationship aggregates instead of hydrating the whole relationship register.';
comment on function public.catalogue_product_supplier_options_page(uuid, integer, text, uuid, text) is
  'Catalogue V1 Pass 3 bounded Product Supplier picker read for active Product suppliers.';

commit;
