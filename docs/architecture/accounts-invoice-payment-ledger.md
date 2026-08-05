# Accounts, Invoices, Payments and Customer Balances

## Decision

BDB OS separates the commercial transaction, the amount due, money received and the allocation of that money.

- **Sales** owns the completed commercial transaction.
- **Accounts** owns invoice drafts, issued invoices and invoice lines.
- **Payments** records immutable money received from a Customer.
- **Payment allocations** connect Payments to issued invoices through an append-only ledger.
- **Customer balances** are derived from issued invoices, posted Payments and allocation deltas.
- **Banking** does not become authoritative until a later bank-import and reconciliation integration.

No Customer balance or Invoice paid amount is manually editable.

## Business problem

A business must distinguish:

1. Work sold to a Customer.
2. An invoice issued for an amount due.
3. Money received from the Customer.
4. Which invoice or invoices that money settles.
5. Money received but not yet allocated.
6. Bank activity that has or has not been reconciled.

Treating these as one status creates incorrect balances, prevents partial Payments and overpayments, and makes corrections unauditable.

## Department ownership

### Sales

Sales owns completed Product and Service lines, commercial prices, discounts and VAT snapshots. A completed Sale may create one active invoice draft through an explicit Accounts command.

### Accounts

Accounts owns:

- Invoice identity and numbering
- Invoice due dates
- Issued invoice lines and totals
- Payment receipts
- Payment allocations
- Customer outstanding and credit balances

### Banking

Banking will later own imported bank transactions and reconciliation evidence. Recording a Payment in Accounts does not create or match a bank transaction.

## Invoice lifecycle

The existing `public.invoices` table is upgraded in place and remains the canonical Invoice identity.

An Invoice is:

- `draft` while reviewable
- `sent` after explicit issue
- `overdue` when the due date has passed and an amount remains outstanding
- `paid` when posted allocations cover the total
- `void` when cancelled with a reason and no active allocation remains

Draft invoice lines may be edited. Issued invoice lines are immutable.

A Sale may have one non-void Invoice. A voided Invoice remains in history and permits a replacement Invoice to be created from the same Sale.

## Sale-to-Invoice boundary

Sale invoicing is explicit.

The Accounts command copies the completed Sale's:

- Customer
- Currency
- Product and Service line identities
- Descriptions and codes
- Quantities
- Prices
- Discounts
- VAT
- Totals

The Sale remains immutable and separate. Creating or issuing an Invoice creates no Payment and no Banking activity.

## Manual Invoices

Accounts may also create a manual Invoice draft linked directly to a Customer.

Manual lines use VAT-inclusive prices. The database calculates gross, discount, net, VAT and total values. The draft may be reviewed until it is issued.

## Payment ledger

A Payment is an immutable record of money received.

Each Payment records:

- Customer
- Customer identity snapshots
- Workspace currency
- Amount
- Method
- External reference
- Received time
- Responsible actor
- Stable command identity

A Payment may be recorded without an allocation. This creates Customer credit but does not mark an Invoice paid.

A Payment correction changes the Payment to `reversed` with a reason. The original receipt remains visible.

## Allocation ledger

`payment_allocations` is append-only.

A positive allocation reduces both:

- The Payment's unallocated amount
- The Invoice's outstanding amount

An allocation requires:

- The same workspace
- The same Customer
- The same currency
- A posted Payment
- An issued, non-void Invoice
- An amount no larger than the Payment credit or Invoice outstanding amount

A correction creates one negative allocation linked through `reversal_of_id`. Existing allocation rows are never updated or deleted.

## Derived balances

### Invoice balance

`invoice_account_balances` derives:

- Allocated amount
- Outstanding amount
- Payment status
- Display status

### Payment balance

`payment_account_balances` derives:

- Allocated amount
- Unallocated amount

### Customer balance

`customer_account_balances` derives:

- Issued amount
- Payments received
- Allocated amount
- Outstanding amount
- Unallocated credit
- Net balance

The net balance is:

`outstanding invoices - unallocated customer credit`

A positive result is an amount due. A negative result is Customer credit.

### Sale Accounts status

`sale_account_status` derives whether a Sale is:

- Not invoiced
- Invoiced
- Partially paid
- Paid
- Linked to a void Invoice
- Reversed

The old `sales.settlement_status = not_recorded` field is not used as the Accounts source of truth. The derived Sale Accounts view becomes authoritative until the legacy field is formally retired.

## Offline boundary

Invoice and Payment commands use one workspace-scoped Accounts queue.

The queue supports:

- Manual Invoice creation and review
- Sale Invoice creation
- Invoice issue and void
- Payment recording
- Payment allocation
- Allocation reversal
- Payment reversal

Commands retain stable identities, replay in order and stop on the first conflict. The server revalidates current Invoice versions, balances, Customer identity, currencies and allocation limits.

A cached online load is required before useful offline operation. Offline UI state is provisional until the trusted command is accepted.

## Security

Browser clients receive RLS-scoped reads only.

Direct browser inserts, updates and deletes are revoked from:

- Invoices
- Invoice lines
- Payments
- Payment allocations
- Command receipts

Trusted commands are service-role-only and use the shared Accounts permission model. Normal Founder support remains read-only; guarded Founder test-write follows the shared support-session contract.

## Side-effect boundary

Invoice and Payment commands create no:

- Bank transaction
- Bank reconciliation
- Inventory movement
- Sale or Sale line
- Appointment status change

Sale-to-Invoice copies an existing Sale. It does not alter Sales or Inventory.

## Alternatives considered

### Mark an Invoice paid directly

Rejected. It loses Payment identity, partial Payments, overpayments and allocation history.

### Store a Customer balance column

Rejected. A mutable total drifts from the Invoice and Payment evidence and cannot be audited reliably.

### Link every Payment directly to one Invoice

Rejected. One Payment may settle several invoices, and one Invoice may receive several Payments.

### Treat a bank transaction as the Payment

Rejected for this slice. Bank imports, duplicate detection, transfer identification and reconciliation evidence require a separate Banking design.

### Automatically issue an Invoice when a Sale completes

Rejected. Accounts needs an explicit review point for Customer details, due date and invoice issue.

## Risks

- Legacy baseline Invoices had direct browser mutation grants; these are explicitly revoked.
- Legacy `bank_transactions.matched_invoice_id` remains until Banking migration and must not be interpreted as Payment allocation.
- Multi-currency allocation is prohibited in Version 1; conversion and exchange differences are deferred.
- Credit notes and refunds require a later explicit lifecycle rather than negative edits to issued Invoices or Payments.
- Email delivery and legal invoice rendering are separate Documents and Communications integrations.

## Future implications

This foundation supports:

- Customer account statements
- Partial Payments and deposits
- Payment allocation across multiple invoices
- Aged receivables
- Credit notes and refunds
- Bank reconciliation
- Invoice Documents and email delivery
- Customer-profile financial history
- Business Hub cash and receivable summaries

Future modules must derive from these ledgers rather than recreating paid status or Customer balances independently.
