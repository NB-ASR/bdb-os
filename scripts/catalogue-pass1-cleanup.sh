#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Supabase database container was not found" >&2
  exit 1
fi

docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

delete from public.workspaces
where id in (
  '61000000-0000-4000-8000-000000000001'::uuid,
  '61000000-0000-4000-8000-000000000011'::uuid
);

delete from auth.users
where id in (
  '61000000-0000-4000-8000-000000000002'::uuid,
  '61000000-0000-4000-8000-000000000003'::uuid,
  '61000000-0000-4000-8000-000000000012'::uuid
);

commit;
SQL

echo "Catalogue Pass 1 synthetic fixtures cleaned up"
