# Product–Supplier Relationship

## Decision

Products and Suppliers remain independent workspace-owned records. Supplier-specific purchasing terms are stored in `product_suppliers`, a normalized many-to-many relationship.

The relationship is managed inside the Products workflow:

```text
Products
├─ Catalogue
└─ Supplier terms
```

It is not registered as a separate workspace feature or sidebar department.

## Business reason

A Product may be purchased from several Suppliers, and one Supplier may provide many Products. Embedding one Supplier directly in the Product would duplicate data and prevent alternative sourcing.

The relationship stores only supplier-specific catalogue terms:

- Supplier SKU
- Supplier-specific cost
- Currency
- Preferred status
- Lead time
- Minimum order quantity
- Notes
- Archive lifecycle

## Boundaries

### Products owns

- Product identity
- SKU and barcode
- Brand and category
- Unit
- Catalogue selling price
- VAT
- Reorder threshold

### Suppliers owns

- Supplier identity
- Primary contact
- Default payment terms
- Default document currency
- Default discount
- Address and registration details

### Product–Supplier owns

- Supplier-specific product code
- Supplier-specific planning cost
- Preferred Supplier status
- Lead time
- Minimum order quantity

### Purchasing owns

- Actual invoice or credit-note line cost
- Actual document currency
- Actual discounts and tax
- Approval and posting state

### Inventory owns

- Stock receipts and reversals
- Quantity and cost movements
- Stock history and valuation

### Accounts and Banking own

- Payables and balances
- Payment approval
- Settlement
- Reconciliation
- Bank details

## Reliability rules

- Every record has `workspace_id`.
- Product and Supplier foreign keys include `workspace_id`.
- One Product–Supplier pair may exist once per workspace.
- One active preferred Supplier is allowed per Product.
- A Supplier SKU may identify one Product per Supplier.
- Product and Supplier identities are immutable after relationship creation.
- Relationships are archived rather than deleted.
- Active relationships require an active Product and active Supplier classified as `product`.
- Stale updates are rejected using a version number.
- Every command uses a stable workspace-scoped idempotency key.
- Successful commands create Activity records transactionally.
- Founder support sessions are denied at the database layer.

## Offline behaviour

Relationship reads are cached locally after a successful online load. Create, update, archive and restore commands may be queued offline. Commands retain their idempotency key and are replayed in order. Conflicts stop the queue and require deliberate user action.

## Alternatives considered

### Supplier field on Product

Rejected because it permits only one Supplier and embeds purchasing data inside the catalogue definition.

### Product arrays on Supplier

Rejected because arrays cannot carry normalized cost, lead-time, preferred-status and concurrency data safely.

### Separate Supplier Terms department

Rejected because the relationship is a supporting Product workflow, not an independent business department.

## Risks

- Catalogue planning cost may differ from an actual purchasing document line. The UI must keep this distinction explicit.
- A strict single preferred Supplier constraint requires users to remove an existing preference before assigning another.
- Offline relationship changes may conflict with other users. Version checks prevent silent overwrite but require reconciliation.

## Future implications

Purchasing document review can use this relationship to suggest Product matches, Supplier SKUs and expected costs. Inventory receipts and Accounts payables must continue referencing the approved Purchasing document rather than writing directly from the relationship.
