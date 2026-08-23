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
  'customer-'||g||'@pass4.invalid',
  '+356 77'||lpad(g::text,6,'0'),
  'Pass 4 address '||g,
  case when g%10=0 then 'archived' else 'active' end,
  case when g%5=0 then 'pass4_scale' else null end,
  case when g%5=0 then 'legacy-'||g else null end,
  '${USER_ID}'::uuid,
  '${USER_ID}'::uuid
from generate_series(1,25000) g;

analyze public.customers;

do \$\$
declare
  active_value bigint;
  archived_value bigint;
  imported_value bigint;
  company_value bigint;
  first_count bigint;
  second_count bigint;
  overlap_count bigint;
  search_count bigint;
  cursor_name text;
  cursor_id uuid;
begin
  if (select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid) <> 25000 then
    raise exception 'Customer Pass 4 synthetic register count mismatch';
  end if;

  select active_count, archived_count, imported_count, company_count
    into active_value, archived_value, imported_value, company_value
    from public.customer_register_summary('${WORKSPACE}'::uuid);
  if active_value <> 22500 or archived_value <> 2500 or imported_value <> 5000 or company_value <> 12500 then
    raise exception 'Customer summary mismatch: active %, archived %, imported %, companies %', active_value, archived_value, imported_value, company_value;
  end if;

  if (select count(*) from public.list_customer_register_page('${WORKSPACE}'::uuid,100,null,null,null,'active')) <> 101 then
    raise exception 'Customer active register did not return the bounded 100-row page plus continuation sentinel';
  end if;
  if (select count(*) from public.list_customer_register_page('${WORKSPACE}'::uuid,100,null,null,null,'imported')) <> 101 then
    raise exception 'Customer imported register did not remain bounded';
  end if;

  create temporary table customer_pass4_first on commit drop as
    select * from public.list_customer_register_page('${WORKSPACE}'::uuid,100,null,null,null,'active') limit 100;
  select count(*) into first_count from customer_pass4_first;
  if first_count <> 100 then raise exception 'First Customer keyset page contained % rows', first_count; end if;

  select name,id into cursor_name,cursor_id
  from customer_pass4_first
  order by name desc,id desc
  limit 1;

  create temporary table customer_pass4_second on commit drop as
    select * from public.list_customer_register_page('${WORKSPACE}'::uuid,100,cursor_name,cursor_id,null,'active') limit 100;
  select count(*) into second_count from customer_pass4_second;
  if second_count <> 100 then raise exception 'Second Customer keyset page contained % rows', second_count; end if;

  select count(*) into overlap_count
  from customer_pass4_first first_page
  join customer_pass4_second second_page on second_page.id=first_page.id;
  if overlap_count <> 0 then raise exception 'Customer keyset continuation overlapped % rows', overlap_count; end if;

  select count(*) into search_count
  from public.list_customer_register_page('${WORKSPACE}'::uuid,100,null,null,'needle-pass4','all');
  if search_count <> 1 then raise exception 'Indexed Customer substring search returned % rows, expected 1', search_count; end if;
  if not exists (
    select 1 from public.list_customer_register_page('${WORKSPACE}'::uuid,100,null,null,'needle-pass4','all')
    where name='Needle-Pass4 Customer'
  ) then
    raise exception 'Customer substring search did not return the expected Customer';
  end if;
end
\$\$;
SQL

ACTIVE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and status='active' order by name,id limit 101;")"
ARCHIVED_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and status='archived' order by name,id limit 101;")"
IMPORTED_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and legacy_source is not null order by name,id limit 101;")"
SEARCH_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.customers where workspace_id='${WORKSPACE}'::uuid and search_text like '%needle-pass4%' order by name,id limit 101;")"

# With 90% active Customers, PostgreSQL may correctly prefer the simpler
# workspace/name cursor index and filter status rather than the status-prefixed
# cursor. Both are bounded index scans. The selective archived case must use the
# status-aware index, proving that index remains useful when selectivity warrants it.
if ! grep -Eq 'customers_workspace_(status_)?name_cursor_idx' <<<"${ACTIVE_PLAN}"; then
  echo "Customer Pass 4 active register did not use an indexed cursor plan:" >&2
  echo "${ACTIVE_PLAN}" >&2
  exit 1
fi

for pair in \
  "customers_workspace_status_name_cursor_idx|${ARCHIVED_PLAN}" \
  "customers_workspace_imported_name_cursor_idx|${IMPORTED_PLAN}" \
  "customers_search_text_trgm_idx|${SEARCH_PLAN}"; do
  expected="${pair%%|*}"
  plan="${pair#*|}"
  if ! grep -q "${expected}" <<<"${plan}"; then
    echo "Customer Pass 4 query plan did not use ${expected}:" >&2
    echo "${plan}" >&2
    exit 1
  fi
done

echo "Customer Pass 4 synthetic register: 25,000 Customers; 22,500 active; 2,500 archived; 5,000 imported"
echo "Customer bounded keyset pagination, summary reconciliation and indexed substring search passed"
echo "Customer Pass 4 scale/query-plan torture passed"
