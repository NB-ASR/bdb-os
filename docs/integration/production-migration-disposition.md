# Production Migration Disposition

Date: 2026-08-11
Branch: `release/integration-main-reconciliation-v1`
Status: Local implementation validated; database rehearsal and release approval pending

## Purpose

Classify Integration migrations against the existing shared Production Supabase project (`hgqdyqtdzxzoqqncwhix`) while preserving the `main` security/login model and existing client data.

The Integration Supabase project is a development source of schema/functionality only. It is not the Production migration target.

## Rules

- `INCLUDE`: migration can remain materially as designed, subject to complete dependency/replay testing.
- `ADAPT`: business capability is required, but Integration-specific security/support/preview behavior must be removed or replaced with the existing `main` access model.
- `EXCLUDE`: Integration-only preview, support-session, test-write, data-import or development behavior that is not part of the Production upgrade.
- `NO-OP / OPTIONAL`: safe but not needed for the current Production state.
- `PENDING`: not yet fully reviewed.

No migration in this list is approved for direct Production execution until the full ordered sequence is validated and a recoverable backup exists.

## Initial sequence

| Migration | Disposition | Reason |
| --- | --- | --- |
| `20260726135542_revoke_rls_auto_enable_execute.sql` | NO-OP / OPTIONAL | Production currently has no `public.rls_auto_enable()` function. The migration is conditional and security-positive, but does not currently change Production. |
| `20260727090000_platform_support_sessions.sql` | EXCLUDE | Introduces the Integration platform-support session model. User requirement is to keep `main` login/security unchanged. |
| `20260727090500_support_session_rpc_invoker.sql` | EXCLUDE | Depends on the excluded support-session model. |
| `20260727103000_inventory_visual_module.sql` | EXCLUDE | Preview/Vanita-specific visual-module enablement. Production entitlements must use the real plan matrix. |
| `20260727110000_products_visual_module.sql` | EXCLUDE | Hard-codes a `vanita-integration` workspace override. Not valid Production entitlement logic. |
| `20260727113000_services_visual_module.sql` | EXCLUDE | Preview/Vanita-specific feature enablement. |
| `20260727120500_suppliers_visual_module.sql` | EXCLUDE | Preview/Vanita-specific feature enablement. |
| `20260727122000_sales_visual_module.sql` | EXCLUDE | Preview/Vanita-specific feature enablement. |
| `20260727134000_calendar_department_draft_modules.sql` | PENDING | Needs route/feature/security and V1-scope review before promotion. |
| `20260727141000_purchasing_visual_module.sql` | EXCLUDE | Preview/Vanita-specific feature enablement. |
| `20260727152000_product_catalogue_foundation.sql` | INCLUDE | Additive Product catalogue with active workspace/profile/membership checks, RLS reads, browser direct writes revoked, and service-role-only mutation RPCs. First reconciled feature slice. |
| `20260727152500_product_support_write_guard.sql` | EXCLUDE | Exists specifically to modify Product writes for Integration support sessions. |
| `20260727154000_supplier_directory_foundation.sql` | ADAPT | Supplier capability is required, but `private.supplier_actor_can_write` directly references `public.platform_support_sessions`. Remove that Integration-only dependency while preserving active membership/profile/workspace, feature and member-permission checks. |
| `20260727155000_product_supplier_relationship.sql` | ADAPT | Reconciled locally: removes the support-session dependency, preserves combined Products + Suppliers permissions, revokes browser mutation, adds explicit service-role grants, and supplies the relationship API, offline queue and UI. Not approved for Production execution. |
| `20260727161000_supplier_document_capture_review.sql` | ADAPT | Reconciled locally: removes support-session behavior, reuses the canonical `documents` identity, composes Documents + Purchasing permissions, keeps browser writes revoked, and defers Supplier/Product creation plus Inventory/Accounts posting. Not approved for Production execution. |
| `20260727161500_supplier_document_reference_indexes.sql` | INCLUDE | Additive indexes for the adapted Supplier document schema. Still requires disposable-database replay and the full Production release gate. |
| `20260727190000_inventory_movement_ledger.sql` | ADAPT | Reconciled locally: canonical Product identity, immutable movement ledger, explicit service-role grants, Production membership/permission checks, and combined Purchasing + Documents + Products source access for supplier-document posting. Appointment-specific workflow calls and Integration support-session behavior are excluded. Not approved for Production execution. |
| `20260727190500_inventory_reference_indexes.sql` | INCLUDE | Additive foreign-key and operational indexes for the adapted Inventory ledger. Still requires disposable-database replay and the full Production release gate. |
| `20260728090000_service_catalogue_foundation.sql` | ADAPT | Service capability is required, but `private.service_actor_can_write` directly references `public.platform_support_sessions`. Remove that Integration-only dependency while retaining main-style membership/feature/permission checks. |
| `20260728100000_sales_transaction_foundation.sql` | PENDING | Review after Products, Services, Customers and Inventory dependencies are established. |
| `20260728100500_sales_reference_uniqueness.sql` | PENDING | Depends on Sales foundation compatibility. |
| `20260728160000_purchasing_create_products_from_invoice.sql` | PENDING | Cross-department mutation; requires Purchasing, Products and Inventory authorization review. |
| `20260728170000_founder_test_write_support.sql` | EXCLUDE | Integration founder/support test-write behavior conflicts with the requirement to preserve Production security/login architecture. |

## Production entitlement gap

The Integration preview migrations do not configure the real Production plan matrix.

Production currently has:

- `solo_operator`
- `starter`
- `growth`
- `pro`

New features such as `products`, `services`, `suppliers`, `inventory`, `sales`, and later purchasing-related capabilities require a Production-specific entitlement migration or explicit configuration plan.

Do not copy `vanita-integration` workspace overrides into Production.

The entitlement mapping is a separate release decision from creating the feature tables themselves.

## Product slice already reconciled

The reconciliation branch currently contains:

- `/products` page
- `/api/products`
- Product offline command queue
- Product catalogue migration
- Product database test and contract script
- small backward-compatible shared UI additions
- `/products` added to the existing `main` proxy protected routes and feature map

## Supplier document slice locally reconciled

The local working tree now contains an adapted Documents → Purchasing foundation that:

- stores one canonical `public.documents` record and reuses its workspace-safe ID in `supplier_documents`;
- removes Integration support-session dependencies;
- requires both Documents and Purchasing feature/permission access;
- keeps raw extraction runs and command receipts service-role-only;
- preserves idempotency, optimistic concurrency and human approval;
- does not create Suppliers, Products, Product–Supplier relationships, Inventory movements or Accounts postings;
- registers the Purchasing feature without assigning it to a Production plan or workspace.

This slice has not been pushed or deployed because the reconciliation Preview remains connected to Production Supabase.

The `main` proxy authentication, MFA, workspace membership, suspension and entitlement logic otherwise remains unchanged.

Vercel preview build for this slice completed successfully.

## Preview authentication quarantine

The canonical Vercel project is `bdb-os`. Its existing reconciliation Preview
currently embeds the shared Production Supabase project ref. The release branch
therefore includes a fail-closed application safeguard:

- `VERCEL_ENV=preview` combined with Production ref `hgqdyqtdzxzoqqncwhix`
  returns `503` before login, application pages or API routes can run;
- server-session and service-role clients independently refuse the same unsafe
  environment combination;
- Production deployments using the Production ref remain permitted;
- an isolated Preview Supabase ref remains permitted.

This guard is defence in depth. Vercel Preview variables must still be moved to
an Integration/development Supabase project before Preview acceptance testing.

## Next review order

1. Rehearse the adapted Supplier Documents, Product/Supplier and Inventory migrations on a disposable database branch.
2. Move the reconciliation Preview to isolated Supabase credentials and run authenticated acceptance testing.
3. Review Services and Sales only after the approved dependency foundations are stable.
4. Continue through Appointments/Accounts/Documents/Communications/Business Hub in dependency order.

## Production hard stop

Do not apply schema migrations to shared Production until:

- the complete required migration order is classified;
- adapted migrations are reviewed;
- Production-only 22 July migration drift is proven compatible;
- client data preflight passes for every constraint/backfill;
- a recoverable Production database backup exists;
- migration rehearsal succeeds away from Production;
- existing-client acceptance is ready to run immediately after the upgrade.
