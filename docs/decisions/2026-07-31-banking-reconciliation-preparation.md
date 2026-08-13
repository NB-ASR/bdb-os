# Banking Reconciliation Integration Preparation

**Status:** Prepared for implementation; no Banking application or database behaviour changed by this record.

## Decision summary

BDB OS will reconcile imported Bank transactions against the existing immutable Customer Payment and Supplier Payment ledgers.

A Bank transaction must not directly mark a Customer Invoice, Supplier payable, Sale or Appointment as settled. Invoice and Supplier payable settlement remains derived from Payment allocations inside Accounts.

The existing `public.bank_transactions` table will be upgraded in place. BDB OS will not create a second Bank transaction catalogue.

## 1. Business problem

BDB OS can now record:

- Customer Invoices and Customer Payments;
- Customer Payment allocations;
- Supplier payables and Supplier Payments;
- Supplier Payment and Supplier credit allocations.

The remaining financial control problem is proving that recorded money received or sent corresponds to an imported Bank transaction.

Without a Banking reconciliation layer, the business cannot reliably distinguish:

- a Payment recorded in Accounts but not yet visible at the bank;
- a Bank transaction that has not been explained;
- a partial or batched settlement;
- duplicate statement imports;
- a reversed or corrected reconciliation;
- Bank fees, interest or other transactions that do not represent a Customer or Supplier Payment.

## 2. Department ownership

### Banking

Banking owns:

- Bank account identity;
- statement/import identity;
- immutable imported Bank transaction records;
- reconciliation evidence;
- unmatched and partially matched Bank transaction status.

### Accounts Receivable

Accounts Receivable owns:

- Customer Payments;
- Customer Payment allocations to Invoices;
- Customer balances.

### Accounts Payable

Accounts Payable owns:

- Supplier Payments;
- Supplier Payment allocations to Supplier invoices;
- Supplier balances.

### Boundary

Banking confirms whether money recorded by Accounts appears in a Bank statement. Banking does not create, edit, allocate or reverse Customer or Supplier Payments.

## 3. Connected records

The V1 workflow is:

`Bank account -> statement import -> Bank transaction -> reconciliation allocation -> Customer Payment or Supplier Payment`

Invoice and Supplier payable links remain indirect:

`Bank transaction -> Payment -> Accounts allocation -> Invoice/payable`

This preserves one authoritative settlement model.

## 4. Simplicity assessment

The integration simplifies BDB OS only if it:

- upgrades `public.bank_transactions` in place;
- reuses `public.payments` and `public.supplier_payments`;
- derives reconciliation state instead of mutating Payment or Invoice status;
- uses one Banking workspace rather than separate inbound and outbound applications;
- starts with file import and manual confirmation rather than external Bank APIs.

The existing `matched_invoice_id` relationship is a legacy shortcut. It bypasses the Payment ledger and must not remain the authoritative reconciliation path.

Existing legacy values must be preserved for audit and migration review. The column should not be deleted until production data has been assessed.

## 5. Offline and cloud boundary

### Online-only

- Bank statement or CSV upload;
- duplicate-file and transaction fingerprint validation;
- future live Bank connections.

### Offline-capable after a cached online load

- viewing imported Bank transactions;
- preparing manual reconciliation commands;
- queueing match or reversal commands with stable command identities.

The server must revalidate current unmatched amounts, Payment status, currency, direction and workspace ownership during replay. Synchronisation stops on the first conflict.

## 6. Version 1 decision

Banking reconciliation is justified for Version 1 because Accounts Receivable and Accounts Payable now exist and require independent cash verification.

V1 must remain limited to:

- manual Bank account setup;
- CSV/file statement import;
- immutable transaction ingestion with duplicate protection;
- manual Customer Payment and Supplier Payment matching;
- partial and split reconciliation through append-only allocations;
- reversal without deleting history;
- derived reconciliation status and balances;
- cached reads and an offline reconciliation queue.

Deferred:

- Open Banking or direct Bank APIs;
- automated accounting journals;
- AI agents that approve matches;
- rule engines;
- cash forecasting;
- fee netting automation;
- payout-provider integrations;
- automatic creation of Customer or Supplier Payments from Bank transactions.

## Current-state audit

### Existing `public.bank_transactions`

The current table contains:

- workspace;
- transaction date;
- description;
- non-negative amount;
- `credit` or `debit` transaction type;
- mutable `matched`, `unmatched` or `review` status;
- optional `matched_invoice_id`;
- created and updated timestamps.

Current gaps:

- no Bank account identity;
- no currency snapshot;
- no import batch or statement identity;
- no external transaction identity;
- no stable duplicate fingerprint;
- no posted/value timestamp distinction;
- no immutable import evidence;
- no reconciliation allocation ledger;
- no Supplier Payment relationship;
- browser insert, update and delete permissions remain enabled;
- direct Invoice matching bypasses the Customer Payment ledger.

The integration database currently contains no Bank transaction rows, but production data must still be treated as unknown until audited.

### Existing Banking UI

The current Banking page reads the legacy application store. In local demo mode it can mark a Bank transaction as matched and directly mark an Invoice paid. In cloud mode it is deliberately read-only because an atomic finance command does not exist.

This local preview behaviour must be removed from the authoritative Banking workflow. Reconciliation must never mutate an Invoice directly.

## Proposed V1 data model

### `bank_accounts`

Workspace-owned manual Bank account records containing:

- display name;
- institution name;
- masked account identifier;
- account currency;
- active/archive state;
- actor and timestamp metadata.

No credentials or live Bank tokens are required for V1.

### `bank_statement_imports`

Immutable import-batch records containing:

- Bank account;
- source filename;
- source file hash;
- imported period;
- imported, duplicate, rejected and review counts;
- actor and timestamp metadata.

### Upgraded `bank_transactions`

Add immutable source snapshots and identity fields, including:

- Bank account;
- statement import;
- currency;
- external/source transaction reference where available;
- stable transaction fingerprint;
- posted timestamp or date;
- value date where available;
- original description and reference;
- import actor and source metadata;
- reversal or void metadata only where source correction is required.

Imported financial fields become immutable. Corrections use explicit reversal or replacement evidence rather than arbitrary browser updates.

### `bank_reconciliation_allocations`

Append-only signed reconciliation deltas containing:

- Bank transaction;
- exactly one Customer Payment or Supplier Payment target;
- positive match amount or linked negative reversal;
- stable command identity;
- actor and timestamp metadata.

A single table may use nullable `customer_payment_id` and `supplier_payment_id` columns with a database constraint requiring exactly one target. This retains real foreign keys while keeping one reconciliation ledger.

## Reconciliation rules

- Bank `credit` transactions may reconcile only to active Customer Payments.
- Bank `debit` transactions may reconcile only to active Supplier Payments.
- Workspace and currency must match.
- Positive reconciliation cannot exceed the Bank transaction's unreconciled amount.
- Positive reconciliation cannot exceed the Payment's unreconciled Bank amount.
- Partial, one-to-many and many-to-one reconciliation are supported through allocations.
- Reversals are negative rows linked to the original allocation.
- Reconciliation never changes Invoice, payable, Payment, Sale, Inventory or Appointment records.
- Bank fees and unexplained transactions remain unmatched or classified for later accounting; they do not fabricate Payments.

## Derived views

The implementation should derive:

- Bank transaction reconciled and unreconciled amount;
- Bank transaction reconciliation status;
- Customer Payment Bank-reconciled amount and status;
- Supplier Payment Bank-reconciled amount and status;
- Bank account imported movement totals by currency;
- unmatched and partially matched review queues.

A displayed Bank balance must not be presented unless an opening or statement balance has been imported and its provenance is explicit.

## Security model

- Revoke direct browser insert, update and delete access to imported Bank transactions and reconciliation allocations.
- Use trusted service-role commands with stable command identities.
- Retain RLS-scoped reads.
- Use the existing Banking permission model for normal workspace members.
- Normal Founder support remains read-only.
- Guarded Founder test-write follows the existing support-session pattern.

## Suggested matching

V1 may provide deterministic, non-authoritative suggestions using:

- direction;
- exact currency and amount;
- close transaction and Payment dates;
- external reference or normalized description.

Suggestions never write data. A human must confirm the reconciliation command.

## Required implementation sequence

1. Audit legacy `matched_invoice_id` production usage before destructive changes.
2. Add Bank account and statement-import foundations.
3. Harden imported Bank transactions and direct-write permissions.
4. Add append-only reconciliation allocations and command receipts.
5. Add derived reconciliation views.
6. Add trusted import, match and reversal commands.
7. Add Banking API and workspace-scoped offline queue.
8. Replace the legacy Banking page with the connected reconciliation workspace.
9. Add static contracts, unit tests and pgTAP security/lifecycle coverage.
10. Run rolled-back integration lifecycle and authenticated manual acceptance.

## Acceptance criteria

- Exact statement re-import creates no duplicate transactions.
- Changed source content with the same source identity is held for review.
- Credit-to-Customer-Payment and debit-to-Supplier-Payment matching succeeds.
- Invalid direction, workspace and currency combinations are rejected.
- Partial and split matches derive correct remaining amounts.
- Over-reconciliation is rejected.
- Exact command retry creates one allocation only.
- Reversal preserves the original allocation.
- Imported transaction financial fields cannot be edited directly.
- No Invoice, payable, Payment, Inventory, Sale or Appointment side effects occur.
- Offline queued commands replay exactly once and stop on conflict.
- Owner, Manager, Employee, custom Banking permissions and Founder support boundaries are verified.

## Risks

- Deleting or repurposing `matched_invoice_id` before production audit could destroy legacy evidence.
- Automatically creating Payments from Bank transactions would merge Banking and Accounts responsibilities.
- Treating statement totals as a live Bank balance would misrepresent data provenance.
- Supporting live Bank APIs before the reconciliation ledger is stable would add provider-specific complexity too early.
- A one-to-one match model would fail for partial Payments, batched deposits and combined Supplier transfers.

## Future implications

Once this foundation is stable, BDB OS can add Bank-provider connections, deterministic matching rules, payout reconciliation and cash reporting without changing the core Accounts ledgers.
