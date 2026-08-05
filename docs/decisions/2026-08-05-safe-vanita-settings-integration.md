# Decision Record: Safe Vanita Settings integration

**Date:** 5 August 2026  
**Status:** Accepted for the integration branch

## Decision

Implement the useful administration outcomes demonstrated by the original Vanita Settings page inside the existing BDB OS Settings and recovery architecture, without copying Vanita's single-state backup merge, broad data reset or workspace-level repair controls.

## Reason

The original Vanita project was a single-client test environment with one shared application-state document. BDB OS is a multi-tenant operating system with authoritative department tables, immutable financial and Inventory records, workspace permissions, audited commands and offline queues.

A literal port would introduce unsafe duplicate state and allow one generic Settings action to bypass department validation.

## Implemented equivalent

- Notification settings become real appointment-reminder enablement and per-device push enrolment.
- Data and reporting settings become fiscal-year, export-format and archive-visibility defaults plus authoritative CSV/JSON exports.
- Security becomes direct access to MFA, password management and Activity, while session policy and developer access remain platform-controlled.
- Developer tools become read-only diagnostics and safe local read-cache clearing.
- Full backup and restore continue through the existing checksum-verified, Owner-only, replacement recovery process.

## Alternatives considered

### Copy the Vanita page and mark unsupported controls as planned

Rejected. Controls that appear actionable but do nothing reduce trust and recreate the placeholder problem identified in the product audit.

### Store all Settings and records in a JSON application state

Rejected. This would duplicate authoritative department tables, weaken RLS boundaries and make concurrency, reporting and recovery unsafe.

### Allow backup merge into active records

Rejected. A broad merge cannot safely resolve duplicate identity, immutable ledger, document and financial dependencies.

### Allow Owners to reset individual departments

Rejected. Departments have different deletion and correction semantics. Inventory, Sales, Invoices, Payments, Banking and audit history require reversals or controlled test-environment reset procedures.

## Risks

- Data exports contain business and personal information and must remain permission-scoped and no-store.
- Push delivery still depends on browser permission, VAPID configuration and the production scheduler.
- Fiscal-year configuration is currently a reporting/export default, not a statutory accounting-period engine.
- Clearing browser caches must not remove pending offline work.

## Mitigation

- Use the signed-in RLS client for exports rather than the service role.
- Block exports during read-only Founder support.
- Keep all operational mutations behind an idempotent service-role command that rechecks actor access.
- Preserve queue, mutation, pending and conflict storage keys during cache clearing.
- State the recovery and platform-security boundaries directly in the interface.

## Future implications

Scheduled reports, configurable notification groups and external alert channels require separate provider, cost, consent and delivery-receipt decisions.

Any future controlled data reset must be Founder-owned, integration-only, dependency-aware, preceded by a verified snapshot and covered by a separate decision record and acceptance suite.
