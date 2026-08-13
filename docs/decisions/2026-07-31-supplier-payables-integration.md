# Supplier Payables integration completion

## Decision

BDB OS Version 1 now contains a separate immutable Accounts Payable ledger connected explicitly to approved Supplier documents.

Purchasing approval confirms the reviewed source document. Accounts Payable posting is a separate user action. Inventory receipt and Banking reconciliation remain independent.

## Completed scope

- Approved Supplier invoices can be posted as amounts owed.
- Approved Supplier credit notes can be posted as Supplier credit.
- Supplier Payments are immutable outgoing-money records.
- Payment allocations and Supplier credit allocations are append-only.
- Allocation corrections create linked reversals.
- Supplier balances are derived by Supplier and currency.
- One active payable posting is permitted per Supplier document.
- Reversed payable postings remain visible and allow replacement posting.
- Payments and payables cannot be reversed while active allocations remain.
- Commands use stable idempotency identities and one workspace-scoped offline queue.
- Browser clients receive RLS-scoped reads only; trusted mutations remain service-role-only.

## Validation evidence

A rolled-back integration-database lifecycle proved:

- Exact payable-post retry creates one posting only.
- A EUR 100 Supplier invoice accepts EUR 60 Payment allocation and EUR 20 credit allocation, leaving EUR 20 outstanding.
- The EUR 80 Supplier Payment retains EUR 20 unallocated.
- Over-allocation is rejected.
- Cross-Supplier allocation is rejected.
- Cross-currency allocation is rejected.
- Supplier Payment reversal is blocked while allocated.
- Supplier payable reversal is blocked while allocated.
- Payment and credit allocation reversals append linked negative records.
- Payment and payable reversals succeed after allocations are released.
- No Bank transaction or Inventory movement is created.
- All temporary lifecycle data was removed by rollback.

## Risks and boundaries

- Supplier refunds are deferred.
- Foreign-exchange conversion and exchange differences are deferred.
- Payment runs, remittance advice and bank reconciliation are later integrations.
- Manual authenticated browser acceptance is required before PR #23 can progress toward merge.

## Future implication

Banking should reconcile imported Bank transactions against the existing Customer and Supplier Payment ledgers. It must not replace them or become the source of invoice settlement truth.
