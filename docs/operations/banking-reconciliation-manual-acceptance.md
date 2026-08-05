# Banking Reconciliation Manual Acceptance

## Environment

- Branch: `integration/vanita-workspace`
- Application: canonical Vercel branch preview
- Database: isolated integration Supabase project only
- Required role: Owner, Manager or custom Banking role with the relevant permissions

Do not use production data for acceptance. Keep PR #23 draft and unmerged.

## 1. Bank account lifecycle

1. Open **Banking**.
2. Create a Bank account with code, name, institution, masked identifier and EUR currency.
3. Confirm it appears under **Bank accounts**.
4. Refresh the page and confirm it remains visible.
5. Archive it only after statement-import testing is complete.
6. Confirm imported transactions remain visible after archive.

Expected:

- No Bank credentials are requested or stored.
- Duplicate account codes are rejected.
- Archived accounts cannot receive new statement imports.

## 2. CSV statement import

Create a CSV containing:

```csv
Date,Description,Amount,Reference,Currency
2026-07-30,Customer receipt,100.00,CUSTOMER-REF-1,EUR
2026-07-31,Supplier transfer,-80.00,SUPPLIER-REF-1,EUR
```

1. Choose the active EUR Bank account.
2. Import the CSV.
3. Confirm two immutable Bank transactions appear.
4. Confirm the credit displays as money received and the debit as money sent.
5. Open **Statement imports** and confirm filename, period, hash prefix and row count.
6. Import the exact same file again.
7. Import the same transactions in a differently named file.

Expected:

- The exact file is rejected as already imported.
- Repeated transaction fingerprints are skipped rather than duplicated.
- A currency mismatch rejects the entire import.
- A malformed row rejects the entire import without creating a partial batch.

## 3. Customer Payment reconciliation

Prerequisite: record a EUR Customer Payment in Customer Accounts.

1. Open the imported credit Bank transaction.
2. Confirm only Customer Payments are offered.
3. Match part of the Bank amount.
4. Confirm the Bank transaction becomes **Partially matched**.
5. Match the remainder.
6. Confirm it becomes **Matched**.
7. Confirm the Customer Invoice status and Customer Payment allocation did not change solely because of the Banking match.

Expected:

- Supplier Payments are never offered for a credit transaction.
- Reconciliation cannot exceed either unmatched Bank value or unreconciled Customer Payment value.

## 4. Supplier Payment reconciliation

Prerequisite: record a EUR Supplier Payment in Supplier Payables.

1. Open the imported debit Bank transaction.
2. Confirm only Supplier Payments are offered.
3. Match the full amount.
4. Confirm the Bank transaction becomes **Matched**.
5. Confirm the Supplier payable allocation did not change solely because of the Banking match.

Expected:

- Customer Payments are never offered for a debit transaction.
- Currency mismatch is rejected.

## 5. Split and combined reconciliation

1. Reconcile one larger Bank credit across two Customer Payments.
2. Reconcile two Bank credits against one larger Customer Payment.
3. Repeat the equivalent debit workflow with Supplier Payments.

Expected:

- Bank transaction and Payment unmatched balances remain accurate after every allocation.
- No total can become negative.
- Status is derived, not manually edited.

## 6. Reversal lifecycle

1. Attempt to reverse a Customer or Supplier Payment while Bank reconciliation is active.
2. Confirm the Payment reversal is blocked.
3. Attempt to reverse a matched Bank transaction.
4. Confirm the transaction reversal is blocked.
5. Reverse each reconciliation allocation with a reason.
6. Confirm original and reversal rows remain visible in history.
7. Confirm Bank and Payment unmatched balances return.
8. Reverse the now-unmatched Bank transaction.

Expected:

- No allocation or transaction history is deleted.
- One original allocation can be reversed only once.

## 7. Offline behaviour

1. Load Banking online.
2. Disconnect the browser.
3. Reopen Banking and confirm cached records display.
4. Queue a reconciliation.
5. Queue a reversal after it.
6. Reconnect.

Expected:

- Statement import and Bank account creation remain unavailable offline.
- Reconciliation commands replay in order.
- Exact retries create no duplicate allocation.
- Synchronisation stops on the first current-state conflict and preserves later queued commands.

## 8. Access control

Test Owner, Manager, Employee, custom Banking role and Founder support modes.

Expected:

- RLS-scoped reads follow the Banking `view` permission.
- Create/edit/delete/approve actions follow their corresponding Banking permissions.
- Direct browser writes to Banking ledger tables are denied.
- Normal Founder support remains read-only.
- Guarded Founder test-write follows the existing temporary test boundary.

## 9. Side-effect verification

After all tests, confirm Banking actions created no automatic:

- Customer Invoice change
- Supplier payable change
- Customer Payment
- Supplier Payment
- Accounts allocation
- Inventory movement
- Sale
- Appointment

## Acceptance record

Record:

- Tested deployment SHA
- Tester
- Date/time
- CSV sample name and hash prefix
- Roles tested
- Passed checks
- Failed checks
- Screenshots or error messages
- Decision: accept, correct and retest, or defer
