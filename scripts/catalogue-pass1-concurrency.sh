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

expect_fail() {
  local label="$1"
  local sql="$2"
  local output
  set +e
  output="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "${sql}" 2>&1)"
  local status=$?
  set -e
  if [[ ${status} -eq 0 ]]; then
    echo "${label}: expected failure but command succeeded" >&2
    exit 1
  fi
  echo "${label}: rejected as expected"
}

run_parallel_pair() {
  local sql_a="$1"
  local sql_b="$2"
  local label="$3"
  local a_out="/tmp/catalogue-${label}-a.out"
  local b_out="/tmp/catalogue-${label}-b.out"
  local a_err="/tmp/catalogue-${label}-a.err"
  local b_err="/tmp/catalogue-${label}-b.err"

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
  if [[ ${successes} -ne 1 ]]; then
    echo "${label}: expected exactly one concurrent command to succeed; got ${successes}" >&2
    cat "${a_err}" "${b_err}" >&2 || true
    exit 1
  fi
  echo "${label}: exactly one competing mutation committed"
}

WORKSPACE_A="61000000-0000-4000-8000-000000000001"
OWNER_A="61000000-0000-4000-8000-000000000002"
DENIED_A="61000000-0000-4000-8000-000000000003"
WORKSPACE_B="61000000-0000-4000-8000-000000000011"
OWNER_B="61000000-0000-4000-8000-000000000012"

SUPPLIER_A1="61000000-0000-4000-8000-000000000101"
SUPPLIER_A2="61000000-0000-4000-8000-000000000102"
SUPPLIER_A3="61000000-0000-4000-8000-000000000103"
SUPPLIER_B1="61000000-0000-4000-8000-000000000111"

PRODUCT_CRUD="61000000-0000-4000-8000-000000000201"
PRODUCT_DUP="61000000-0000-4000-8000-000000000202"
PRODUCT_DUP2="61000000-0000-4000-8000-000000000203"
PRODUCT_DUP3="61000000-0000-4000-8000-000000000204"
PRODUCT_IDEM="61000000-0000-4000-8000-000000000205"
PRODUCT_IDEM_OTHER="61000000-0000-4000-8000-000000000206"
PRODUCT_CONC="61000000-0000-4000-8000-000000000207"
PRODUCT_REL="61000000-0000-4000-8000-000000000208"
PRODUCT_REL_OTHER="61000000-0000-4000-8000-000000000209"
PRODUCT_PREF="61000000-0000-4000-8000-00000000020a"
PRODUCT_REL_CONC="61000000-0000-4000-8000-00000000020b"
PRODUCT_B="61000000-0000-4000-8000-000000000211"

SERVICE_CRUD="61000000-0000-4000-8000-000000000301"
SERVICE_DUP="61000000-0000-4000-8000-000000000302"
SERVICE_DUP2="61000000-0000-4000-8000-000000000303"
SERVICE_IDEM="61000000-0000-4000-8000-000000000304"
SERVICE_IDEM_OTHER="61000000-0000-4000-8000-000000000305"
SERVICE_CONC="61000000-0000-4000-8000-000000000306"
SERVICE_B="61000000-0000-4000-8000-000000000311"

REL_CRUD="61000000-0000-4000-8000-000000000401"
REL_DUP_SKU="61000000-0000-4000-8000-000000000402"
REL_IDEM="61000000-0000-4000-8000-000000000403"
REL_IDEM_OTHER="61000000-0000-4000-8000-000000000404"
REL_PREF_A="61000000-0000-4000-8000-000000000405"
REL_PREF_B="61000000-0000-4000-8000-000000000406"
REL_CONC="61000000-0000-4000-8000-000000000407"

psql_exec <<SQL
insert into auth.users(id,email) values
  ('${OWNER_A}'::uuid,'catalogue-pass1-owner-a@bdb.invalid'),
  ('${DENIED_A}'::uuid,'catalogue-pass1-denied-a@bdb.invalid'),
  ('${OWNER_B}'::uuid,'catalogue-pass1-owner-b@bdb.invalid');

update public.profiles set full_name='Catalogue Pass 1 Owner A', is_active=true where id='${OWNER_A}'::uuid;
update public.profiles set full_name='Catalogue Pass 1 Denied A', is_active=true where id='${DENIED_A}'::uuid;
update public.profiles set full_name='Catalogue Pass 1 Owner B', is_active=true where id='${OWNER_B}'::uuid;

insert into public.workspaces(id,slug,name) values
  ('${WORKSPACE_A}'::uuid,'catalogue-pass1-a','Catalogue Pass 1 A'),
  ('${WORKSPACE_B}'::uuid,'catalogue-pass1-b','Catalogue Pass 1 B');

update public.workspaces
set status='active',
    plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id in ('${WORKSPACE_A}'::uuid,'${WORKSPACE_B}'::uuid);

insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at) values
  ('${WORKSPACE_A}'::uuid,'${OWNER_A}'::uuid,'owner','active','owner',now()),
  ('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'employee','active','employee',now()),
  ('${WORKSPACE_B}'::uuid,'${OWNER_B}'::uuid,'owner','active','owner',now());

insert into public.workspace_member_permissions(
  workspace_id,user_id,feature_key,can_view,can_create,can_edit,can_delete,can_approve,can_export
) values
  ('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'products',true,false,false,false,false,false),
  ('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'services',true,false,false,false,false,false),
  ('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'suppliers',true,false,false,false,false,false);

insert into public.suppliers(id,workspace_id,code,name,supplier_type,document_currency,created_by,updated_by) values
  ('${SUPPLIER_A1}'::uuid,'${WORKSPACE_A}'::uuid,'CAT-SUP-A1','Catalogue Supplier A1','product','EUR','${OWNER_A}'::uuid,'${OWNER_A}'::uuid),
  ('${SUPPLIER_A2}'::uuid,'${WORKSPACE_A}'::uuid,'CAT-SUP-A2','Catalogue Supplier A2','product','EUR','${OWNER_A}'::uuid,'${OWNER_A}'::uuid),
  ('${SUPPLIER_A3}'::uuid,'${WORKSPACE_A}'::uuid,'CAT-SUP-A3','Catalogue Supplier A3','product','EUR','${OWNER_A}'::uuid,'${OWNER_A}'::uuid),
  ('${SUPPLIER_B1}'::uuid,'${WORKSPACE_B}'::uuid,'CAT-SUP-B1','Catalogue Supplier B1','product','EUR','${OWNER_B}'::uuid,'${OWNER_B}'::uuid);
SQL

for feature in products services suppliers; do
  ENABLED="$(psql_exec -Atc "select private.has_feature('${WORKSPACE_A}'::uuid,'${feature}');")"
  [[ "${ENABLED}" == "t" ]] || { echo "Catalogue Pass 1 workspace is missing ${feature} feature" >&2; exit 1; }
done

[[ "$(psql_exec -Atc "select private.product_actor_can_write('${WORKSPACE_A}'::uuid,'${OWNER_A}'::uuid,'create');")" == "t" ]]
[[ "$(psql_exec -Atc "select private.service_actor_can_write('${WORKSPACE_A}'::uuid,'${OWNER_A}'::uuid,'create');")" == "t" ]]
[[ "$(psql_exec -Atc "select private.product_supplier_actor_can_write('${WORKSPACE_A}'::uuid,'${OWNER_A}'::uuid,'create');")" == "t" ]]
[[ "$(psql_exec -Atc "select private.product_actor_can_write('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'create');")" == "f" ]]
[[ "$(psql_exec -Atc "select private.service_actor_can_write('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'create');")" == "f" ]]
[[ "$(psql_exec -Atc "select private.product_supplier_actor_can_write('${WORKSPACE_A}'::uuid,'${DENIED_A}'::uuid,'create');")" == "f" ]]

echo "permissions: owner allowed and explicit Catalogue denials enforced"

# Product CRUD, archive/restore and version progression.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CRUD}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-crud-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000001'::uuid,p_sku := 'CAT-P-CRUD',p_name := 'Catalogue Product CRUD',p_barcode := 'CAT-BC-CRUD',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 4,p_selling_price := 8,p_vat_rate := 18,p_reorder_level := 2);" >/dev/null
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CRUD}'::uuid,p_action := 'archive',p_idempotency_key := 'cat-p-crud-archive',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000002'::uuid,p_expected_version := 1);" >/dev/null
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CRUD}'::uuid,p_action := 'restore',p_idempotency_key := 'cat-p-crud-restore',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000003'::uuid,p_expected_version := 2);" >/dev/null
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CRUD}'::uuid,p_action := 'update',p_idempotency_key := 'cat-p-crud-update',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000004'::uuid,p_expected_version := 3,p_sku := 'CAT-P-CRUD',p_name := 'Catalogue Product CRUD Updated',p_barcode := 'CAT-BC-CRUD',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 5,p_selling_price := 9,p_vat_rate := 18,p_reorder_level := 3);" >/dev/null
PRODUCT_STATE="$(psql_exec -Atc "select status || ':' || version || ':' || name from public.products where workspace_id='${WORKSPACE_A}'::uuid and id='${PRODUCT_CRUD}'::uuid;")"
[[ "${PRODUCT_STATE}" == "active:4:Catalogue Product CRUD Updated" ]] || { echo "Product CRUD state was ${PRODUCT_STATE}" >&2; exit 1; }

echo "products: create/update/archive/restore progression passed"

# Product uniqueness and explicit write denial.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_DUP}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-dup-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000005'::uuid,p_sku := 'CAT-DUP',p_name := 'Catalogue Duplicate Product',p_barcode := 'CAT-DUP-BC',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
expect_fail "product duplicate SKU" "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_DUP2}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-dup-sku',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000006'::uuid,p_sku := 'cat-dup',p_name := 'Duplicate SKU Product',p_barcode := 'CAT-OTHER-BC',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);"
expect_fail "product duplicate barcode" "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_DUP3}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-dup-barcode',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000007'::uuid,p_sku := 'CAT-UNIQUE',p_name := 'Duplicate Barcode Product',p_barcode := 'cat-dup-bc',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);"
expect_fail "product explicit permission denial" "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '61000000-0000-4000-8000-0000000002ff'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-denied',p_actor_user_id := '${DENIED_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000008'::uuid,p_sku := 'CAT-DENIED',p_name := 'Denied Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);"

# Product idempotency replay and mismatch rejection.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-000000000009'::uuid,p_sku := 'CAT-IDEM',p_name := 'Catalogue Idempotent Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-00000000000a'::uuid,p_sku := 'CAT-IDEM',p_name := 'Catalogue Idempotent Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
[[ "$(psql_exec -Atc "select count(*) from public.products where workspace_id='${WORKSPACE_A}'::uuid and id='${PRODUCT_IDEM}'::uuid;")" == "1" ]]
[[ "$(psql_exec -Atc "select count(*) from public.product_command_receipts where workspace_id='${WORKSPACE_A}'::uuid and idempotency_key='cat-p-idem';")" == "1" ]]
expect_fail "product idempotency key entity mismatch" "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_IDEM_OTHER}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-00000000000b'::uuid,p_sku := 'CAT-IDEM-OTHER',p_name := 'Other Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);"

# Product optimistic concurrency: two stale writers, exactly one commit.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CONC}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-conc-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-00000000000c'::uuid,p_sku := 'CAT-CONC',p_name := 'Catalogue Concurrent Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
run_parallel_pair \
"select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-p-conc-a',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-00000000000d'::uuid,p_expected_version := 1,p_sku := 'CAT-CONC',p_name := 'Concurrent Product A',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 2,p_vat_rate := 18,p_reorder_level := 0);" \
"select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-p-conc-b',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61100000-0000-4000-8000-00000000000e'::uuid,p_expected_version := 1,p_sku := 'CAT-CONC',p_name := 'Concurrent Product B',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 3,p_vat_rate := 18,p_reorder_level := 0);" \
"product-stale-write"
[[ "$(psql_exec -Atc "select version from public.products where workspace_id='${WORKSPACE_A}'::uuid and id='${PRODUCT_CONC}'::uuid;")" == "2" ]]

# Service CRUD, uniqueness, permission, replay and stale-write protection.
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CRUD}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-crud-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000001'::uuid,p_code := 'CAT-S-CRUD',p_name := 'Catalogue Service CRUD',p_duration_minutes := 60,p_preparation_buffer_minutes := 5,p_recovery_buffer_minutes := 5,p_price := 30,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CRUD}'::uuid,p_action := 'archive',p_idempotency_key := 'cat-s-crud-archive',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000002'::uuid,p_expected_version := 1);" >/dev/null
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CRUD}'::uuid,p_action := 'restore',p_idempotency_key := 'cat-s-crud-restore',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000003'::uuid,p_expected_version := 2);" >/dev/null
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CRUD}'::uuid,p_action := 'update',p_idempotency_key := 'cat-s-crud-update',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000004'::uuid,p_expected_version := 3,p_code := 'CAT-S-CRUD',p_name := 'Catalogue Service CRUD Updated',p_duration_minutes := 75,p_preparation_buffer_minutes := 5,p_recovery_buffer_minutes := 10,p_price := 35,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
SERVICE_STATE="$(psql_exec -Atc "select status || ':' || version || ':' || name from public.services where workspace_id='${WORKSPACE_A}'::uuid and id='${SERVICE_CRUD}'::uuid;")"
[[ "${SERVICE_STATE}" == "active:4:Catalogue Service CRUD Updated" ]] || { echo "Service CRUD state was ${SERVICE_STATE}" >&2; exit 1; }

psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_DUP}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-dup-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000005'::uuid,p_code := 'CAT-S-DUP',p_name := 'Catalogue Duplicate Service',p_duration_minutes := 30,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
expect_fail "service duplicate code" "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_DUP2}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-dup-code',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000006'::uuid,p_code := 'cat-s-dup',p_name := 'Duplicate Service Code',p_duration_minutes := 30,p_vat_rate := 18,p_booking_mode := 'customer');"
expect_fail "service explicit permission denial" "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '61000000-0000-4000-8000-0000000003ff'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-denied',p_actor_user_id := '${DENIED_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000007'::uuid,p_code := 'CAT-S-DENIED',p_name := 'Denied Service',p_duration_minutes := 30,p_vat_rate := 18,p_booking_mode := 'customer');"

psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000008'::uuid,p_code := 'CAT-S-IDEM',p_name := 'Catalogue Idempotent Service',p_duration_minutes := 45,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-000000000009'::uuid,p_code := 'CAT-S-IDEM',p_name := 'Catalogue Idempotent Service',p_duration_minutes := 45,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
expect_fail "service idempotency key entity mismatch" "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_IDEM_OTHER}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-00000000000a'::uuid,p_code := 'CAT-S-IDEM-OTHER',p_name := 'Other Service',p_duration_minutes := 45,p_vat_rate := 18,p_booking_mode := 'customer');"

psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CONC}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-conc-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-00000000000b'::uuid,p_code := 'CAT-S-CONC',p_name := 'Catalogue Concurrent Service',p_duration_minutes := 30,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
run_parallel_pair \
"select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-s-conc-a',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-00000000000c'::uuid,p_expected_version := 1,p_code := 'CAT-S-CONC',p_name := 'Concurrent Service A',p_duration_minutes := 35,p_vat_rate := 18,p_booking_mode := 'customer');" \
"select public.apply_service_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_service_id := '${SERVICE_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-s-conc-b',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61200000-0000-4000-8000-00000000000d'::uuid,p_expected_version := 1,p_code := 'CAT-S-CONC',p_name := 'Concurrent Service B',p_duration_minutes := 40,p_vat_rate := 18,p_booking_mode := 'customer');" \
"service-stale-write"
[[ "$(psql_exec -Atc "select version from public.services where workspace_id='${WORKSPACE_A}'::uuid and id='${SERVICE_CONC}'::uuid;")" == "2" ]]

echo "services: CRUD, duplicate, permission, replay and concurrency passed"

# Create Product/Supplier fixtures and prove relationship semantics.
for spec in \
"${PRODUCT_REL}|CAT-REL|Catalogue Relationship Product|cat-rel-create|61300000-0000-4000-8000-000000000001" \
"${PRODUCT_REL_OTHER}|CAT-REL-OTHER|Catalogue Relationship Other|cat-rel-other-create|61300000-0000-4000-8000-000000000002" \
"${PRODUCT_PREF}|CAT-PREF|Catalogue Preferred Product|cat-pref-create|61300000-0000-4000-8000-000000000003" \
"${PRODUCT_REL_CONC}|CAT-REL-CONC|Catalogue Relationship Concurrent|cat-rel-conc-create|61300000-0000-4000-8000-000000000004"; do
  IFS='|' read -r pid sku pname idem cid <<<"${spec}"
  psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${pid}'::uuid,p_action := 'create',p_idempotency_key := '${idem}',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '${cid}'::uuid,p_sku := '${sku}',p_name := '${pname}',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
done

psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CRUD}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-crud-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000001'::uuid,p_product_id := '${PRODUCT_REL}'::uuid,p_supplier_id := '${SUPPLIER_A1}'::uuid,p_supplier_sku := 'SUP-CAT-001',p_supplier_cost := 3,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 2,p_minimum_order_quantity := 1);" >/dev/null
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CRUD}'::uuid,p_action := 'archive',p_idempotency_key := 'cat-r-crud-archive',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000002'::uuid,p_expected_version := 1);" >/dev/null
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CRUD}'::uuid,p_action := 'restore',p_idempotency_key := 'cat-r-crud-restore',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000003'::uuid,p_expected_version := 2,p_product_id := '${PRODUCT_REL}'::uuid,p_supplier_id := '${SUPPLIER_A1}'::uuid,p_supplier_sku := 'SUP-CAT-001',p_supplier_cost := 3,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 2,p_minimum_order_quantity := 1);" >/dev/null
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CRUD}'::uuid,p_action := 'update',p_idempotency_key := 'cat-r-crud-update',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000004'::uuid,p_expected_version := 3,p_product_id := '${PRODUCT_REL}'::uuid,p_supplier_id := '${SUPPLIER_A1}'::uuid,p_supplier_sku := 'SUP-CAT-001',p_supplier_cost := 4,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 3,p_minimum_order_quantity := 2);" >/dev/null
REL_STATE="$(psql_exec -Atc "select status || ':' || version || ':' || supplier_cost::text || ':' || minimum_order_quantity::text from public.product_suppliers where workspace_id='${WORKSPACE_A}'::uuid and id='${REL_CRUD}'::uuid;")"
[[ "${REL_STATE}" == "active:4:4.0000:2.000" ]] || { echo "Product Supplier CRUD state was ${REL_STATE}" >&2; exit 1; }

expect_fail "duplicate Product Supplier relationship" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '61000000-0000-4000-8000-0000000004f1'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-dup-link',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000005'::uuid,p_product_id := '${PRODUCT_REL}'::uuid,p_supplier_id := '${SUPPLIER_A1}'::uuid,p_supplier_cost := 4,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 3,p_minimum_order_quantity := 2);"
expect_fail "duplicate Supplier SKU across Products" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_DUP_SKU}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-dup-sku',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000006'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A1}'::uuid,p_supplier_sku := 'sup-cat-001',p_supplier_cost := 5,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);"
expect_fail "Product Supplier explicit permission denial" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '61000000-0000-4000-8000-0000000004f2'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-denied',p_actor_user_id := '${DENIED_A}'::uuid,p_command_id := '61400000-0000-4000-8000-000000000007'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_cost := 5,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);"

# Workspace B fixtures prove tenant-owned references cannot be crossed.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_B}'::uuid,p_product_id := '${PRODUCT_B}'::uuid,p_action := 'create',p_idempotency_key := 'cat-p-b-create',p_actor_user_id := '${OWNER_B}'::uuid,p_command_id := '61500000-0000-4000-8000-000000000001'::uuid,p_sku := 'CAT-B-P',p_name := 'Catalogue B Product',p_purpose := 'resale',p_unit_label := 'unit',p_unit_cost := 1,p_vat_rate := 18,p_reorder_level := 0);" >/dev/null
psql_exec -Atc "select public.apply_service_command(p_workspace_id := '${WORKSPACE_B}'::uuid,p_service_id := '${SERVICE_B}'::uuid,p_action := 'create',p_idempotency_key := 'cat-s-b-create',p_actor_user_id := '${OWNER_B}'::uuid,p_command_id := '61500000-0000-4000-8000-000000000002'::uuid,p_code := 'CAT-B-S',p_name := 'Catalogue B Service',p_duration_minutes := 30,p_vat_rate := 18,p_booking_mode := 'customer');" >/dev/null
expect_fail "cross-workspace Product Supplier reference" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '61000000-0000-4000-8000-0000000004f3'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-cross-workspace',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61500000-0000-4000-8000-000000000003'::uuid,p_product_id := '${PRODUCT_B}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_cost := 5,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);"

# Authenticated owner A must not see workspace B Catalogue rows through RLS.
CROSS_VISIBLE="$(docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt <<SQL | tail -n 1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','${OWNER_A}',true);
select (
  (select count(*) from public.products where workspace_id='${WORKSPACE_B}'::uuid)
  + (select count(*) from public.services where workspace_id='${WORKSPACE_B}'::uuid)
  + (select count(*) from public.product_suppliers where workspace_id='${WORKSPACE_B}'::uuid)
);
rollback;
SQL
)"
[[ "${CROSS_VISIBLE}" == "0" ]] || { echo "RLS exposed ${CROSS_VISIBLE} cross-workspace Catalogue rows" >&2; exit 1; }
expect_fail "authenticated direct Product mutation" "set role authenticated; insert into public.products(id,workspace_id,sku,name,purpose,unit_label,unit_cost,vat_rate,reorder_level) values ('61000000-0000-4000-8000-0000000002fe'::uuid,'${WORKSPACE_A}'::uuid,'DIRECT-DENY','Direct Deny','resale','unit',0,0,0);"

echo "tenant isolation: cross-workspace references, reads and direct writes blocked"

# Product Supplier idempotency replay and mismatch.
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000001'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'SUP-CAT-IDEM',p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);" >/dev/null
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_IDEM}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000002'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'SUP-CAT-IDEM',p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);" >/dev/null
expect_fail "Product Supplier idempotency key entity mismatch" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_IDEM_OTHER}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-idem',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000003'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A3}'::uuid,p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);"

# Archived Product cannot receive a newly active Supplier relationship.
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_action := 'archive',p_idempotency_key := 'cat-p-rel-other-archive',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000004'::uuid,p_expected_version := 1);" >/dev/null
expect_fail "archived Product relationship activation" "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '61000000-0000-4000-8000-0000000004f4'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-archived-product',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000005'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_supplier_id := '${SUPPLIER_A3}'::uuid,p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);"
psql_exec -Atc "select public.apply_product_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_product_id := '${PRODUCT_REL_OTHER}'::uuid,p_action := 'restore',p_idempotency_key := 'cat-p-rel-other-restore',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61600000-0000-4000-8000-000000000006'::uuid,p_expected_version := 2);" >/dev/null

# Preferred Supplier race: partial unique index must allow exactly one winner.
run_parallel_pair \
"select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_PREF_A}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-pref-a',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61700000-0000-4000-8000-000000000001'::uuid,p_product_id := '${PRODUCT_PREF}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'PREF-A',p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := true,p_lead_time_days := 1,p_minimum_order_quantity := 1);" \
"select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_PREF_B}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-pref-b',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61700000-0000-4000-8000-000000000002'::uuid,p_product_id := '${PRODUCT_PREF}'::uuid,p_supplier_id := '${SUPPLIER_A3}'::uuid,p_supplier_sku := 'PREF-B',p_supplier_cost := 3,p_currency := 'EUR',p_is_preferred := true,p_lead_time_days := 2,p_minimum_order_quantity := 1);" \
"preferred-supplier"
PREFERRED_COUNT="$(psql_exec -Atc "select count(*) from public.product_suppliers where workspace_id='${WORKSPACE_A}'::uuid and product_id='${PRODUCT_PREF}'::uuid and status='active' and is_preferred;")"
[[ "${PREFERRED_COUNT}" == "1" ]] || { echo "Preferred Supplier count was ${PREFERRED_COUNT}, expected 1" >&2; exit 1; }

# Product Supplier stale writer race.
psql_exec -Atc "select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CONC}'::uuid,p_action := 'create',p_idempotency_key := 'cat-r-conc-create',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61700000-0000-4000-8000-000000000003'::uuid,p_product_id := '${PRODUCT_REL_CONC}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'REL-CONC',p_supplier_cost := 2,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);" >/dev/null
run_parallel_pair \
"select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-r-conc-a',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61700000-0000-4000-8000-000000000004'::uuid,p_expected_version := 1,p_product_id := '${PRODUCT_REL_CONC}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'REL-CONC',p_supplier_cost := 3,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 1,p_minimum_order_quantity := 1);" \
"select public.apply_product_supplier_command(p_workspace_id := '${WORKSPACE_A}'::uuid,p_relationship_id := '${REL_CONC}'::uuid,p_action := 'update',p_idempotency_key := 'cat-r-conc-b',p_actor_user_id := '${OWNER_A}'::uuid,p_command_id := '61700000-0000-4000-8000-000000000005'::uuid,p_expected_version := 1,p_product_id := '${PRODUCT_REL_CONC}'::uuid,p_supplier_id := '${SUPPLIER_A2}'::uuid,p_supplier_sku := 'REL-CONC',p_supplier_cost := 4,p_currency := 'EUR',p_is_preferred := false,p_lead_time_days := 2,p_minimum_order_quantity := 1);" \
"relationship-stale-write"
[[ "$(psql_exec -Atc "select version from public.product_suppliers where workspace_id='${WORKSPACE_A}'::uuid and id='${REL_CONC}'::uuid;")" == "2" ]]

echo "Product Supplier: CRUD, uniqueness, archive guards, replay, preferred race and concurrency passed"

echo "Catalogue Engine V1 Pass 1 correctness torture passed"
