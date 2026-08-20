# Decision Record — Accounts UX Consolidation V1

Date: 2026-08-20

## Decision

Accounts is one coherent BDB OS department. Its scalable registers and final-first creation flows live in dedicated routes; the former `/accounts/operations` workbench is retired from normal use and redirects to the Accounts Overview.

The release changes presentation and bounded read composition only. Existing server commands, immutable financial records, numbering, renderers, workspace permissions, RLS and the workspace-scoped offline queue remain authoritative.

## Audited route map

Before this decision, the scalable read routes existed but creation actions leaked into the legacy workbench:

| User action | Previous destination | Consolidated destination |
| --- | --- | --- |
| Accounts → New document | `/accounts/operations` | `/accounts/sales/new` |
| Sales → New document | `/accounts/operations` | `/accounts/sales/new` |
| Invoices → New Invoice | `/accounts/operations` | `/accounts/sales/invoices/new` |
| Credit Notes → New Credit Note | `/accounts/operations` | `/accounts/sales/credit-notes/new` |
| Delivery Notes → New Delivery Note | `/accounts/operations` | `/accounts/sales/delivery-notes/new` |
| Payments → Record Payment | `/accounts/operations` | `/accounts/payments/new` |
| Business Hub → Create Invoice | `/accounts/operations` | `/accounts/sales/invoices/new` |
| PWA Create Invoice shortcut | `/accounts/operations` | `/accounts/sales/invoices/new` |
| Search result → Invoice | `/accounts` | `/accounts/sales/invoices/[id]` |
| Direct legacy workbench URL | legacy combined UI | redirect to `/accounts` |

The resulting hierarchy is:

- `/accounts` — calm owner/finance overview
- `/accounts/sales` — Sales documents workspace
- `/accounts/sales/invoices` — bounded Invoice register
- `/accounts/sales/invoices/[id]` — one Invoice and its connected live account state
- `/accounts/sales/invoices/new` — catalogue-controlled Invoice composer
- `/accounts/sales/credit-notes` — bounded Credit Note register
- `/accounts/sales/credit-notes/new` — exact-Invoice, quantity-backed Credit Note composer
- `/accounts/sales/delivery-notes` — bounded Delivery Note register
- `/accounts/sales/delivery-notes/new` — standalone or source-linked Delivery Note composer
- `/accounts/payments` — bounded Payment workspace
- `/accounts/payments/new` — Payment recording flow
- `/accounts/customers` — bounded Customer Balance register
- `/accounts/payables` — Supplier Payables boundary
- `/accounts/settings` — future-document legal identity and numbering defaults

## Creation boundary

Dedicated composer components replace the single giant user-facing workbench. They do not duplicate financial truth:

- Composer lookup API calls are authenticated, workspace-scoped and bounded to working sets of 25 records.
- Invoice lines select canonical Products or Services; the server re-reads catalogue price and VAT before issuing.
- Product or mixed Invoices require a Sales Order reference. Service-only Invoices do not.
- Credit Notes resolve one exact Invoice and submit genuine source-line quantities only. There is no standalone or arbitrary-money path.
- Delivery Notes may be standalone or linked to an issued Invoice/completed Sale.
- Payments are recorded separately and begin unallocated; no “Mark paid” shortcut exists.
- Append-only document Notes use the same queued command runtime as financial creation.
- The former workbench's validated document-identity capability is preserved at `/accounts/settings` through the existing workspace configuration command.

The browser never writes protected financial tables directly. Permanent document numbers continue to be assigned safely by idempotent server commands when a queued command is accepted.

## Detail boundary

Invoice Detail deliberately separates:

- permanent evidence: original lines, snapshots, totals and issued-document rendering;
- live account state: Credit Notes, allocated Payments, remaining balance and append-only Notes.

View, Print, PDF and Email actions operate on the issued document. Credit Note creation carries the Invoice ID into the controlled Credit Note flow.

## Scalability and offline behaviour

Registers keep the existing bounded database-side filtering and cursor/page contracts. Full lines and connected records load only for the opened Invoice. Composer searches fetch bounded working sets rather than copying the full Customer or catalogue history into browser storage.

The existing `bdb-accounts-queue-v1` queue remains workspace-scoped, ordered and idempotent. Synchronisation stops on the first rejected command so later commands remain available for review. Offline creation shows Pending sync; deep historical search remains an online operation.

## Database assessment

No schema change is required for this consolidation. Production already contains migrations `20260819221325_accounts_scalable_registers` and `20260819222047_accounts_invoice_register_cursor`, the expected indexes, and invoker-safe Accounts views. Adding a migration solely for a route/UI change would create false migration history.

## Alternatives considered

### Keep the workbench and restyle it

Rejected. It would preserve the product-level route leak, browser-loaded collections and duplicate navigation model.

### Copy each business rule into each page

Rejected. The existing command APIs and database functions are the authoritative enforcement boundary. Composers provide focused input and reuse that boundary.

### Build Banking reconciliation or a new Sales Order workflow now

Rejected. Accounts records Payments and a Sales Order reference bridge. Banking owns future reconciliation evidence, and no authoritative Sales Order entity currently exists.

## Consequences

- Small businesses retain a calm entry point.
- Finance teams retain serious bounded registers.
- Normal navigation cannot expose the old Accounts UI.
- The old workbench route is recoverably retired without deleting command or migration compatibility code.
- Authenticated route acceptance is a release gate, not inferred from compilation alone.
