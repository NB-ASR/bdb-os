#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Supabase database container was not found" >&2
  exit 1
fi

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

WORKSPACE="76000000-0000-4000-8000-000000000001"
USER_ID="76000000-0000-4000-8000-000000000002"

psql_exec <<SQL
\timing on
insert into auth.users(id,email) values ('${USER_ID}'::uuid,'catalogue-pass3-scale@bdb.invalid');
update public.profiles
set full_name='Catalogue Pass 3 Scale Actor', is_active=true
where id='${USER_ID}'::uuid;
insert into public.workspaces(id,slug,name) values ('${WORKSPACE}'::uuid,'catalogue-pass3-scale','Catalogue Pass 3 Scale');
update public.workspaces
set status='active', plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id='${WORKSPACE}'::uuid;
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values ('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'owner','active','owner',now());

-- Read-scale volume is inserted directly. Mutation correctness, permission denial,
-- concurrency and idempotency remain covered by Catalogue Pass 1.
insert into public.products(
  id,workspace_id,sku,name,barcode,purpose,unit_label,unit_cost,selling_price,vat_rate,
  reorder_level,status,created_by,updated_by
)
select
  md5('catalogue-pass3-product-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  'P3P-'||lpad(g::text,6,'0'),
  case when g=12345 then 'Needle-Pass3 Product' else 'Pass 3 Product '||lpad(g::text,6,'0') end,
  case when g=23456 then 'P3-BARCODE-NEEDLE' else null end,
  case when g%2=0 then 'resale' else 'supply' end,
  'unit',
  (g%500)::numeric / 10,
  (g%900)::numeric / 10,
  18,
  g%25,
  case when g%10=0 then 'archived' else 'active' end,
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g;

insert into public.services(
  id,workspace_id,code,name,category,duration_minutes,preparation_buffer_minutes,
  recovery_buffer_minutes,price,vat_rate,booking_mode,status,created_by,updated_by
)
select
  md5('catalogue-pass3-service-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  'P3S-'||lpad(g::text,6,'0'),
  case when g=12345 then 'Needle-Pass3 Service' else 'Pass 3 Service '||lpad(g::text,6,'0') end,
  case when g%3=0 then 'Consultation' else 'General' end,
  30 + (g%12)*5,
  g%15,
  g%10,
  (g%700)::numeric / 10,
  18,
  case when g%2=1 then 'customer' else 'staff' end,
  case when g%10=0 then 'archived' else 'active' end,
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g;

insert into public.suppliers(
  id,workspace_id,code,name,supplier_type,document_currency,status,created_by,updated_by
)
select
  md5('catalogue-pass3-supplier-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  'P3SUP-'||lpad(g::text,6,'0'),
  case when g=2345 then 'Needle-Pass3 Supplier' else 'Pass 3 Supplier '||lpad(g::text,6,'0') end,
  'product',
  'EUR',
  'active',
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,5000) g;

-- Two active Supplier relationships per active Product exercises Supplier Terms
-- aggregation without creating a denormalised Catalogue copy.
insert into public.product_suppliers(
  id,workspace_id,product_id,supplier_id,supplier_cost,currency,is_preferred,
  lead_time_days,minimum_order_quantity,status,created_by,updated_by
)
select
  md5('catalogue-pass3-relationship-a-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  md5('catalogue-pass3-product-'||g)::uuid,
  md5('catalogue-pass3-supplier-'||(((g-1)%5000)+1))::uuid,
  (g%400)::numeric / 10,
  'EUR',
  true,
  g%30,
  1,
  'active',
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g
where g%10<>0;

insert into public.product_suppliers(
  id,workspace_id,product_id,supplier_id,supplier_cost,currency,is_preferred,
  lead_time_days,minimum_order_quantity,status,created_by,updated_by
)
select
  md5('catalogue-pass3-relationship-b-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  md5('catalogue-pass3-product-'||g)::uuid,
  md5('catalogue-pass3-supplier-'||((g%5000)+1))::uuid,
  (g%450)::numeric / 10,
  'EUR',
  false,
  (g+3)%30,
  2,
  'active',
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g
where g%10<>0;

analyze public.products;
analyze public.services;
analyze public.suppliers;
analyze public.product_suppliers;

do \$\$
declare
  active_value bigint;
  archived_value bigint;
  resale_value bigint;
  supply_value bigint;
  customer_value bigint;
  staff_value bigint;
  first_count bigint;
  second_count bigint;
  overlap_count bigint;
  search_count bigint;
  cursor_name text;
  cursor_id uuid;
  supplier_count bigint;
begin
  if (select count(*) from public.products where workspace_id='${WORKSPACE}'::uuid) <> 25000 then
    raise exception 'Catalogue Pass 3 Product synthetic register count mismatch';
  end if;
  if (select count(*) from public.services where workspace_id='${WORKSPACE}'::uuid) <> 25000 then
    raise exception 'Catalogue Pass 3 Service synthetic register count mismatch';
  end if;
  if (select count(*) from public.product_suppliers where workspace_id='${WORKSPACE}'::uuid) <> 45000 then
    raise exception 'Catalogue Pass 3 Product Supplier synthetic relationship count mismatch';
  end if;

  select active_count, archived_count, resale_count, supply_count
  into active_value, archived_value, resale_value, supply_value
  from public.catalogue_product_summary('${WORKSPACE}'::uuid);
  if active_value <> 22500 or archived_value <> 2500 or resale_value <> 10000 or supply_value <> 12500 then
    raise exception 'Product summary mismatch: active %, archived %, resale %, supply %', active_value, archived_value, resale_value, supply_value;
  end if;

  select active_count, archived_count, customer_bookable_count, staff_only_count
  into active_value, archived_value, customer_value, staff_value
  from public.catalogue_service_summary('${WORKSPACE}'::uuid);
  if active_value <> 22500 or archived_value <> 2500 or customer_value <> 12500 or staff_value <> 10000 then
    raise exception 'Service summary mismatch: active %, archived %, customer %, staff %', active_value, archived_value, customer_value, staff_value;
  end if;

  if (select count(*) from public.catalogue_product_page('${WORKSPACE}'::uuid,101,null,null,null,'active')) <> 101 then
    raise exception 'Product active register was not bounded to the continuation page';
  end if;
  if (select count(*) from public.catalogue_service_page('${WORKSPACE}'::uuid,101,null,null,null,'active')) <> 101 then
    raise exception 'Service active register was not bounded to the continuation page';
  end if;
  if (select count(*) from public.catalogue_supplier_terms_page('${WORKSPACE}'::uuid,101,null,null,null)) <> 101 then
    raise exception 'Supplier Terms register was not bounded to the continuation page';
  end if;
  if (select count(*) from public.catalogue_product_supplier_options_page('${WORKSPACE}'::uuid,101,null,null,null)) <> 101 then
    raise exception 'Product Supplier options were not bounded to the continuation page';
  end if;

  create temporary table catalogue_pass3_first on commit drop as
    select * from public.catalogue_product_page('${WORKSPACE}'::uuid,100,null,null,null,'active') limit 100;
  select count(*) into first_count from catalogue_pass3_first;
  select name,id into cursor_name,cursor_id
  from catalogue_pass3_first order by name desc,id desc limit 1;
  create temporary table catalogue_pass3_second on commit drop as
    select * from public.catalogue_product_page('${WORKSPACE}'::uuid,100,cursor_name,cursor_id,null,'active') limit 100;
  select count(*) into second_count from catalogue_pass3_second;
  select count(*) into overlap_count
  from catalogue_pass3_first first_page
  join catalogue_pass3_second second_page on second_page.id=first_page.id;
  if first_count <> 100 or second_count <> 100 or overlap_count <> 0 then
    raise exception 'Product keyset continuation failed: first %, second %, overlap %', first_count, second_count, overlap_count;
  end if;

  select count(*) into search_count
  from public.catalogue_product_page('${WORKSPACE}'::uuid,100,null,null,'needle-pass3',null);
  if search_count <> 1 then raise exception 'Product indexed search returned % rows, expected 1', search_count; end if;
  select count(*) into search_count
  from public.catalogue_service_page('${WORKSPACE}'::uuid,100,null,null,'needle-pass3',null);
  if search_count <> 1 then raise exception 'Service indexed search returned % rows, expected 1', search_count; end if;
  select count(*) into search_count
  from public.catalogue_product_supplier_options_page('${WORKSPACE}'::uuid,100,null,null,'needle-pass3');
  if search_count <> 1 then raise exception 'Supplier option indexed search returned % rows, expected 1', search_count; end if;

  select active_supplier_count into supplier_count
  from public.catalogue_supplier_terms_page('${WORKSPACE}'::uuid,100,null,null,'Needle-Pass3 Product')
  where name='Needle-Pass3 Product';
  if supplier_count <> 2 then
    raise exception 'Supplier Terms aggregate returned % active Suppliers, expected 2', supplier_count;
  end if;
end
\$\$;
SQL

PRODUCT_ACTIVE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.products where workspace_id='${WORKSPACE}'::uuid and status='archived' order by name,id limit 101;")"
PRODUCT_SEARCH_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.products where workspace_id='${WORKSPACE}'::uuid and lower(name || ' ' || sku::text || ' ' || coalesce(barcode::text,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'') || ' ' || purpose) like '%needle-pass3%' order by name,id limit 101;")"
SERVICE_ACTIVE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.services where workspace_id='${WORKSPACE}'::uuid and status='archived' order by name,id limit 101;")"
SERVICE_SEARCH_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.services where workspace_id='${WORKSPACE}'::uuid and lower(name || ' ' || code::text || ' ' || coalesce(category,'') || ' ' || coalesce(description,'') || ' ' || booking_mode) like '%needle-pass3%' order by name,id limit 101;")"
SUPPLIER_OPTIONS_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.suppliers where workspace_id='${WORKSPACE}'::uuid and supplier_type='product' and status='active' order by name,id limit 101;")"
SUPPLIER_SEARCH_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.suppliers where workspace_id='${WORKSPACE}'::uuid and supplier_type='product' and status='active' and lower(name || ' ' || code::text) like '%needle-pass3%' order by name,id limit 101;")"
RELATIONSHIP_PLAN="$(psql_exec -Atc "explain (costs off) select count(*) from public.product_suppliers where workspace_id='${WORKSPACE}'::uuid and product_id=md5('catalogue-pass3-product-12345')::uuid and status='active';")"

for pair in \
  "products_workspace_status_name_cursor_idx|${PRODUCT_ACTIVE_PLAN}" \
  "products_catalogue_search_trgm_idx|${PRODUCT_SEARCH_PLAN}" \
  "services_workspace_status_name_cursor_idx|${SERVICE_ACTIVE_PLAN}" \
  "services_catalogue_search_trgm_idx|${SERVICE_SEARCH_PLAN}" \
  "suppliers_workspace_product_status_name_cursor_idx|${SUPPLIER_OPTIONS_PLAN}" \
  "suppliers_catalogue_search_trgm_idx|${SUPPLIER_SEARCH_PLAN}" \
  "product_suppliers_product_status_idx|${RELATIONSHIP_PLAN}"; do
  expected="${pair%%|*}"
  plan="${pair#*|}"
  if ! grep -q "${expected}" <<<"${plan}"; then
    echo "Catalogue Pass 3 query plan did not use ${expected}:" >&2
    echo "${plan}" >&2
    exit 1
  fi
done

echo "Catalogue Pass 3 synthetic scale: 25,000 Products; 25,000 Services; 5,000 Suppliers; 45,000 Product-Supplier relationships"
echo "Catalogue bounded keyset pagination, summaries, indexed search and Supplier Terms aggregation passed"
echo "Catalogue Pass 3 scale/query-plan torture passed"
