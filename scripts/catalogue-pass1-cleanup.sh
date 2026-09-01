#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Supabase database container was not found" >&2
  exit 1
fi

docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

-- These workspaces are disposable Catalogue test fixtures. Removing a workspace
-- cascades its memberships, including the synthetic final Owner. The production
-- last-Owner guard must remain enabled everywhere else, so bypass only that one
-- trigger for this transaction-scoped fixture teardown and restore it before
-- committing.
alter table public.workspace_memberships
  disable trigger workspace_memberships_protect_last_owner;

delete from public.workspaces
where id in (
  '61000000-0000-4000-8000-000000000001'::uuid,
  '61000000-0000-4000-8000-000000000011'::uuid
);

alter table public.workspace_memberships
  enable trigger workspace_memberships_protect_last_owner;

delete from auth.users
where id in (
  '61000000-0000-4000-8000-000000000002'::uuid,
  '61000000-0000-4000-8000-000000000003'::uuid,
  '61000000-0000-4000-8000-000000000012'::uuid
);

commit;
SQL

echo "Catalogue Pass 1 synthetic fixtures cleaned up"
