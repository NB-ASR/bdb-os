# Server command contract

## Decision

Every business-changing operation should cross a trusted server-command boundary before it becomes part of BDB OS history. Browser components may collect input and display progress, but they should not be the authority for permissions, final validation, numbering, financial state or audit records.

This phase adds the shared primitives only. It does not migrate Accounts, Banking, Inventory, invoice, payment, reconciliation or stock workflows owned by Matthew.

## Command lifecycle

1. The client sends a state-changing request with a workspace ID and an optional `Idempotency-Key`.
2. The server verifies the authenticated user.
3. The server independently confirms an active membership in an active or trial workspace.
4. The department command validates its own business rules and feature permission.
5. The database mutation completes.
6. The same trusted operation appends a permanent `activity_items` record.
7. The server returns a structured result or structured error.
8. The UI changes to `Saved` only after success.

## Shared primitives

- `src/lib/server/command.ts`
  - JSON validation
  - authentication
  - workspace membership checks
  - command correlation IDs
  - idempotency-key capture
  - consistent no-store responses and errors
- `src/lib/server/activity.ts`
  - immutable business activity writer
  - separate security-audit writer

## Department responsibilities

Each department command must still define:

- Which permission is required.
- Which customer or business record is affected.
- Validation and state-transition rules.
- Whether the change must be a single database transaction.
- Activity wording and entity links.
- Idempotency behaviour.
- Offline conflict behaviour.

## Rules

- Never trust a workspace ID merely because the client sent it.
- Never mark the interface as saved before the server confirms success.
- Never perform a multi-record financial decision through independent browser requests.
- Never let browser clients insert, edit or delete permanent business history.
- Never mix customer-visible activity with security audit records.
- Never add a second command framework inside a department branch.

## Adoption order

1. Customers and customer notes.
2. Appointments.
3. Documents metadata.
4. Matthew's approved invoice/payment model.
5. Banking reconciliation.
6. Inventory movements.

The financial and inventory stages require Matthew's data-model decisions and Niki's architecture review before implementation.
