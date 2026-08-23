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

WORKSPACE="72000000-0000-4000-8000-000000000001"
USER_ID="72000000-0000-4000-8000-000000000002"

psql_exec <<SQL
insert into auth.users(id,email) values ('${USER_ID}'::uuid,'customer-pass4-concurrency@bdb.invalid');
update public.profiles
set full_name='Customer Pass 4 Concurrency Actor', is_active=true
where id='${USER_ID}'::uuid;
insert into public.workspaces(id,slug,name) values ('${WORKSPACE}'::uuid,'customer-pass4-concurrency','Customer Pass 4 Concurrency');
update public.workspaces
set status='active', plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id='${WORKSPACE}'::uuid;
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values ('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'owner','active','owner',now());
SQL

run_pair() {
  local sql_a="$1"
  local sql_b="$2"
  local label="$3"
  local expected_successes="$4"
  local a_out="/tmp/customer-pass4-${label}-a.out"
  local b_out="/tmp/customer-pass4-${label}-b.out"
  local a_err="/tmp/customer-pass4-${label}-a.err"
  local b_err="/tmp/customer-pass4-${label}-b.err"

  set +e
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "${sql_a}" >"${a_out}" 2>"${a_err}" &
  local pid_a=$!
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "${sql_b}" >"${b_out}" 2>"${b_err}" &
  local pid_b=$!
  wait "${pid_a}"; local status_a=$?
  wait "${pid_b}"; local status_b=$?
  set -e

  local successes=0
  [[ ${status_a} -eq 0 ]] && successes=$((successes + 1))
  [[ ${status_b} -eq 0 ]] && successes=$((successes + 1))
  if [[ "${successes}" != "${expected_successes}" ]]; then
    echo "${label}: expected ${expected_successes} successful sessions, got ${successes}" >&2
    cat "${a_err}" "${b_err}" >&2 || true
    exit 1
  fi
  echo "${label}: ${successes}/2 sessions committed as expected"
}

# Two devices replay the exact same create at the same time. Both calls may return
# successfully, but only one Customer, receipt, claim and activity row may exist.
EXACT_A="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000011'::uuid,'create','customer-pass4-exact','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000021'::uuid,null,'P4-EXACT','Pass 4 Exact','','exact@pass4.invalid','+356 9911 0001',null,null,'{}'::jsonb,false,null);"
EXACT_B="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000011'::uuid,'create','customer-pass4-exact','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000022'::uuid,null,'P4-EXACT','Pass 4 Exact','','exact@pass4.invalid','+356 9911 0001',null,null,'{}'::jsonb,false,null);"
run_pair "${EXACT_A}" "${EXACT_B}" "exact-replay" 2

for check in \
  "customers|select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid and id='72000000-0000-4000-8000-000000000011'::uuid|1" \
  "receipts|select count(*) from public.customer_command_receipts where workspace_id='${WORKSPACE}'::uuid and idempotency_key='customer-pass4-exact'|1" \
  "claims|select count(*) from public.customer_command_claims where workspace_id='${WORKSPACE}'::uuid and idempotency_key='customer-pass4-exact'|1" \
  "activity|select count(*) from public.activity_items where workspace_id='${WORKSPACE}'::uuid and entity_type='customer' and entity_id='72000000-0000-4000-8000-000000000011'|1"; do
  label="${check%%|*}"; rest="${check#*|}"; sql="${rest%%|*}"; expected="${rest##*|}"
  actual="$(psql_exec -Atc "${sql}")"
  [[ "${actual}" == "${expected}" ]] || { echo "Exact replay ${label} count was ${actual}, expected ${expected}" >&2; exit 1; }
done

# Same key but different payloads: exactly one request may establish the claim.
COLLIDE_A="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000012'::uuid,'create','customer-pass4-collision','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000023'::uuid,null,'P4-COL-A','Pass 4 Collision A','','collision-a@pass4.invalid',null,null,null,'{}'::jsonb,false,null);"
COLLIDE_B="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000013'::uuid,'create','customer-pass4-collision','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000024'::uuid,null,'P4-COL-B','Pass 4 Collision B','','collision-b@pass4.invalid',null,null,null,'{}'::jsonb,false,null);"
run_pair "${COLLIDE_A}" "${COLLIDE_B}" "key-collision" 1
COLLISION_CUSTOMERS="$(psql_exec -Atc "select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid and id in ('72000000-0000-4000-8000-000000000012'::uuid,'72000000-0000-4000-8000-000000000013'::uuid);")"
[[ "${COLLISION_CUSTOMERS}" == "1" ]] || { echo "Idempotency collision committed ${COLLISION_CUSTOMERS} Customers, expected 1" >&2; exit 1; }
COLLISION_CLAIMS="$(psql_exec -Atc "select count(*) from public.customer_command_claims where workspace_id='${WORKSPACE}'::uuid and idempotency_key='customer-pass4-collision';")"
[[ "${COLLISION_CLAIMS}" == "1" ]] || { echo "Idempotency collision created ${COLLISION_CLAIMS} claims, expected 1" >&2; exit 1; }

# Two distinct offline edits start from the same version. Row locking plus optimistic
# versioning must allow exactly one to commit; the failed command claim rolls back.
psql_exec -Atc "select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000014'::uuid,'create','customer-pass4-stale-base','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000025'::uuid,null,'P4-STALE','Pass 4 Stale Base','',null,null,null,null,'{}'::jsonb,false,null);" >/dev/null
UPDATE_A="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000014'::uuid,'update','customer-pass4-update-a','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000026'::uuid,1,'P4-STALE','Pass 4 Update A','',null,null,null,null,'{}'::jsonb,false,null);"
UPDATE_B="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000014'::uuid,'update','customer-pass4-update-b','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000027'::uuid,1,'P4-STALE','Pass 4 Update B','',null,null,null,null,'{}'::jsonb,false,null);"
run_pair "${UPDATE_A}" "${UPDATE_B}" "stale-version" 1
FINAL_VERSION="$(psql_exec -Atc "select version from public.customers where id='72000000-0000-4000-8000-000000000014'::uuid;")"
[[ "${FINAL_VERSION}" == "2" ]] || { echo "Concurrent Customer version was ${FINAL_VERSION}, expected 2" >&2; exit 1; }
UPDATE_CLAIMS="$(psql_exec -Atc "select count(*) from public.customer_command_claims where workspace_id='${WORKSPACE}'::uuid and idempotency_key in ('customer-pass4-update-a','customer-pass4-update-b');")"
[[ "${UPDATE_CLAIMS}" == "1" ]] || { echo "Failed stale command did not roll back its claim: ${UPDATE_CLAIMS} claims remain" >&2; exit 1; }

# Two staff members/devices try to create the same email under different keys.
# The soft duplicate-review rule must behave atomically under concurrency.
DUP_A="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000015'::uuid,'create','customer-pass4-dup-a','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000028'::uuid,null,'P4-DUP-A','Pass 4 Duplicate A','','same-identity@pass4.invalid',null,null,null,'{}'::jsonb,false,null);"
DUP_B="select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000016'::uuid,'create','customer-pass4-dup-b','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000029'::uuid,null,'P4-DUP-B','Pass 4 Duplicate B','','same-identity@pass4.invalid',null,null,null,'{}'::jsonb,false,null);"
run_pair "${DUP_A}" "${DUP_B}" "duplicate-review" 1
DUP_COUNT="$(psql_exec -Atc "select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid and lower(email::text)='same-identity@pass4.invalid';")"
[[ "${DUP_COUNT}" == "1" ]] || { echo "Concurrent duplicate review allowed ${DUP_COUNT} Customers, expected 1" >&2; exit 1; }

# Explicit human override remains available after review; Pass 4 serializes review
# but does not convert the existing soft duplicate policy into a hard uniqueness rule.
psql_exec -Atc "select public.execute_customer_command('${WORKSPACE}'::uuid,'72000000-0000-4000-8000-000000000017'::uuid,'create','customer-pass4-dup-override','${USER_ID}'::uuid,'72000000-0000-4000-8000-000000000030'::uuid,null,'P4-DUP-OVR','Pass 4 Duplicate Override','','same-identity@pass4.invalid',null,null,null,'{}'::jsonb,true,null);" >/dev/null
DUP_OVERRIDE_COUNT="$(psql_exec -Atc "select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid and lower(email::text)='same-identity@pass4.invalid';")"
[[ "${DUP_OVERRIDE_COUNT}" == "2" ]] || { echo "Explicit duplicate override count was ${DUP_OVERRIDE_COUNT}, expected 2" >&2; exit 1; }

echo "Customer Pass 4 concurrency torture passed"
