# Accounts Scalable Workspace V1

## Decision

Accounts remains one BDB OS department, but high-volume financial work is split into dedicated operational workspaces rather than one browser-loaded page.

The navigation becomes:

- Accounts Overview
- Sales
  - Invoices
  - Credit Notes
  - Delivery Notes
- Payments
- Customer balances
- Supplier Payables

The validated financial command engine remains authoritative. This release changes how records are queried and worked with, not how accounting truth is written.

## Business problem

The original Accounts page loaded complete collections of Invoices, Payments, Customers, Credit Notes, Delivery Notes and document index rows into the browser. That is acceptable for early validation and small datasets but is not an acceptable long-term contract for businesses with large financial histories.

## Implementation

- Accounts Overview loads only attention-level summary data and eight recent documents.
- Invoice, Credit Note, Delivery Note and Payment registers load bounded pages from dedicated APIs.
- Invoice register paging uses stable keyset cursors based on precise `created_at` timestamp + ID. Under the final-first lifecycle, modern Invoices are created atomically at issue time, so this avoids ambiguous ordering when thousands share the same issue date.
- Payment/Credit Note/Delivery Note registers use stable timestamp + ID cursors.
- Customer balances remain bounded to 50-row database pages.
- Full Invoice lines, linked Credit Notes, Payments, Delivery Notes and Notes load only when one Invoice is opened.
- Search and cursor indexes are added to the financial source tables.
- Trigram indexes support contains-search for operational identifiers and customer names.
- `accounts_workspace_summary` is a `security_invoker` view so the overview remains workspace/RLS scoped.
- Existing offline Accounts commands remain authoritative. The Accounts UX Consolidation extracts focused composer components into dedicated routes; `/accounts/operations` now redirects to Overview and is no longer a user-facing workbench.

## Offline behaviour

BDB OS remains offline-first for working data, not for an unlimited historical ledger. The Overview and bounded working pages may be cached locally; financial commands continue to queue as Pending sync. Deep historical searches require a database connection when the requested records are not already in the local working set.

## Alternatives considered

### Keep one Accounts page and add more filters

Rejected. Browser-side filtering still requires loading the underlying collections and therefore preserves the scaling problem.

### Make Invoices a new top-level BDB OS department

Rejected. Invoices are a financial record owned by Accounts and connect directly to Credit Notes, Payments, balances and Banking reconciliation. Promoting every record type to a global department would fragment BDB OS navigation.

### Rewrite the existing financial write engine while changing navigation

Rejected. Numbering, VAT, catalogue pricing, document immutability, Credit Notes, Payments and offline commands have already been validated. Rewriting them would add risk without solving the scaling problem.

## Risks

- Derived balance/status views still calculate live accounting state. If future enterprise volumes show those aggregate reads becoming expensive, the next optimisation should be measured from query plans rather than introducing duplicated balance truth pre-emptively.
- Very large exports should not be implemented as browser-loaded tables; they will need asynchronous/export-specific infrastructure later.
- Accountancy-practice multi-client views remain a future control-plane layer over isolated workspaces, not one mixed client ledger.

## Future implication

BDB OS can keep a simple owner-facing Accounts Overview while finance teams work in deeper registers. The same pattern can later extend to Purchasing, Banking, reporting and accountant workflows without changing the core financial records.
