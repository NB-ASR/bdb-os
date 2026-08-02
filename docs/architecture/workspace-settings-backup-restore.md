# Workspace Settings, Backup and Restore integration

## Business problem

BDB OS needs one safe place to manage the identity and defaults used across departments, and one controlled way for a business owner to export or recover Version 1 workspace data. The legacy Settings page wrote directly from the browser through the shared store and had no verified recovery boundary.

## Ownership

Settings owns workspace configuration and presentation:

- business display and legal names;
- owner/contact details;
- default currency;
- invoice prefix and default VAT rate;
- workspace timezone;
- visual theme, accessibility preferences and client logo reference.

Settings does not own Customers, Appointments, Sales, Invoices, Payments, Communications, Documents, Purchasing, Banking or Inventory records. Those departments remain authoritative.

Backup and Restore owns recovery orchestration only. It does not create a second operational database, a parallel ledger or a live synchronization layer.

## Version 1 scope

Version 1 provides:

- authenticated Settings reads;
- owner/manager configuration changes through trusted commands;
- server-owned logo upload;
- workspace-scoped offline Settings snapshots;
- owner-only portable structured-data export;
- SHA-256 snapshot integrity verification;
- owner-only same-workspace restore;
- restore only into an operationally empty workspace;
- exact storage-object manifest validation;
- Activity and audit evidence for settings changes, exports and restores;
- idempotent command receipts.

## Infrastructure backup boundary

The portable BDB OS snapshot is an application recovery artifact. It is not a PostgreSQL physical backup and does not replace managed Supabase database backups, point-in-time recovery or platform disaster recovery.

The BDB OS snapshot contains structured Version 1 business records and references to private Storage objects. It does not embed file bytes. A restore succeeds only when every referenced Storage object still exists.

## Snapshot identity boundary

Every snapshot records its originating `workspaceId`. Version 1 restores only to that exact workspace.

This prevents the recovery endpoint from becoming a tenant-cloning mechanism and preserves existing private Storage paths. Cross-workspace migration is a separate future workflow requiring explicit identity remapping, file transfer and permission review.

## Restore boundary

Restore is replacement recovery, not merge.

A restore is accepted only when:

- the caller is the workspace Owner, or guarded integration test-write support;
- the checksum is valid;
- the schema version is supported;
- the snapshot belongs to the current workspace;
- every section is on the allowlist;
- the operational workspace is empty;
- every referenced private Storage object exists;
- the user types the exact workspace confirmation;
- the command has a stable idempotency key.

BDB OS rejects restoration into live operational data. This avoids duplicate Customers, conflicting immutable ledgers, broken foreign keys and silent financial merges.

## Included structured records

The allowlist contains Version 1 operational and configuration records across Customers, Products, Suppliers, Services, Calendar, Communications, Sales, Accounts, Supplier Payables, Banking, Inventory, Documents and workspace appearance/defaults.

Rows are restored in dependency order and their `workspace_id` is forced to the authenticated target workspace.

## Explicit exclusions

Snapshots exclude:

- authentication accounts and credentials;
- workspace memberships and invitations;
- member permissions and feature entitlements;
- contracts, subscriptions and billing identifiers;
- Founder support sessions;
- command and import receipts;
- audit and Activity history;
- device and push subscriptions;
- raw file bytes.

These records are security, commercial or delivery control-plane data and must not be recreated from a business snapshot.

## Permission model

`get_workspace_settings_access` is `SECURITY INVOKER` and returns view, manage and recover capabilities for the signed-in actor.

Trusted mutation and recovery functions are service-role-only:

- `update_workspace_configuration`;
- `set_workspace_logo`;
- `export_workspace_snapshot`;
- `restore_workspace_snapshot`.

Direct authenticated browser mutations are revoked from `workspaces`, `workspace_settings`, `workspace_themes` and the `workspace-assets` Storage bucket. Existing authenticated reads remain RLS-scoped.

Normal Founder support is read-only. Guarded integration test-write support follows the shared testing contract.

## Offline behaviour

After one successful load, Settings caches the last trusted payload per workspace.

While offline:

- the cached business profile and appearance remain readable;
- the interface labels cached state;
- browser-preview settings remain locally editable;
- cloud settings changes, logo upload, export and restore are disabled;
- no cloud success state is fabricated.

Recovery remains online-only because it requires current permissions, workspace emptiness, checksum validation and Storage verification.

## File and logo behaviour

Logo bytes are uploaded by the server after access validation. The database then records the exact workspace-owned path through an idempotent trusted command. If the database command fails, the new object is removed. After success, the previous logo object is removed where safe.

Document and Supplier document file bytes are not copied into the JSON snapshot. Their private bucket and path references form a manifest checked before restore.

## Visual behaviour

The Settings workspace preserves the BDB OS identity:

- dark charcoal surfaces;
- dark-gold active tabs and recovery boundaries;
- minimal operational copy;
- clear separation between identity, appearance, people, billing and recovery;
- prominent restore lock conditions;
- no generic infrastructure-console presentation.

## Deferred

- scheduled automatic application snapshots;
- encrypted off-platform snapshot storage;
- cross-workspace migration;
- restore into non-empty workspaces;
- partial-table restore;
- file-byte export archives;
- PostgreSQL physical backup controls;
- point-in-time recovery controls;
- billing or permission restoration;
- automated disaster-recovery orchestration.
