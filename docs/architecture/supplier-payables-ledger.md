# Supplier Payables, Supplier Payments and Supplier Balances

## Decision

BDB OS uses an explicit immutable Accounts Payable posting ledger linked to approved Supplier documents.

- **Purchasing** owns the reviewed Supplier invoice or credit note.
- **Accounts Payable** owns the posted payable or Supplier credit snapshot.
- **Supplier Payments** record immutable outgoing money.
- **Supplier Payment allocations** connect Payments to Supplier invoices through append-only deltas.
- **Supplier credit allocations** connect posted Supplier credit notes to Supplier invoices through append-only deltas.
- **Supplier balances** are derived by Supplier and currency.
- **Inventory** and **Banking** remain separate systems of record.

An approved Purchasing document is not itself the financial ledger. It becomes eligible for an explicit Accounts posting command.

## Business problem

After a Supplier invoice is approved and stock is received, the business must still distinguish:

1. The reviewed source document.
2. The amount owed to the Supplier.
3. Money paid to the Supplier.
4. Which Supplier invoices the Payment settles.
5. Supplier credit notes and where those credits were applied.
6. Payments or credits that remain unallocated.
7. Bank transactions that have or have not been reconciled.

Combining those concepts into one editable status would make partial payments, prepayments, credit notes and corrections unauditable.

## Department ownership

### Purchasing

Purchasing owns:

- Original Supplier document
- Extraction and review
- Supplier identity confirmation
- Document approval
- Reviewed totals and dates

Approval makes the document `ready` for Accounts. Approval does not create a payable automatically.

### Accounts Payable

Accounts Payable owns:

- Payable posting identity
- Supplier and document snapshots
- Supplier Payments
- Payment allocations
- Supplier credit allocations
- Outstanding and credit balances

### Inventory

Inventory owns stock movements. Receiving stock does not post a payable, and posting a payable does not receive stock.

### Banking

Banking will later own imported bank transactions and reconciliation evidence. Recording a Supplier Payment does not create or match a bank transaction.

## Supplier payable posting

An approved Supplier invoice or credit note may be posted explicitly.

The posting copies immutable snapshots of:

- Supplier identity
- Supplier document identity
- Document type
- Document and due dates
- Currency
- Approved gross amount

One active posting may exist per Supplier document. A reversed posting remains in history and permits a replacement posting.

A Supplier invoice increases the amount owed. A Supplier credit note creates credit available for allocation.

## Supplier Payments

A Supplier Payment is an immutable outgoing-money record containing:

- Supplier identity snapshots
- Currency
- Amount
- Method
- External reference
- Paid time
- Responsible actor
- Stable command identity

A Payment can remain unallocated. This represents Supplier prepayment or money that has not yet been matched to an invoice.

A correction changes the Payment to `reversed` only after all allocations have been reversed.

## Payment allocations

`supplier_payment_allocations` is append-only.

A positive allocation reduces:

- The Payment's unallocated amount
- The Supplier invoice's outstanding amount

The Payment and invoice must share the same workspace, Supplier and currency. Allocations cannot exceed either available Payment or invoice outstanding amount.

Corrections create a negative allocation linked to the original through `reversal_of_id`.

## Supplier credit allocations

`supplier_credit_allocations` is append-only.

A positive credit allocation reduces:

- The credit note's unallocated credit
- The Supplier invoice's outstanding amount

Credit and invoice must share the same workspace, Supplier and currency. Corrections create linked negative reversals.

## Derived balances

### Supplier invoice balance

`supplier_payable_balances` derives:

- Payment allocated amount
- Credit allocated amount
- Total allocated amount
- Outstanding amount
- Settlement status

### Supplier credit balance

The same view derives:

- Credit used amount
- Unallocated Supplier credit
- Credit status

### Supplier Payment balance

`supplier_payment_balances` derives:

- Allocated amount
- Unallocated amount

### Supplier account balance

`supplier_account_balances` is grouped by Supplier and currency and derives:

- Posted Supplier invoice amount
- Payments sent
- Credits received
- Outstanding invoice amount
- Unallocated Payment
- Unallocated credit
- Net balance

The net balance is:

`outstanding Supplier invoices - unallocated Supplier Payments - unallocated Supplier credits`

A positive result is owed to the Supplier. A negative result is Supplier credit or prepayment.

Currencies are never combined into one Supplier balance in Version 1.

## Offline boundary

Supplier Accounts commands use one workspace-scoped queue.

The queue supports:

- Posting approved Supplier documents
- Reversing unallocated postings
- Recording Supplier Payments
- Allocating and reversing Payments
- Allocating and reversing Supplier credits
- Reversing unallocated Supplier Payments

Commands retain stable identities, replay in order and stop on the first conflict. The server revalidates Supplier identity, posting state, currencies and current balances.

A cached online load is required before useful offline operation. Offline commands remain provisional until accepted by the trusted server command.

## Security

Browser clients receive RLS-scoped reads only.

Direct browser inserts, updates and deletes are revoked from:

- Supplier payables
- Supplier Payments
- Supplier Payment allocations
- Supplier credit allocations
- Command receipts

Trusted mutations are service-role-only and use the existing Accounts permission model. Normal Founder support remains read-only.

## Side-effect boundary

Supplier Accounts commands create no:

- Bank transaction
- Bank reconciliation
- Inventory movement
- Product or Product-Supplier relationship
- Customer Invoice or Customer Payment
- Sale or Appointment change

## Alternatives considered

### Derive payables directly from approved Purchasing documents

Rejected. Accounts needs its own immutable posting evidence, reversal lifecycle and allocation target without mutating the source document.

### Create a payable automatically on Purchasing approval

Rejected. Accounts requires an explicit review and posting point. Purchasing approval and Accounts recognition are separate departmental decisions.

### Use the Customer Payment tables for Supplier Payments

Rejected. Incoming Customer money and outgoing Supplier money have different parties, direction and operational meaning. Separate tables preserve clarity in Version 1.

### Treat a Bank transaction as the Supplier Payment

Rejected. Bank import and reconciliation require a separate integration and evidence model.

### Store one mutable Supplier balance column

Rejected. A mutable total can drift from Supplier documents, Payments and allocation history.

## Risks

- Supplier invoices with incorrect reviewed totals will create incorrect payable snapshots; reversal and reposting preserve correction history.
- Multi-currency balances are separate. Currency conversion and exchange differences are deferred.
- Supplier refunds are not yet represented as incoming cash; they require a later explicit lifecycle.
- Legal payment remittance documents and communications are separate integrations.

## Future implications

This foundation supports:

- Aged payables
- Supplier statements
- Payment runs
- Remittance advice
- Purchase-order and goods-received matching
- Supplier refunds
- Bank reconciliation
- Business Hub cash-requirement summaries

Future modules must derive from this ledger rather than recreating Supplier paid status or balances independently.
