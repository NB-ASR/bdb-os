# Inventory Movement Ledger

## Decision

BDB OS Inventory uses the shared `products` catalogue as the canonical stock identity and calculates quantity from an append-only `inventory_movements` ledger.

The previously explored `inventory_items` catalogue is not part of the merged architecture. Creating a second item identity beside Products would split SKU, barcode, category, purpose, cost and lifecycle ownership across two records.

## Business problem

A business needs to know:

- what stock it owns;
- where that stock is held;
- why quantity changed;
- which document, sale, appointment or correction caused the change;
- who posted or reversed the change;
- whether a balance can be rebuilt after an offline conflict or software defect.

A mutable quantity field cannot answer those questions reliably. The ledger can.

## Owning department and connected records

Inventory owns:

- stock locations;
- signed quantity movements;
- current balances derived from movements;
- movement reversals;
- location transfers;
- stock valuation projections based on Product catalogue values.

Products owns:

- Product identity;
- SKU and barcode;
- purpose (`resale` or `supply`);
- unit label;
- catalogue cost;
- selling price;
- reorder level;
- archive lifecycle.

Purchasing owns:

- the original supplier invoice or credit note;
- reviewed document header and lines;
- Supplier and Product matching;
- actual historical quantity, cost, discount, VAT and currency.

Sales will own completed sales and refunds. Appointments will own service consumption. Those departments must issue controlled posting commands rather than inserting arbitrary Inventory movements from browser code.

## Record flow

```text
Product
→ Inventory location
→ immutable signed movement
→ derived balance
```

```text
Approved supplier invoice
→ one purchase-receipt movement per reviewed Product line
→ posted document status
```

```text
Approved supplier credit note
→ one supplier-return movement per reviewed Product line
→ posted document status
```

```text
Incorrect posting
→ opposite reversal movements
→ original rows retained
→ audit reason retained
```

## Invariants

1. Products are the only canonical stock identities.
2. Products do not contain a mutable stock quantity.
3. Posted Inventory movements cannot be updated or deleted.
4. Current quantity is reconstructed by summing signed movements.
5. Every movement belongs to one workspace, Product and location.
6. Transfers create linked outbound and inbound movements in one transaction.
7. A normal movement can be reversed once.
8. Transfer legs cannot be reversed individually.
9. Supplier-document movements can only be reversed through the complete document posting.
10. One supplier-document line can create one original Inventory movement.
11. Repeated commands return the original result through a workspace-scoped idempotency receipt.
12. Negative stock remains visible; the system does not discard legitimate offline work to hide the imbalance.
13. Inventory mutation follows the existing Production membership and per-feature permission model; no Integration support-session dependency is introduced.
14. Authenticated browser clients receive RLS-scoped reads only. Mutations are service-role commands after authenticated workspace validation.

## Movement ownership

### Inventory-owned manual movements

- Opening balance
- Manual adjustment
- Stocktake correction
- Internal business consumption
- Write-off

### Purchasing-owned movements

- Supplier invoice receipt
- Supplier credit-note return
- Complete posting reversal

### Future Sales-owned movements

- Product sale
- Customer return
- Completed-sale correction or reversal

### Future Appointment-owned movements

- Product or supply consumption connected to a completed appointment
- Appointment-consumption reversal

## Offline boundary

Offline-capable:

- cached Products, locations, balances and recent movement history;
- queued location commands;
- queued manual movements;
- queued transfers;
- queued reversal commands;
- stable idempotency keys and sequential replay;
- deliberate discard of failed local commands.

Cloud-dependent:

- posting an approved Purchasing document;
- reversing a complete Purchasing posting;
- current cross-device validation;
- current Production membership, feature and permission checks;
- final shared synchronisation.

Purchasing posting is deliberately not queued. It is a high-impact cross-record operation and must validate the latest approved document, Product matches and location online before posting.

## Alternatives considered

### Mutable quantity on Products

Rejected. It loses causality, cannot reconstruct stock and makes offline conflict resolution unsafe.

### Separate `inventory_items` catalogue

Rejected. It duplicates Product identity and creates long-term drift between departments.

### Automatic posting immediately after AI extraction

Rejected. Extraction is a proposal. A human must review and approve the supplier document before a separate Inventory posting command is available.

### Deleting incorrect movements

Rejected. Corrections use opposite movements so historical balances and audit trails remain explainable.

## Risks

- Negative stock can occur when offline commands arrive out of order or a downstream department posts late. This is visible operational debt, not hidden data loss.
- Product catalogue cost is not a full accounting valuation method. Historical movement cost is retained for later weighted-average or FIFO reporting decisions.
- Large movement histories will eventually require pagination, balance snapshots or indexed reporting views, but the immutable source ledger remains authoritative.
- Existing approved documents created before this migration become `ready`; they are not posted automatically.

## Future implications

- Sales and Appointments must integrate through trusted posting functions, not direct table writes.
- Accounts remains independent: Inventory posting does not create a supplier payable.
- Old Vanita stock quantities must become explicit opening-balance movements during migration.
- Stocktakes should create correction movements against a counted snapshot rather than overwrite balances.
- Low-stock notifications and dashboards must derive from ledger balances and Product reorder levels.

## Version 1 decision

The ledger, locations, manual corrections, transfers, Purchasing posting and reversal are essential Version 1 foundations. Advanced valuation, reservations, lot tracking, serial numbers and multi-stage warehouse fulfilment should wait until the core operating workflow is stable.
