# Decision: Workspace configuration and recovery boundary

**Date:** 2026-08-02

## Decision made

BDB OS Settings will use authenticated, trusted workspace commands rather than direct browser writes.

Version 1 backup and restore will use a checksum-protected, same-workspace structured-data snapshot. Restore is owner-only and permitted only when the workspace has no operational records. Storage file bytes, authentication, memberships, permissions, billing and other control-plane records are excluded.

## Reason

Business settings influence invoices, Communications, Reports, timezone interpretation and workspace identity. Direct browser mutation creates inconsistent permission and audit behaviour.

A raw database dump is too broad for an in-product business recovery feature and would include platform-owned security and commercial state. A merge-style restore would be unsafe across immutable Sales, Accounts, Banking, Inventory and Activity histories.

The selected boundary provides a practical Version 1 recovery mechanism while keeping each department authoritative.

## Alternatives considered

### Keep direct browser writes

Rejected. RLS alone does not provide shared idempotency, complete validation, atomic cross-table updates, server-owned Storage cleanup or consistent Activity evidence.

### Export the entire database

Rejected. It would include unrelated workspaces, authentication internals and platform control-plane records. Infrastructure backup remains a Supabase responsibility.

### Embed every private file in JSON

Rejected. It creates very large browser downloads, memory pressure and unreliable uploads. Version 1 exports a verified Storage manifest instead.

### Restore into another workspace

Rejected. IDs, private Storage paths, permissions and commercial context would require a formal migration workflow.

### Merge a snapshot into live records

Rejected. It creates duplicate identities, conflicts with immutable ledgers and makes financial reconciliation ambiguous.

### Allow Managers to restore

Rejected for Version 1. Settings management is operational administration; destructive recovery remains an Owner responsibility.

## Risks

- A structured snapshot is not a substitute for managed database disaster recovery.
- Referenced files cannot be recovered after their Storage objects are deleted.
- Restore requires an empty operational workspace, so clearing or provisioning the target remains a deliberate administrative action.
- Future schema changes require versioned snapshot migrations.
- Large workspaces may eventually exceed the Version 1 browser upload limit.

## Future implications

Future recovery work must preserve:

- explicit schema versions;
- workspace identity isolation;
- checksum or stronger cryptographic integrity;
- department ownership;
- immutable ledger semantics;
- permission and billing exclusions by default;
- a separate, reviewed workflow for cross-workspace migration or partial restore.
