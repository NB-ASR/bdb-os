# Founder development tools

Date: 2026-09-10

## Decision

BDB OS provides destructive development reset tools only inside Founder Admin. Access requires all of the following at the time of every request:

- an authenticated Supabase session at AAL2;
- an active `platform_admins` record with the `founder` role (support access is insufficient);
- an explicit development-workspace designation;
- exact typed workspace and reset-scope confirmation;
- re-authentication with the signed-in Founder's exact email and current password; and
- an idempotency identity for reset retries.

No Founder email addresses are hard-coded. The existing Founder identity register remains authoritative.

Commercially active workspaces cannot be designated for development resets. Designation is an audited, reversible control and is intended only for sanitised mock, acceptance and demonstration workspaces.

## Reset boundary

The supported scopes are Customers, Products, Services, Sales and the entire operational workspace. Individual scopes use a reviewed dependency graph and refuse to run if another module holds linked history. The entire-workspace scope clears only an explicit allowlist of operational tables.

Workspace identity, memberships, permissions, plans and feature entitlements, settings, billing, subscriptions, contracts, audit logs and Founder access are never reset.

Every reset creates a private full-workspace snapshot in the same transaction before deletion. The snapshot is checksum-attributed, downloadable by an active Founder, and retained for 30 days. The reset and its snapshot identifier are recorded in the non-resettable audit log. Reset retries are deterministic and cannot reuse an idempotency key for a different request.

## Security boundary

The browser never receives service credentials and cannot authorize a reset by hiding or revealing controls. Route handlers repeat Founder authorization and re-authentication checks. Database functions repeat active-Founder and development-workspace checks, execute with an empty search path, and are executable only by `service_role`. All development-control tables use RLS and grant no access to `anon` or `authenticated`.

## Consequences

- Founders can safely recycle sanitised test data without deleting a workspace or rebuilding its access configuration.
- A tab reset may be blocked until linked test history is cleared through the entire-workspace reset or normal product workflows.
- Production client data remains outside this workflow. Client erasure and retention remain separate compliance processes.
