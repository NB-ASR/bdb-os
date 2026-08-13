# Banking Reconciliation Ledger

## Decision

BDB OS upgrades the existing `public.bank_transactions` catalogue in place and reconciles imported Bank transactions against immutable Customer Payments or Supplier Payments through append-only allocation deltas.

Banking never marks a Customer Invoice or Supplier payable paid directly. Accounts remains the settlement authority:

`Bank transaction -> Bank reconciliation allocation -> Payment -> Accounts allocation -> Invoice or Supplier payable`

## Ownership

### Banking owns

- Manual Bank account identity
- Immutable statement import batches
- Immutable imported Bank transactions
- Duplicate-file and duplicate-transaction detection
- Reconciliation evidence
- Reconciliation reversals
- Derived unmatched, partially matched and matched status

### Accounts Receivable owns

- Customer Payments
- Customer Payment allocations to Customer Invoices
- Customer balances

### Accounts Payable owns

- Supplier Payments
- Supplier Payment allocations to Supplier invoices
- Supplier balances

## Version 1 workflow

1. Create a manual Bank account with one currency.
2. Import a CSV statement online.
3. Hash the complete file and reject a repeated file for the same account.
4. Parse and validate each row server-side.
5. Generate a stable account-scoped transaction fingerprint.
6. Store imported Bank transaction fields immutably.
7. Review each credit against Customer Payments in the same currency.
8. Review each debit against Supplier Payments in the same currency.
9. Create one or more append-only reconciliation allocations.
10. Reverse an allocation with a linked negative delta when correcting a match.
11. Reverse a source Bank transaction only after all reconciliation allocations have been released.

## CSV boundary

Version 1 supports CSV or text statement files up to 2 MB and 5,000 transaction rows.

Recognised concepts include:

- Transaction date
- Value date
- Description or narrative
- Signed amount, or separate credit and debit columns
- Direction/type
- Currency
- External Bank reference

Comma, semicolon and tab delimiters are supported. Common date and decimal formats are normalised. Unknown or malformed rows reject the import atomically; partially accepted files are not created.

Statement import is online-only because file hashing, duplicate validation and immutable ingestion require server confirmation.

## Reconciliation model

`bank_reconciliation_allocations` is append-only.

A positive allocation connects one Bank transaction to exactly one Customer Payment or Supplier Payment. A linked negative allocation reverses the original without deleting history.

Rules:

- Credit Bank transactions can reconcile only to Customer Payments.
- Debit Bank transactions can reconcile only to Supplier Payments.
- Workspace and currency must match.
- Allocation cannot exceed the Bank transaction's unmatched amount.
- Allocation cannot exceed the Payment's unreconciled amount.
- One Payment may be matched across several Bank transactions.
- One Bank transaction may be split across several Payments.
- Customer and Supplier Payments cannot be reversed while active Bank reconciliation remains.

## Derived state

Bank transaction reconciliation state is derived from signed allocation totals:

- `unmatched`: no net reconciliation
- `partially_matched`: some value reconciled
- `matched`: full amount reconciled
- `reversed`: source Bank transaction corrected

Payment Bank-reconciliation state is derived independently from Invoice or payable settlement. A Payment can be fully allocated in Accounts but still unmatched at the Bank, or fully reconciled at the Bank but not yet allocated to a specific Invoice.

## Legacy Bank transactions

The existing `matched_invoice_id` column is retained temporarily for audit and production migration review. It is no longer authoritative and no new Banking command writes it.

Legacy rows without a Bank account or currency are shown as requiring review and cannot enter the new reconciliation ledger. Production usage must be audited before the column is removed or migrated.

## Offline boundary

After a successful online load, Banking records are cached per workspace.

Offline-capable commands:

- Reconcile a Bank transaction
- Reverse a reconciliation allocation
- Reverse an unreconciled Bank transaction

Commands retain stable idempotency keys, replay in order and stop on the first conflict. The server revalidates current balances, direction, currency, record status and access.

Online-only operations:

- Bank account creation or maintenance
- Statement upload and import
- Duplicate-file validation
- Future external Bank connections

## Security

Authenticated browser clients receive RLS-scoped reads only. Direct browser insert, update and delete privileges are revoked from Banking ledger tables.

All mutations use service-role-only trusted commands and the Banking permission model. Founder support remains read-only except during an explicitly guarded test-write session.

## Side-effect boundary

Banking commands do not create or mutate:

- Customer Invoices
- Supplier payables
- Customer Payments
- Supplier Payments
- Accounts allocations
- Sales
- Appointments
- Inventory movements

## Deferred

- Open Banking and direct Bank APIs
- Automatic Payment creation from statement rows
- AI-approved matching
- Accounting journals
- Cash forecasting
- Automated fee netting
- Payment-provider payout reconciliation
- General-purpose matching rule engines
