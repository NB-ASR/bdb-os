# Workspace Settings control centre

## Purpose

BDB OS needs one safe workspace administration surface for business configuration, operational preferences, security access, data exports, diagnostics and recovery. The original Vanita application demonstrated useful Settings categories, but its single shared JSON state allowed backup merging and broad data-area resets that are incompatible with a multi-tenant business operating system.

The BDB OS implementation preserves the useful outcomes while retaining authoritative department ownership.

## Ownership

Settings/Core Platform owns:

- Workspace identity and presentation defaults.
- Fiscal-year display defaults.
- Default export format and archive visibility for exports.
- Whether eligible appointment reminder delivery is enabled for the workspace.
- Device notification enrolment.
- Permission-aware workspace data exports.
- Read-only connection diagnostics.
- Portable structured-data snapshot export and replacement recovery.

Settings does not own Customers, Appointments, Products, Services, Suppliers, Sales, Invoices, Payments, Documents, Communications, Banking transactions, Inventory balances or Supplier liabilities. Those departments remain authoritative for their records, validation, correction and audit history.

## Implemented control areas

### Business profile

Workspace name, legal name, owner contact, currency, invoice prefix, VAT default and timezone are saved together through the existing trusted configuration command.

### Appearance

Workspace theme, density, text scale, accessibility settings and private logo Storage remain controlled through trusted commands.

### Operations and security

The operational control centre provides:

- Fiscal-year start month.
- CSV or JSON export preference.
- Default inclusion or exclusion of archived catalogue and Customer records in exports.
- Workspace appointment-reminder enablement.
- Current-device push registration and removal.
- Owner/Manager data exports for Customers, Products, Services, Suppliers and authoritative reporting summaries.
- Links to MFA, password management and business Activity.
- Read-only database and workspace-activity diagnostics.
- Safe removal of local read caches while retaining pending offline commands.

Low-stock and purchasing-review attention remain derived from authoritative department data and cannot be disabled as cosmetic preferences. Security events remain platform-controlled.

### Recovery

Full workspace snapshot export and restore remain in the Backup & restore panel. Recovery is:

- Owner-only.
- Online-only.
- Same-workspace only.
- Checksum verified.
- Replacement recovery, not merge.
- Allowed only when operational records are empty.
- Audited and idempotent.

The operational Settings row is included in the snapshot allowlist and is deleted before replacement, alongside Business Settings and Theme rows.

## Data export boundary

The data-export endpoint uses the signed-in caller's RLS-scoped Supabase client. It does not use the service role for reads.

Exports are limited to:

- Customers.
- Products.
- Services.
- Suppliers.
- Authoritative Business Hub and Reporting read models.

Exports do not contain authentication credentials, memberships, permissions, billing, subscriptions, support sessions, command receipts, audit logs, push subscription secrets or private file bytes.

## Permissions

- Active workspace members may read operational Settings through RLS.
- Owners and Managers may update operational defaults and create scoped data exports.
- Read-only Founder support may inspect Settings but may not mutate or export.
- Snapshot export and restore remain Owner-only.
- Trusted operational mutation is service-role-only and independently checks the actor's workspace administration access.

## Offline behaviour

The most recent trusted core Settings snapshot remains readable offline.

Operational Settings mutation, push enrolment, data export, security changes and recovery require an online authenticated session. Local cache clearing deliberately excludes queue, mutation, pending and conflict keys so unsynchronised business work is not discarded from Settings.

## Deliberately rejected Vanita behaviours

### Merge backup into live data

Rejected. Merging a broad application snapshot into active multi-department records can duplicate Customers, Sales, Payments, Inventory movements and audit history.

### Reset arbitrary data areas

Rejected for ordinary workspace users. Business records have department-specific dependencies, correction rules and immutable ledgers. Financial and Inventory records require reversals. A future Founder-controlled test reset must use a reviewed dependency graph, mandatory fresh backup, exact typed confirmation and integration-only environment guard.

### General repair tools

Rejected from workspace Settings. Data repair, feature flags and maintenance mode are control-plane responsibilities and must not be exposed as ordinary business configuration.

### Configurable session duration

Rejected from workspace Settings. Authentication session policy is a platform security decision.

### Cosmetic notification switches

Rejected. A Settings control must either change an implemented delivery or clearly state that an always-on signal is platform-controlled.

## Version 1 scope

Essential Version 1 capabilities:

- Operational defaults.
- Appointment reminder enablement.
- Device push enrolment.
- CSV and JSON exports.
- Security navigation.
- Read-only diagnostics.
- Verified backup and replacement restore.

Deferred:

- Scheduled report delivery.
- Custom notification-recipient groups.
- External email or messaging alert providers.
- Workspace-visible login history beyond the protected security audit model.
- Automated cloud backup destinations.
- General-purpose data repair.
