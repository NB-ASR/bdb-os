# ADR-001: Offline-first data and sync contract

Status: Proposed for founder and engineering review  
Scope: Architecture only; no offline UI or invoice sync is implemented in this phase.

## Business problem

A receptionist, owner or field worker must be able to continue essential daily work during an unstable or unavailable internet connection without losing records, creating duplicates or seeing another company's data.

## Ownership and connections

The platform foundation owns storage, queueing, authentication recovery and conflict rules. Each department owns the business validation for its commands.

The first offline records should connect directly to:

- Customer profiles and notes.
- Appointments.
- Document metadata.
- Draft operational records approved for offline use.

Accounts, payments, banking reconciliation and inventory movements require Matthew's approved data models before an offline adapter is added.

## Decision

Use IndexedDB as the durable local database and the shared server-command contract as the only sync destination.

The browser maintains a workspace-partitioned local read model and an append-only mutation queue. A queued mutation is sent to the same trusted command used online. The server remains authoritative after successful synchronisation.

Do not use `localStorage` for business records or mutation queues. It may hold small non-sensitive preferences only.

## Local stores

One database, versioned through explicit migrations:

- `records`: workspace ID, entity type, entity ID, version, payload, updated time and sync state.
- `mutations`: ordered command envelopes awaiting acknowledgement.
- `conflicts`: unresolved server/local differences requiring a person.
- `sync_metadata`: schema version, last successful sync cursor and workspace state.

Every key begins with the workspace ID. No query may read records without a workspace partition.

## Mutation envelope

Each queued operation contains:

- `idempotencyKey`: UUID generated once and retained across retries.
- `commandType`: stable namespaced command name.
- `workspaceId`.
- `entityType` and optional `entityId`.
- `baseVersion`: version last observed from the server.
- `payload`: minimum validated command input.
- `createdAt` and local sequence.
- `status`: queued, syncing, failed or conflict.
- retry count and last error code.

Never store access tokens, service keys, passwords, payment-card data or provider credentials in the queue.

## Save states

The client experience must distinguish:

1. `Saved locally` — durable in IndexedDB, not yet confirmed by the server.
2. `Syncing` — command is being submitted.
3. `Synced` — server acknowledged the idempotency key and returned the authoritative version.
4. `Failed` — retryable or action required.
5. `Conflict` — local intent cannot safely overwrite newer server data.

Niki's design work owns the final visual treatment. The meanings above are fixed platform semantics and must not be redefined per screen.

## Synchronisation

1. Write the local record and queue entry in one IndexedDB transaction.
2. When online and authenticated, process mutations in local sequence order per workspace.
3. Send the original idempotency key to the server.
4. The server validates membership, permission, feature access and business rules again.
5. On success, replace local data with the authoritative response and mark the mutation acknowledged.
6. On network failure, retain the queue and retry with bounded exponential backoff.
7. On authentication expiry, pause and ask the user to reconnect; never discard work.
8. On permanent validation failure, mark failed and explain the exact action required.

## Conflict policy

- New independent records: normally safe to replay idempotently.
- Updates: compare `baseVersion`; do not silently overwrite newer server data.
- Notes/history: append rather than overwrite.
- Deletion: online-only in the first release, with explicit confirmation.
- Appointments: server rechecks availability; a newly occupied slot becomes a conflict.
- Financial and inventory changes: online-only until their atomic command and reversal models are approved.
- Files: queue metadata first; large binary upload requires a separate resumable design.

## Authentication and device safety

- Offline access is available only after a successful authenticated workspace load on that device.
- The local cache contains business information and must be treated as sensitive.
- Signing out clears local workspace records and pending mutations after warning about unsynced work.
- Suspension discovered during sync locks the cache and prevents new commands.
- Shared/public computers should not retain offline data.

IndexedDB is not application-level encryption. Device encryption, browser profile security and operating-system access controls remain required. Application-level encrypted storage can be evaluated after the first pilot.

## Versioning

Every server-managed mutable record used offline needs:

- `updated_at` generated by the database.
- A monotonic version or equivalent optimistic-concurrency token.
- Stable UUID identity.
- Idempotent command behaviour.

The offline implementation must not begin for a department lacking these properties.

## Version 1 delivery stages

### Stage A — foundation

- IndexedDB schema and migrations.
- Workspace partitioning.
- Queue envelope.
- Sync-status state machine.
- Unit tests for retry, duplicate acknowledgement and workspace separation.

### Stage B — customers and notes

- Read cache.
- Offline create and safe edit.
- Append-only notes/history.

### Stage C — appointments

- Offline draft/create.
- Server availability check on reconnect.
- Human conflict resolution.

### Deferred

- Invoice and payment sync until Matthew's financial model is approved.
- Banking reconciliation.
- Inventory movements.
- Large file content.
- Background sync when the browser is fully closed.

## Rejected alternatives

- `localStorage`: not transactional, unsuitable for structured business data and queues.
- Separate offline logic inside every department: creates inconsistent retries and conflicts.
- Silent last-write-wins: risks losing business work.
- Treating the service worker cache as offline data storage: static response caching does not provide reliable record mutation semantics.

## Acceptance criteria before implementation merges

- Two workspaces cannot read each other's cached keys.
- Browser restart does not lose queued work.
- Repeated delivery of one idempotency key creates one server result.
- Network interruption during sync does not duplicate a record.
- Session expiry pauses without data loss.
- Appointment conflicts require a human decision.
- Sign-out handles unsynced work explicitly.
- Online and offline paths use the same server command and activity history.
