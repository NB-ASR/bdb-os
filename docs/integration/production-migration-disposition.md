# Production Migration Disposition

Date: 2026-08-07
Branch: `release/integration-main-reconciliation-v1`
Status: Working audit — do not apply to Production from this document alone

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
| `20260727155000_product_supplier_relationship.sql` | ADAPT | Core relationship is required, but its write guard directly references `public.platform_support_sessions`. Remove that dependency and preserve Products + Suppliers permission requirements. |
| `20260727161000_supplier_document_capture_review.sql` | PENDING | Review after Supplier foundation adaptation; ensure no support-session/test-write dependency and preserve Documents/Purchasing boundaries. |
| `20260727161500_supplier_document_reference_indexes.sql` | PENDING | Depends on Supplier document schema review. |
| `20260727190000_inventory_movement_ledger.sql` | PENDING | Core V1 candidate; review support/security dependencies and existing Production operator/finance schema interactions. |
| `20260727190500_inventory_reference_indexes.sql` | PENDING | Depends on Inventory ledger acceptance. |
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

The `main` proxy authentication, MFA, workspace membership, suspension and entitlement logic otherwise remains unchanged.

Vercel preview build for this slice completed successfully.

## Next review order

1. Adapt Supplier foundation away from Integration support-session references.
2. Adapt Product↔Supplier relationship security the same way.
3. Review Services foundation adaptation.
4. Review Inventory movement ledger against Production-only Operator/finance migrations.
5. Review Sales only after Products/Services/Customers/Inventory dependencies are stable.
6. Continue through Appointments/Accounts/Purchasing/Documents/Communications/Business Hub in dependency order.

## Production hard stop

Do not apply schema migrations to shared Production until:

- the complete required migration order is classified;
- adapted migrations are reviewed;
- Production-only 22 July migration drift is proven compatible;
- client data preflight passes for every constraint/backfill;
- a recoverable Production database backup exists;
- migration rehearsal succeeds away from Production;
- existing-client acceptance is ready to run immediately after the upgrade.
