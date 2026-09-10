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

WORKSPACE="73000000-0000-4000-8000-000000000001"
USER_ID="73000000-0000-4000-8000-000000000002"

psql_exec <<SQL
\timing on
insert into auth.users(id,email) values ('${USER_ID}'::uuid,'customer-pass4-scale@bdb.invalid');
update public.profiles
set full_name='Customer Pass 4 Scale Actor', is_active=true
where id='${USER_ID}'::uuid;
insert into public.workspaces(id,slug,name) values ('${WORKSPACE}'::uuid,'customer-pass4-scale','Customer Pass 4 Scale');
update public.workspaces
set status='active', plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id='${WORKSPACE}'::uuid;
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values ('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'owner','active','owner',now());

-- Direct inserts create read-scale volume only. Customer mutation correctness is
-- exercised through the hardened public commands in pgTAP and concurrency torture.
insert into public.customers(
  id,workspace_id,code,name,company,email,phone,address,status,
  legacy_source,legacy_id,created_by,updated_by
)
select
  md5('customer-pass4-scale-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  'P4C-'||lpad(g::text,6,'0'),
  case when g=12345 then 'Needle-Pass4 Customer' else 'Pass 4 Customer '||lpad(g::text,6,'0') end,
  case when g%2=0 then 'Company '||lpad(g::text,6,'0') else '' end,
  case when g%401=0 then null else 'customer-'||g||'@pass4.invalid' end,
  case when g%401=0 then null else '+356 77'||lpad(g::text,6,'0') end,
  'Pass 4 address '||g,
  case when g%10=0 then 'archived' else 'active' end,
  case when g%5=0 then 'pass4_scale' else null end,
  case when g%5=0 then 'legacy-'||g else null end,
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g;

insert into public.customer_import_review_items(
  id,workspace_id,import_key,source_file,source_row,payload,
  issue_code,issue_message,status,created_by
)
select
  md5('customer-pass4-review-'||g)::uuid,
  '${WORKSPACE}'::uuid,
  'pass4-review-'||g,
  'customer-pass4-scale.csv',
  g + 1,
  jsonb_build_object(
    'name', case when g=205 then 'Review-Needle Customer' else 'Review Customer '||lpad(g::text,4,'0') end,
    'email', 'review-'||g||'@pass4.invalid'
  ),
  'IMPORT_REVIEW',
  'Synthetic review item '||g,
  'pending',
  '${USER_ID}'::uuid
from generate_series(1,410) g;

analyze public.customers;
analyze public.customer_import_review_items;

select set_config('request.jwt.claim.sub', '${USER_ID}', false);
set role authenticated;

do \$\$
declare
  result jsonb;
  total_value bigint;
  page_value integer;
  page_count integer;
  row_kind text;
begin
  select public.read_customer_register_page('${WORKSPACE}'::uuid,1,50,null,'active',true) into result;
  total_value := (result #>> '{page,totalFiltered}')::bigint;
  page_count := jsonb_array_length(result->'items');
  if total_value <> 22500 or page_count <> 50 then
    raise exception 'Customer active direct page mismatch: total %, rows %', total_value, page_count;
  end if;
  if (result #>> '{summary,activeCount}')::bigint <> 22500
     or (result #>> '{summary,archivedCount}')::bigint <> 2500
     or (result #>> '{summary,importedCount}')::bigint <> 5000
     or (result #>> '{summary,companyCount}')::bigint <> 12500
     or (result #>> '{summary,reviewCount}')::bigint <> 410 then
    raise exception 'Customer composed register summary mismatch: %', result->'summary';
  end if;

  select public.read_customer_register_page('${WORKSPACE}'::uuid,450,50,null,'active',false) into result;
  if (result #>> '{page,number}')::integer <> 450
     or jsonb_array_length(result->'items') <> 50
     or (result #>> '{page,totalPages}')::integer <> 450 then
    raise exception 'Customer deepest active page mismatch: %', result->'page';
  end if;

  -- A request beyond the last page must clamp after concurrent shrinkage rather
  -- than returning a phantom empty page number.
  select public.read_customer_register_page('${WORKSPACE}'::uuid,9999,50,null,'active',false) into result;
  page_value := (result #>> '{page,number}')::integer;
  if page_value <> 450 or jsonb_array_length(result->'items') <> 50 then
    raise exception 'Customer page clamp mismatch: page %, rows %', page_value, jsonb_array_length(result->'items');
  end if;

  -- Persisted Customers with generated needs_review remain Customers. Review is
  -- reserved exclusively for unresolved import exceptions.
  if not exists (
    select 1 from public.customers
    where workspace_id='${WORKSPACE}'::uuid and needs_review
  ) then
    raise exception 'Synthetic fixture must contain persisted Customers with incomplete details';
  end if;
  select public.read_customer_register_page('${WORKSPACE}'::uuid,1,50,null,'review',false) into result;
  if (result #>> '{page,totalFiltered}')::bigint <> 410 then
    raise exception 'Import Review total included non-review Customer rows: %', result #>> '{page,totalFiltered}';
  end if;
  select value->>'rowKind' into row_kind
  from jsonb_array_elements(result->'items') value
  limit 1;
  if row_kind <> 'import_review' then
    raise exception 'Review page returned unexpected row kind %', row_kind;
  end if;

  select public.read_customer_register_page('${WORKSPACE}'::uuid,9,50,null,'review',false) into result;
  if jsonb_array_length(result->'items') <> 10 or (result #>> '{page,totalPages}')::integer <> 9 then
    raise exception 'Review last page mismatch: %', result->'page';
  end if;

  select public.read_customer_register_page('${WORKSPACE}'::uuid,1,50,'review-needle','review',false) into result;
  if (result #>> '{page,totalFiltered}')::bigint <> 1
     or result #>> '{items,0,rowKind}' <> 'import_review' then
    raise exception 'Review filtered search mismatch: %', result;
  end if;

  select public.read_customer_register_page('${WORKSPACE}'::uuid,1,50,'needle-pass4','all',false) into result;
  if (result #>> '{page,totalFiltered}')::bigint <> 1
     or result #>> '{items,0,rowKind}' <> 'customer' then
    raise exception 'Customer All filtered search mismatch: %', result;
  end if;

  select public.read_customer_register_page('${WORKSPACE}'::uuid,509,50,null,'all',false) into result;
  if (result #>> '{page,totalFiltered}')::bigint <> 25410
     or (result #>> '{page,totalPages}')::integer <> 509
     or jsonb_array_length(result->'items') <> 10 then
    raise exception 'Mixed All last page mismatch: %', result->'page';
  end if;
end
\$\$;

reset role;
SQL

ACTIVE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and status='active' order by name,id limit 50 offset 22450;")"
ARCHIVED_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and status='archived' order by name,id limit 50 offset 2450;")"
SEARCH_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and search_text like '%needle-pass4%' order by name,id limit 50;")"

# Direct page navigation uses OFFSET only after workspace/status/search constraints.
# The 25k fixture proves the deepest V1 pages continue to traverse indexed paths.
if ! grep -Eq 'customers_workspace_(status_)?name_cursor_idx' <<<"${ACTIVE_PLAN}"; then
  echo "Customer deepest active page did not use an indexed workspace/name path:" >&2
  echo "${ACTIVE_PLAN}" >&2
  exit 1
fi
if ! grep -q 'customers_workspace_status_name_cursor_idx' <<<"${ARCHIVED_PLAN}"; then
  echo "Customer deepest archived page did not use the status/name index:" >&2
  echo "${ARCHIVED_PLAN}" >&2
  exit 1
fi
if ! grep -q 'customers_search_text_trgm_idx' <<<"${SEARCH_PLAN}"; then
  echo "Customer substring search did not use the trigram index:" >&2
  echo "${SEARCH_PLAN}" >&2
  exit 1
fi

echo "Customer register torture: 25,000 Customers + 410 unresolved import reviews"
echo "Direct first/deep/last pages, page clamping, Review semantics, All composition and filtered search passed"
echo "Customer register indexed page/query-plan torture passed"
