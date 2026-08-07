# Main Integration Production Reconciliation

Date: 2026-08-07
Status: In progress

## Decision

Upgrade the existing production BDB OS installation by reconciling the completed `integration/vanita-workspace` functionality into a release branch based on `main`.

Production identity, authorization, environment configuration and client data remain authoritative from the existing `main` deployment and shared Supabase project. The Integration Supabase project is not a production migration target.

## Source baselines

- Repository: `NB-ASR/bdb-os`
- Production code baseline: `main` at `fb18545bd6c917c66232caa6a65db5a438d960f8`
- Integration feature baseline: `integration/vanita-workspace` at `c8ca016a44225a78021656aa5797ac039d858a08`
- Reconciliation branch: `release/integration-main-reconciliation-v1`
- Shared production Supabase project: `nicholasbianchini10@gmail.com's Project`
- Shared production Supabase ref: `hgqdyqtdzxzoqqncwhix`

## Non-negotiable boundaries

### Main remains authoritative for security

Preserve the existing production behavior for:

- authentication and login
- sessions and cookies
- MFA / AAL2 admin checks
- `platform_admins` authorization
- account activation and password changes
- workspace membership and tenant isolation
- suspended user/workspace handling
- plan and feature entitlement checks
- production secrets and environment configuration

New Integration routes may be added to the existing protection model, but Integration development-access behavior must not replace or bypass it.

### Shared Supabase remains the production database

Do not repoint Production to the Integration Supabase project. The existing shared project is upgraded in place only after schema review, backup and acceptance testing.

### Existing production data is preserved

No existing user, profile, workspace, membership, customer, invoice, payment, appointment, document or business record may be replaced by Integration test data.

### Integration-only development infrastructure is excluded

Do not promote production behavior that depends on:

- `BDB_DEV_ACCESS_*`
- `/dev-access`
- `/api/dev/session`
- seeded Integration credentials/users
- the Integration Supabase project ref
- development-only admin/login bypasses

## Production data baseline

Read-only baseline captured before any production schema change:

| Record | Count |
| --- | ---: |
| Auth users | 6 |
| Profiles | 6 |
| Workspaces | 4 |
| Workspace memberships | 6 |
| Customers | 1 |
| Invoices | 2 |
| Bookings | 0 |
| Messages | 0 |
| Documents | 0 |
| Bank transactions | 0 |
| Audit logs | 30 |

Additional relevant production state observed:

- `platform_admins`: 3 rows
- `plans`: 4 rows
- `features`: 14 rows
- `plan_features`: 43 rows
- `workspace_feature_overrides`: 41 rows
- `workspace_settings`: 4 rows
- `workspace_themes`: 4 rows
- `sector_packs`: 5 rows
- `operator_policies`: 20 rows

## Migration drift discovered

The live production database contains migrations dated 2026-07-22 that are not present in the Integration branch migration directory:

- `20260722000100_sector_packs`
- `20260722000200_sector_pack_workspace_defaults`
- `20260722000300_operator_execution_foundation`
- `20260722000400_commercial_intake`
- `20260722002645_operator_advisor_remediation`
- `20260722003631_atomic_finance_commands`
- `20260722004107_autonomous_operator_planner`
- `20260722004208_operator_planner_schema_access`
- `20260722010358_operator_policy_reference_guard`
- `20260722010506_operator_policy_reference_index`

These production-only migrations are part of the live production baseline and must be preserved. Integration migrations must be checked for compatibility with the resulting schema rather than treated as if Production were identical to the Integration database.

## Existing-data preflight

The existing Customer and Invoice rows were checked against key constraints introduced by the Integration Customer and Accounts foundations.

Current violations found: zero for:

- Customer code length
- Customer email length
- Customer name length
- duplicate workspace/customer codes
- Invoice due date before issue date
- Invoice number length
- Invoice description length
- negative Invoice amount
- Invoice with missing Customer relationship

This indicates the currently stored Customer and Invoice records are compatible with those checked constraints in principle. It does not replace full migration testing.

## Production security baseline

Supabase security advisors currently report pre-existing warnings for signed-in execution of several `SECURITY DEFINER` functions, including Operator/finance RPCs, plus leaked-password protection being disabled.

These warnings pre-date this reconciliation and are recorded as baseline conditions. They are not to be silently changed during the feature merge. New Integration work must not weaken the existing security posture or introduce new equivalent exposures.

## Migration classification rules

### Normally acceptable after review

- additive tables
- additive nullable columns
- columns with safe defaults for existing rows
- non-destructive indexes

### Requires explicit compatibility/security review

- foreign keys
- unique constraints
- `NOT NULL` transitions
- enum changes
- backfills
- triggers
- RLS policies
- views
- RPC/functions
- privilege/grant changes

### Block unless explicitly justified

- `DROP TABLE`
- destructive `DROP COLUMN`
- `TRUNCATE`
- mass deletion of production business data
- identity/user replacement
- workspace/client replacement
- development/test data seeding into Production

## Current migration notes

- Customer foundation is structured as an in-place extension of the existing `customers` table with defaults and supporting command/import tables.
- The Vanita Customer import migration installs migration tooling; it does not import Integration data automatically. It is optional for the production upgrade unless runtime functionality requires it.
- Accounts Invoice foundation backfills existing Invoice rows before applying stronger constraints. Live preflight currently shows the existing Invoice records satisfy the checked prerequisites.
- Workspace operational settings is additive and seeds default settings for existing Workspaces, but depends on earlier recovery-schema migrations and must remain behind migration-order validation.

## Go / no-go gates

1. Security reconciliation preserves existing production auth behavior.
2. Every required Integration migration is classified and compatible with the production-only schema drift.
3. A recoverable production database backup exists before DDL changes.
4. Existing-client data and login acceptance passes after migration testing.
5. CI, database contracts, security checks and business workflow acceptance pass before merging to `main`.

## Current state

- Reconciliation branch created from the exact `main` baseline.
- `main` has not been modified.
- Production Supabase schema/configuration has not been modified.
- Read-only Production schema/data/security audit has begun.
- Next phase: classify Integration code and migration dependencies against this recorded production baseline.
