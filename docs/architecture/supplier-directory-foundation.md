# Supplier Directory Foundation

## Decision

BDB OS stores each supplier as one workspace-owned identity with default purchasing terms. Supplier mutations use an idempotent server-side command, optimistic concurrency and archive-based lifecycle control.

The Supplier record contains purchasing identity and defaults only. It does not contain product-specific prices, bank details, payment approvals or settlement state.

## Business problem

Products, supplier documents, Inventory receipts and Accounts payables need to reference the same supplier. Separate copies of supplier details in each department create inconsistent names, terms, contact details and historical reporting.

## Department ownership

- **Operations / Purchasing** owns the Supplier directory.
- **Products** owns reusable product definitions.
- **Product–Supplier relationships** will own supplier SKU, supplier-specific cost, lead time, minimum order quantity and preferred status.
- **Documents / Purchasing** owns original supplier files and review state.
- **Inventory** owns stock receipts, returns and quantity movements.
- **Accounts** owns payables, balances and payment approval.
- **Banking** owns settlement and reconciliation.

## Connected records

```text
Supplier
→ Product–Supplier relationship
→ Supplier document
→ Inventory movement
→ Accounts payable
→ Payment and reconciliation
```

A Supplier does not directly change stock or financial balances.

## Data model

The `suppliers` table is scoped by `workspace_id` and records:

- supplier code;
- trading or legal name;
- supplier type;
- primary contact details;
- VAT or registration reference;
- default payment terms;
- default discount;
- default document currency;
- supplied categories;
- contact or delivery address;
- notes;
- active or archived status;
- optimistic concurrency version;
- creation and update actors and timestamps.

Supplier code uniqueness is enforced per workspace.

## Mutation boundary

Browser roles have RLS-scoped `SELECT` access only. Create, update, archive and restore operations use `/api/suppliers`, which authenticates the workspace membership and calls `apply_supplier_command` with the service role.

Each command requires:

- workspace identity;
- supplier identity;
- actor identity;
- stable idempotency key;
- expected version for non-create operations;
- a unique command ID for Activity history.

Repeated retries with the same idempotency key return the original result. Stale edits are rejected rather than silently overwriting a later change.

## Offline behaviour

After one successful online load, the browser caches the workspace Supplier directory. Offline changes are applied optimistically and stored in a workspace-specific local command queue.

Commands retry in order after reconnection. The same idempotency key is retained for every retry. A failed or conflicting command stops later commands until the user retries or deliberately discards the pending queue.

A cold offline reload can reopen the remembered workspace cache after the first successful online load.

## Founder support

Founder support sessions may read Suppliers through the existing audited support-session policy. Both the interface and the database command permission helper block writes while an active support session exists.

## Alternatives considered

### Store one supplier directly on each Product

Rejected. A Product may be sourced from multiple suppliers, each with different codes, costs and terms.

### Store supplier-specific cost on the Supplier record

Rejected. Costs belong to a Product–Supplier relationship and historical supplier-document lines.

### Store bank details in Suppliers

Rejected for Version 1. Bank details, approvals and settlement require tighter Accounts and Banking controls and should not be exposed as general directory fields.

### Allow direct browser writes under RLS

Rejected. Offline retry, idempotency, concurrency and Activity history require a trusted transactional command boundary.

## Risks

- Local storage provides durable browser retry but is not yet the final IndexedDB sync engine.
- Supplier contacts are currently represented by one primary contact. A separate contacts model may be needed later.
- Default discounts and payment terms must never overwrite values preserved on existing documents.
- Historical supplier records must remain archived rather than deleted.

## Future implications

The next functional slice is the Product–Supplier relationship. It will connect the now-functional Product and Supplier identities without embedding cross-department data in either record.
