# Decision Record: General Documents Ownership and Typed Links

**Date:** 2026-08-01

## Decision

Documents is the authoritative owner of stored files, file metadata and document lifecycle. Cross-department relationships use typed links from one Document to exact Customer, Appointment, Sale, Invoice, Customer Payment or Communication records.

The existing `documents.linked_to` free-text field is retained only for legacy compatibility and must not be used as the integration contract for new records.

## Reason

A shared Document may support several business records. Copying that file into each department would create duplicate storage, conflicting metadata and unclear retention responsibility.

Typed links preserve one file identity while allowing Customers, Calendar, Sales, Accounts and Communications to expose the Document in their own workflows.

## Alternatives considered

### Department-owned document copies

Rejected because files and metadata would diverge and Customer 360 would have to reconcile duplicates.

### Free-text linked-record labels

Rejected because they do not prove record identity, cannot enforce source permissions and cannot support reliable navigation.

### A universal cross-department event table owning every relationship

Rejected for Version 1 because it adds abstraction before the core department contracts are stable. Documents needs only a controlled typed-link boundary.

### Foreign-key columns for every possible department on `documents`

Rejected because it creates a wide, sparse table and makes multi-record relationships awkward.

## Risks

- Polymorphic links cannot use one database foreign key to every source table.
- Link commands must validate source-record existence and workspace ownership explicitly.
- Read APIs must not leak restricted source-record details.
- Offline file queues may exceed browser storage capacity.
- The legacy upload route must be removed carefully when trusted commands replace it.

## Mitigations

- Restrict link types to an explicit Version 1 allow-list.
- Require trusted server commands and stable idempotency keys.
- Preserve source-department permission checks in read APIs.
- Cache metadata separately from file bytes.
- Backfill only relationships proven by existing structured fields.
- Cut over the UI, API and database write grants in one controlled slice.

## Future implications

- Customer 360 and unified history should read active typed links rather than parse labels.
- New departments may add a link type only after defining ownership, permissions and route behaviour.
- AI may suggest a link later, but a human must confirm it.
- Document deletion should remain exceptional; normal lifecycle removal is archive plus retained audit context.
