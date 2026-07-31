# Supplier Payables manual acceptance

Use the integration preview only. Do not merge PR #23 or promote the deployment before this procedure passes.

## Purchasing and posting

1. Approve a real Supplier invoice in Purchasing.
2. Confirm `accounts_posting_status` becomes `ready` without affecting Inventory posting.
3. Use **Post to Accounts**.
4. Confirm one active payable is created with Supplier, document, currency and approved total snapshots.
5. Retry the same operation and confirm no duplicate active payable is created.

## Supplier Payment and allocation

1. Record a partial Supplier Payment.
2. Confirm the Payment remains visible as immutable evidence.
3. Allocate part of the Payment to the Supplier invoice.
4. Confirm invoice outstanding and Payment unallocated amounts update.
5. Attempt an allocation above Payment available and confirm rejection.
6. Attempt cross-Supplier and cross-currency allocations and confirm rejection.

## Supplier credit

1. Approve and post a Supplier credit note.
2. Confirm it appears as unallocated Supplier credit.
3. Allocate the credit to an invoice for the same Supplier and currency.
4. Confirm both invoice outstanding and credit available amounts update.

## Reversals

1. Confirm Supplier Payment reversal is blocked while allocations remain active.
2. Confirm payable reversal is blocked while allocations remain active.
3. Reverse each allocation.
4. Confirm original allocation and linked negative reversal both remain visible.
5. Reverse the released Payment and payable posting.
6. Confirm source documents and reversed financial records remain visible.

## Offline and permissions

1. Queue a command offline and reconnect.
2. Confirm the stable command replays exactly once.
3. Introduce a conflict and confirm replay stops before later commands overtake it.
4. Verify Owner, Manager, Employee and custom Accounts permissions.
5. Verify normal Founder support is read-only and guarded Founder test-write remains explicit.

## Department boundaries

Confirm Supplier Accounts actions create no:

- Bank transaction
- Bank reconciliation
- Inventory movement
- Customer Invoice or Customer Payment
- Sale or Appointment change
