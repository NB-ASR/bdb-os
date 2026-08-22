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

WORKSPACE="61000000-0000-4000-8000-000000000001"

INVOICE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.invoice_account_balances where workspace_id='${WORKSPACE}'::uuid order by created_at desc,id desc limit 51;")"
CREDIT_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.credit_notes where workspace_id='${WORKSPACE}'::uuid order by created_at desc,id desc limit 51;")"
DELIVERY_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.delivery_notes where workspace_id='${WORKSPACE}'::uuid order by created_at desc,id desc limit 51;")"
PAYMENT_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.payment_account_balances where workspace_id='${WORKSPACE}'::uuid order by received_at desc,id desc limit 51;")"
CUSTOMER_PLAN="$(psql_exec -Atc "explain (costs off) select customer_id from public.customer_account_balances where workspace_id='${WORKSPACE}'::uuid order by customer_name,customer_id limit 51;")"

for pair in \
  "invoices_workspace_created_cursor_idx|${INVOICE_PLAN}" \
  "credit_notes_workspace_created_cursor_idx|${CREDIT_PLAN}" \
  "delivery_notes_workspace_created_cursor_idx|${DELIVERY_PLAN}" \
  "payments_workspace_received_cursor_idx|${PAYMENT_PLAN}" \
  "customers_workspace_name_idx|${CUSTOMER_PLAN}"; do
  expected="${pair%%|*}"
  plan="${pair#*|}"
  if ! grep -q "${expected}" <<<"${plan}"; then
    echo "Customer-side Accounts query plan did not use ${expected}:" >&2
    echo "${plan}" >&2
    exit 1
  fi
done

echo "Customer-side Accounts register plans use the expected bounded-read indexes"
