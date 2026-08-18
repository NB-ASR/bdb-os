# BDB OS Decision Record — Accounts & Business Documents V1

## Decision

Rebuild Accounts around business documents, while preserving the existing accounting ledger and offline command safeguards underneath.

Primary Accounts navigation becomes:

- Documents
- Payments
- Customers

`+ New Document` provides Invoice, Credit Note and Delivery Note according to permission and available source records.

## Business problem

The current Accounts screen exposes too much financial machinery at once and does not produce the professional documents expected from a real business system. BDB OS needs a simple operational surface without weakening financial integrity.

## Ownership

- Accounts owns Invoices, Credit Notes, Payments and balances.
- Sales/Fulfilment owns Delivery Notes operationally.
- Documents exposes generated business documents without becoming a second financial source of truth.
- Customer 360 shows all related documents and financial history.

## One Engine relationships

Customer → shared Products & Services → Sale/Invoice → Invoice/Delivery Note/Credit Note → Payment/Balance → Customer History.

No duplicate customers, catalogue items or parallel invoice database are introduced.

## Database design

### Existing tables retained

- `invoices`
- `invoice_lines`
- `payments`
- `payment_allocations`
- `customers`
- `sales`
- `sale_lines`
- `documents`
- `document_links`

### New structures

- `credit_notes`
- `credit_note_lines`
- `delivery_notes`
- `delivery_note_lines`
- `workspace_document_sequences`
- `business_document_index` view

Credit Notes are accounting records. Delivery Notes are operational records and have no accounting effect.

## Numbering

Legal document numbers are allocated server-side when a document is issued. Drafts may exist offline with UUID identity and a clearly non-legal draft reference. Final numbers are workspace-scoped, sequential within a document type/year series and collision-safe.

Existing Production Invoice numbers are preserved. New issue operations use the new sequence without rewriting historical records.

## Offline boundary

Draft creation/editing can be queued offline. Final issue requires authoritative server acceptance because numbering, immutability and financial integrity cannot be guaranteed by an isolated browser.

## Credit Notes

A Credit Note references an issued Invoice and credits specific original Invoice lines. The system prevents issued credits from exceeding the source Invoice quantity/value. Issued Credit Notes reduce receivables. Void remains a separate exceptional correction mechanism.

## Delivery Notes

A Delivery Note is created from an Invoice or completed Sale, carries Customer/delivery details and quantities, and never changes accounting balances merely by being created or issued.

## Reusable Business Document engine

One rendering model serves Invoice, Credit Note and Delivery Note and is intentionally reusable for future Quotations, Statements, Purchase Orders and Receipts.

The print/PDF identity comes from the active workspace and supports Founder-controlled Custom Business Branding when entitled.

## Malta/EU VAT requirements verified before implementation

Authoritative Malta tax guidance requires a tax invoice to carry, among other items, issue date, a sequential unique number, supplier name/address/VAT identification, customer name/address and relevant VAT identification, quantity/nature of goods or services, supply date when different, taxable value/unit price/discounts, VAT rate and VAT amount. Conditional wording is required for special treatments such as reverse charge, self-billing and cash accounting.

The EU VAT Directive Article 226 contains the corresponding invoice-content requirements. Article 219/226b requires an amending document to refer specifically and unambiguously to the original invoice and the details amended.

BDB OS therefore stores business/customer VAT identity, supply date and an optional VAT/legal-treatment note and prints them from immutable issue-time snapshots where applicable.

Sources reviewed 2026-08-18:

- Malta Commissioner for Revenue VAT FAQ: https://cfr.gov.mt/en/vat/general_information/Pages/Frequently-Asked-Questions.aspx
- Council Directive 2006/112/EC, Articles 219, 226, 226b, 229 and 230: https://eur-lex.europa.eu/eli/dir/2006/112/2025-04-14/eng
- Malta legislation portal, 2026 Fifth Schedule amendments: https://legislation.mt/eli/ln/2026/75/eng and https://legislation.mt/eli/ln/2026/86/eng

## Risks

- Credit Notes against already-paid Invoices can create Customer credit. Balance views must recognise over-allocation after crediting rather than silently losing the credit.
- Generated PDFs must never become a second source of truth; the database record is authoritative.
- Legal compliance depends on businesses supplying correct VAT/address data. The UI must make missing required identity visible before issue.
- External Email delivery is not currently implemented. `Email` can only create/prepare a BDB communication record until an actual provider is connected; the UI must not claim delivery.

## Future implications

The same document engine can later support quotations, statements, purchase orders and receipts without creating separate rendering architectures.
